"""Gemini structured-output normaliser (``google-genai`` SDK + Pydantic V2).

Raw chunk text -> ``ParsedMCQBatch`` via Gemini native structured output
(``response_schema``). Each returned question is re-validated *individually*
so one malformed item never discards a whole chunk.

Rate limiting: a simple async RPM limiter + exponential backoff on 429/5xx.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
from dataclasses import dataclass, field

from pydantic import ValidationError

from config import settings
from src.normalizer.schema import AnswerKeyBatch, ParsedMCQ, ParsedMCQBatch

log = logging.getLogger(__name__)

MCQ_SYSTEM_PROMPT = """\
You are an expert Civil Services Examination Data Architect. You convert raw/OCR text
from competitive examination question booklets (UPPCS, UPSC, State PSCs) into pristine,
fully bilingual, pedagogically enriched MCQs.

INPUT FORMAT
- Text is grouped by '### PAGE n'. Two-column pages are labelled [LEFT COLUMN] / [RIGHT COLUMN].
  Usually one column is English and the other is the parallel Hindi version of the SAME questions.
- [LOOKAHEAD ...] is the start of the next page. Use it ONLY to complete a question cut off at
  the page break. NEVER start a new question from the LOOKAHEAD block.

ENRICHMENT & PARSING RULES
1. Output every complete MCQ in order without inventing or omitting questions.
2. Strip booklet noise: running headers, footers ("Page X of Y", "Series A", booklet codes like "TUKU-03"),
   watermarks, candidate instructions, and rough-work notes.
3. Clean question numbers: extract the printed number into `question_number`, removing it from the stem.
4. Full Bilingual Completeness:
   - Always populate BOTH `question_en` AND `question_hi`.
   - For all options (A, B, C, D), populate BOTH `text_en` AND `text_hi`.
   - If the source is monolingual or has garbled Devanagari OCR, produce an accurate, natural translation
     so candidates can practice in either language.
5. Standard Subject Taxonomy (choose the best match):
   - Ancient History, Medieval History, Modern History, Art & Culture
   - Indian Polity & Governance
   - Physical Geography, Indian Geography, World Geography
   - Indian Economy
   - General Science & Technology
   - Environment & Ecology
   - UP Special GK
   - Logical Reasoning & Aptitude, Mathematics
   - General Hindi, General English
   - Current Affairs, Miscellaneous
6. Hierarchical Micro-Topic:
   Format as: `Primary Subject -> Core Theme -> Specific Concept`
   (e.g., "Indian Polity & Governance -> Constitutional Amendments -> Panchayati Raj",
          "Indian Economy -> Public Finance -> Effective Revenue Deficit",
          "Indian Geography -> River Systems -> Indus Basin").
7. Cognitive Complexity & Difficulty Grading:
   - EASY: Direct one-liner factual/recall question.
   - MEDIUM: Multi-statement evaluation ("Which of the statements given above is/are correct?").
   - HARD: Complex Matrix Match (List-I to List-II), multi-step calculation, or deep analytical assertion/reason.
8. Pedagogical Explanation:
   Provide an authoritative 2-3 sentence factual justification in `explanation_en` that:
   (a) explicitly proves why the chosen option is correct, and
   (b) concisely clarifies why common distractors are incorrect.
   (Keep explanation_hi concise as well if available).
   DO NOT include raw chain-of-thought, deliberation or internal monologue.
"""

ANSWER_KEY_PROMPT = """\
Extract the official answer key from this text of an Indian exam answer-key document.
Return every (question_number, correct_option) pair. Options may be written as a/b/c/d,
A/B/C/D or 1/2/3/4 (map 1->A, 2->B, 3->C, 4->D). Use 'X' for deleted/cancelled questions or
where all options are accepted. If several booklet series are present, return only the series
named in the request (or the first one if none is named) and report it in 'series'.
"""


class GeminiNotConfigured(RuntimeError):
    pass


class QuotaExhaustedError(RuntimeError):
    """Raised when all configured API keys and fallback models have exhausted their quota."""

    def __init__(self, message: str, retry_after_seconds: float = 14400.0):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


FALLBACK_MODELS: tuple[str, ...] = (
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.8-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
)


@dataclass
class ChunkResult:
    questions: list[ParsedMCQ] = field(default_factory=list)
    invalid: list[str] = field(default_factory=list)  # validation error messages
    raw_count: int = 0


class RateLimiter:
    """Async limiter enforcing at most ``rpm`` request starts per minute."""

    def __init__(self, rpm: int):
        self.interval = 60.0 / max(rpm, 1)
        self._lock = asyncio.Lock()
        self._next = 0.0

    async def wait(self) -> None:
        async with self._lock:
            now = time.monotonic()
            if now < self._next:
                await asyncio.sleep(self._next - now)
            self._next = max(now, self._next) + self.interval


_RETRY_DELAY = re.compile(r"retry(?:Delay)?['\"]?\s*[:=]\s*['\"]?(\d+(?:\.\d+)?)s", re.I)


class GeminiCleaner:
    def __init__(self, *, model: str | None = None, rpm: int | None = None, api_key: str | None = None):
        raw_keys = api_key or settings.gemini_api_key
        if not raw_keys:
            raise GeminiNotConfigured("GEMINI_API_KEY is not set (add it to harvester/.env)")
        from google import genai  # imported lazily so the rest of the pipeline works without it

        keys = [k.strip() for k in raw_keys.split(",") if k.strip()]
        if not keys:
            raise GeminiNotConfigured("GEMINI_API_KEY is empty")

        self._clients = {}
        client_ids: list[str] = []
        for k in keys:
            # 1. Vertex AI client (uses GCP promotional credits directly)
            vid = f"vertex:{k}"
            self._clients[vid] = genai.Client(vertexai=True, api_key=k, http_options={"timeout": 180000})
            client_ids.append(vid)
            # 2. AI Studio fallback client
            aid = f"aistudio:{k}"
            self._clients[aid] = genai.Client(api_key=k, http_options={"api_version": "v1beta", "timeout": 180000})
            client_ids.append(aid)

        primary_model = model or settings.gemini_model
        models = [primary_model] + [m for m in FALLBACK_MODELS if m != primary_model]
        self._endpoints: list[tuple[str, str]] = [(cid, m) for cid in client_ids for m in models]
        self._exhausted: set[tuple[str, str]] = set()
        self.model = primary_model
        self.limiter = RateLimiter(rpm or settings.gemini_rpm)
        self.quota_halted = False

    def _active_endpoints(self) -> list[tuple[str, str]]:
        return [ep for ep in self._endpoints if ep not in self._exhausted]

    # ------------------------------------------------------------------ core
    async def _generate(self, system_prompt: str, user_contents, schema) -> str:
        from google.genai import errors, types

        last: Exception | None = None
        max_retry_wait = 14400.0

        while active := self._active_endpoints():
            key, current_model = active[0]
            client = self._clients[key]
            extra_kwargs = {}
            if "2.5" in current_model:
                extra_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)

            config = types.GenerateContentConfig(
                system_instruction=system_prompt,
                response_mime_type="application/json",
                response_schema=schema,
                temperature=settings.gemini_temperature,
                **extra_kwargs,
            )

            rotate_endpoint = False
            for attempt in range(1, settings.gemini_max_retries + 1):
                await self.limiter.wait()
                try:
                    resp = await client.aio.models.generate_content(
                        model=current_model, contents=user_contents, config=config
                    )
                    text = resp.text or ""
                    if not text.strip():
                        reason = getattr(resp.candidates[0], "finish_reason", "?") if resp.candidates else "no candidates"
                        raise ValueError(f"empty response (finish_reason={reason})")
                    return text
                except errors.APIError as exc:
                    last = exc
                    if exc.code in (402, 403, 404):
                        log.warning("Endpoint (%s..., %s) returned HTTP %s; rotating to fallback.", key[:10], current_model, exc.code)
                        self._exhausted.add((key, current_model))
                        rotate_endpoint = True
                        break
                    if exc.code not in (408, 429, 500, 502, 503, 504):
                        raise
                    m = _RETRY_DELAY.search(str(exc))
                    wait = float(m.group(1)) + 1 if m else min(2**attempt * 2 + random.uniform(0, 2), 45)
                    if wait > 90 or "generate_content_free_tier_requests" in str(exc):
                        max_retry_wait = max(wait, 3600.0)
                        log.warning(
                            "Quota exhausted on (%s..., %s) (retryDelay=%.0fs); rotating to next fallback model/key.",
                            key[:10], current_model, wait,
                        )
                        self._exhausted.add((key, current_model))
                        rotate_endpoint = True
                        break
                    if exc.code == 503 and attempt >= 2:
                        log.warning("Model %s experiencing 503 high demand; rotating to fallback.", current_model)
                        self._exhausted.add((key, current_model))
                        rotate_endpoint = True
                        break
                    log.warning("Gemini %s on %s (attempt %d/%d); sleeping %.0fs", exc.code, current_model, attempt, settings.gemini_max_retries, wait)
                    await asyncio.sleep(wait)
                except (ValueError, asyncio.TimeoutError) as exc:
                    last = exc
                    wait = min(2**attempt + random.uniform(0, 1), 30)
                    log.warning("Gemini call failed (%s); retry in %.0fs", exc, wait)
                    await asyncio.sleep(wait)

            if not rotate_endpoint:
                break

        if not self._active_endpoints():
            self.quota_halted = True
            raise QuotaExhaustedError(
                f"All Gemini API keys and fallback models exhausted quota. Last error: {last}",
                retry_after_seconds=max_retry_wait,
            )
        raise RuntimeError(f"Gemini failed after {settings.gemini_max_retries} attempts: {last}")

    # ------------------------------------------------------------------ MCQs
    async def parse_chunk(self, text: str, *, context: str = "") -> ChunkResult:
        prompt = (f"CONTEXT: {context}\n\n" if context else "") + "TEXT:\n" + text
        raw = await self._generate(MCQ_SYSTEM_PROMPT, prompt, ParsedMCQBatch)
        return validate_batch_json(raw)

    async def extract_from_page_image(
        self,
        png_bytes: bytes,
        *,
        question_number: int | None = None,
        hint_text: str = "",
        context: str = "",
    ) -> ChunkResult:
        """Multimodal Vision re-extraction directly from a rendered PDF page PNG.

        Bypasses Tesseract / embedded PDF text layers completely so dropped options,
        math fractions, and cut-off stems are recovered directly from the visual scan.
        """
        from google.genai import types

        focus = ""
        if question_number is not None:
            focus = (
                f"\nTARGET QUESTION: Extract ONLY Question #{question_number} from this page image "
                f"(and if hint text is provided below, match that question even if the number was misprinted).\n"
            )
        elif hint_text:
            focus = (
                f"\nTARGET QUESTION: Extract ONLY the single question matching this partial stem: "
                f"{hint_text[:200]!r}. Read its printed question_number, full stem, and all 4 options A-D from the image.\n"
            )
        prompt = (
            (f"CONTEXT: {context}\n" if context else "")
            + focus
            + "Carefully read both the English and Hindi columns in the attached exam page image. "
            + "Ensure the full question stem (including all statements/lists/fractions) and all 4 options (A, B, C, D) in both English and Hindi are completely and accurately extracted."
        )
        contents = [
            types.Part.from_bytes(data=png_bytes, mime_type="image/png"),
            prompt,
        ]
        raw = await self._generate(MCQ_SYSTEM_PROMPT, contents, ParsedMCQBatch)
        return validate_batch_json(raw)

    async def parse_chunks(self, items: list[tuple[str, str, str]], concurrency: int = 2):
        """Yield ``(key, ChunkResult | Exception)`` as each ``(key, text, context)`` completes."""
        sem = asyncio.Semaphore(concurrency)

        async def one(key: str, text: str, context: str):
            async with sem:
                if self.quota_halted:
                    return key, QuotaExhaustedError("Skipped due to prior quota exhaustion")
                try:
                    return key, await self.parse_chunk(text, context=context)
                except QuotaExhaustedError as exc:
                    self.quota_halted = True
                    return key, exc
                except Exception as exc:  # surfaced to caller, recorded on the chunk
                    log.exception("Chunk %s failed", key)
                    return key, exc

        for fut in asyncio.as_completed([one(k, t, c) for k, t, c in items]):
            yield await fut

    # ------------------------------------------------------------ answer keys
    async def parse_answer_key(self, text: str, series: str | None = None) -> AnswerKeyBatch:
        req = f"Requested series: {series}\n\n" if series else ""
        raw = await self._generate(ANSWER_KEY_PROMPT, req + "TEXT:\n" + text, AnswerKeyBatch)
        return AnswerKeyBatch.model_validate_json(raw)


def validate_batch_json(raw: str) -> ChunkResult:
    """Validate each question independently; collect errors instead of failing the batch."""
    result = ChunkResult()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Gemini returned invalid JSON: {exc}") from exc
    items = data.get("questions", []) if isinstance(data, dict) else data
    result.raw_count = len(items)
    for i, item in enumerate(items):
        try:
            result.questions.append(ParsedMCQ.model_validate(item))
        except ValidationError as exc:
            msg = f"item {i} (q#{item.get('question_number') if isinstance(item, dict) else '?'}): " + "; ".join(
                e["msg"] for e in exc.errors()[:3]
            )
            result.invalid.append(msg)
            log.warning("Invalid MCQ dropped: %s", msg)
    return result
