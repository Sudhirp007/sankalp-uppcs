"""Automated Quality Gate for enriched MCQs before Human Verification.

Separates questions into clear actionable tiers:
- ``FLAGGED``      : Critical OCR/structural defects (missing/truncated/duplicate options,
                     missing statements/lists, cut-off stems, OCR garbage, or missing Q#)
                     where human verification against the PDF is genuinely needed.
- ``ENGLISH_ONLY`` : English stem and all 4 English options (A-D) are complete, but the
                     Hindi translation (stem or options) is missing — e.g. General English
                     papers or monolingual extractions that can be verified en masse.
- ``READY``        : Fully bilingual, structurally complete questions ready for promotion.
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from typing import Any, Sequence

# Always-dangling endings (articles, conjunctions, relative pronouns, trailing comma/hyphen)
_ALWAYS_TRUNCATED_END_RE = re.compile(
    r"(?:\b(?:the|a|an|and|or|that|which|whose|whom|because|although|while|whereas)\s*$"
    r"|[,;\-–—/]\s*$)",
    re.IGNORECASE,
)
# Interrogative stems ("Which...", "What...", "Who...", "How...") ending in a preposition without '?'
_INTERROGATIVE_START_RE = re.compile(r"^\s*(?:which|what|who|when|where|how|why)\b", re.IGNORECASE)
_PREPOSITION_END_RE = re.compile(
    r"\b(?:in|of|by|from|at|with|to|for|as|is|are|was|were)\s*$",
    re.IGNORECASE,
)
_MULTI_STMT_TRIGGER_RE = re.compile(
    r"\b(?:following\s+statements|statements\s+given\s+below|list\s*[-–]?\s*i\b|assertion\s*\(\s*a\s*\)|arrange\s+the\s+following)",
    re.IGNORECASE,
)
_MULTI_STMT_ITEMS_RE = re.compile(
    r"(?:\b[1-4]\s*[.)]|\(\s*[1-4iIvVxX]+\s*\)|\b(?:I|II|III|IV)\s*[.)]|\b[A-D]\s*[.)]|\bReason\s*\(\s*R\s*\))",
)
_OCR_GARBAGE_RE = re.compile(
    r"(?:\ufffd|ï¿½|\b37\s+1[A-J]\b|\bTravelling\s+at\s*[-–]\b|\bJ1ii\b|\b3TEI\b)",
    re.IGNORECASE,
)
_SINGLE_OPTION_LETTER_RE = re.compile(r"^[A-Ea-e1-5]$")
_PAGE_HEADER_RE = re.compile(r"###\s*PAGE\s*(\d+)", re.IGNORECASE)


@dataclass
class QualityFlag:
    code: str
    severity: str  # HIGH | MEDIUM | LOW
    message: str
    field: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


def evaluate_question_quality(
    *,
    question_number: int | None,
    question_en: str,
    question_hi: str | None,
    options: Sequence[dict[str, Any]],
    prev_question_number: int | None = None,
) -> tuple[float, list[dict[str, Any]]]:
    """Return ``(quality_score 0..1, list_of_flag_dicts)`` for a single question."""
    flags: list[QualityFlag] = []
    q_en = (question_en or "").strip()
    q_hi = (question_hi or "").strip()

    # 1. Question Number Checks
    if question_number is None:
        flags.append(
            QualityFlag(
                code="MISSING_QNO",
                severity="HIGH",
                message="Question number is missing (likely dropped by PDF OCR).",
                field="question_number",
            )
        )
    elif prev_question_number is not None and question_number != prev_question_number + 1:
        if question_number > prev_question_number + 1 and (question_number - prev_question_number) <= 10:
            missing_nums = ", ".join(str(n) for n in range(prev_question_number + 1, question_number))
            flags.append(
                QualityFlag(
                    code="SEQUENCE_GAP",
                    severity="LOW",
                    message=f"Numbering jumped from Q.{prev_question_number} to Q.{question_number} (missing: {missing_nums}).",
                    field="question_number",
                )
            )

    # 2. Stem Length & True Truncation Checks
    if len(q_en) < 16:
        flags.append(
            QualityFlag(
                code="SHORT_STEM_EN",
                severity="HIGH",
                message=f"English question stem is unusually short ({len(q_en)} chars).",
                field="question_en",
            )
        )
    if q_en and not q_en.endswith(("?", ".", ":", ")", '"', "'", "”", "’")):
        is_truncated = bool(_ALWAYS_TRUNCATED_END_RE.search(q_en)) or (
            bool(_INTERROGATIVE_START_RE.search(q_en)) and bool(_PREPOSITION_END_RE.search(q_en))
        ) or (q_en.count("(") > q_en.count(")"))
        if is_truncated:
            flags.append(
                QualityFlag(
                    code="TRUNCATED_STEM_EN",
                    severity="HIGH",
                    message=f"Question stem appears cut off at the end: '...{q_en[-30:]}'",
                    field="question_en",
                )
            )

    # 3. Multi-statement / Match List Completeness
    if _MULTI_STMT_TRIGGER_RE.search(q_en) and not _MULTI_STMT_ITEMS_RE.search(q_en):
        flags.append(
            QualityFlag(
                code="MISSING_STATEMENTS_OR_LIST",
                severity="HIGH",
                message="Stem refers to statements/lists/assertion, but numbered items (1, 2 / I, II / R) are missing.",
                field="question_en",
            )
        )

    # 4. OCR Garbage / Broken Fractions
    if _OCR_GARBAGE_RE.search(q_en) or _OCR_GARBAGE_RE.search(q_hi):
        flags.append(
            QualityFlag(
                code="OCR_ARTIFACT_IN_STEM",
                severity="HIGH",
                message="Detected OCR artifact or dropped fraction/article number in stem.",
                field="question_en",
            )
        )

    # 5. Hindi Stem Presence
    if not q_hi or len(q_hi) < 4:
        flags.append(
            QualityFlag(
                code="MISSING_STEM_HI",
                severity="MEDIUM",
                message="Hindi question stem is missing (English-only question).",
                field="question_hi",
            )
        )

    # 6. Option Integrity Checks
    if len(options) != 4:
        flags.append(
            QualityFlag(
                code="OPTION_COUNT_MISMATCH",
                severity="HIGH",
                message=f"Expected 4 options (A-D), found {len(options)}.",
                field="options",
            )
        )

    seen_en: dict[str, str] = {}
    single_letter_opts = 0
    missing_opt_hi_keys: list[str] = []
    for opt in options:
        key = str(opt.get("key") or "?")
        t_en = str(opt.get("text_en") or "").strip()
        t_hi = str(opt.get("text_hi") or "").strip()

        if not t_en or t_en.lower() in ("none", "n/a", "-", ".", "null"):
            flags.append(
                QualityFlag(
                    code=f"EMPTY_OPTION_EN_{key}",
                    severity="HIGH",
                    message=f"Option ({key}) English text is empty or placeholder.",
                    field=f"option_{key.lower()}_en",
                )
            )
        else:
            if t_en.endswith((",", ";", " and", " or", " of", " the", " in", "-")):
                flags.append(
                    QualityFlag(
                        code=f"TRUNCATED_OPTION_EN_{key}",
                        severity="HIGH",
                        message=f"Option ({key}) appears truncated: '{t_en}'",
                        field=f"option_{key.lower()}_en",
                    )
                )
            if _SINGLE_OPTION_LETTER_RE.fullmatch(t_en):
                single_letter_opts += 1

            norm_en = t_en.lower()
            if norm_en in seen_en:
                flags.append(
                    QualityFlag(
                        code=f"DUPLICATE_OPTION_{key}",
                        severity="HIGH",
                        message=f"Option ({key}) has identical English text to Option ({seen_en[norm_en]}).",
                        field=f"option_{key.lower()}_en",
                    )
                )
            else:
                seen_en[norm_en] = key

        if not t_hi or t_hi.lower() in ("none", "n/a", "-", ".", "null"):
            missing_opt_hi_keys.append(key)
            flags.append(
                QualityFlag(
                    code=f"EMPTY_OPTION_HI_{key}",
                    severity="MEDIUM",
                    message=f"Option ({key}) Hindi text is missing.",
                    field=f"option_{key.lower()}_hi",
                )
            )

    if single_letter_opts >= 3:
        flags.append(
            QualityFlag(
                code="PLACEHOLDER_OPTION_LETTERS",
                severity="HIGH",
                message="Options contain only bare letters (A/B/C/D/E) instead of actual option text.",
                field="options",
            )
        )

    # Calculate composite score: HIGH defects penalize heavily; missing-Hindi alone keeps score >= 0.70
    high_count = sum(1 for f in flags if f.severity == "HIGH")
    med_count = sum(1 for f in flags if f.severity == "MEDIUM")
    low_count = sum(1 for f in flags if f.severity == "LOW")
    if high_count > 0:
        penalty = high_count * 0.35 + min(med_count * 0.05, 0.15)
    elif med_count > 0:
        # Missing Hindi only -> cap penalty at 0.25 so score is 0.75 (clearly above broken OCR items)
        penalty = min(0.15 + (med_count - 1) * 0.025, 0.25)
    else:
        penalty = low_count * 0.05
    score = round(max(0.0, 1.0 - penalty), 2)
    return score, [f.to_dict() for f in flags]


def classify_review_status(flags: Sequence[dict[str, Any]], subject: str | None = None, paper_id: str | None = None) -> str:
    """Classify a staged question into ``READY``, ``ENGLISH_ONLY``, or ``FLAGGED``.

    - ``ENGLISH_ONLY``: Has missing Hindi flags (``MISSING_STEM_HI`` / ``EMPTY_OPTION_HI_*``),
      and NO critical English structural defects (or is in a General English subject/paper
      where only Hindi or Q# is missing).
    - ``FLAGGED``: Has critical OCR / structural defects requiring human inspection.
    - ``READY``: No blocking flags (or only informational ``SEQUENCE_GAP``).
    """
    if not flags:
        return "READY"

    codes = {str(f.get("code") or "") for f in flags}
    hi_codes = {c for c in codes if c == "MISSING_STEM_HI" or c.startswith("EMPTY_OPTION_HI_")}
    non_hi_codes = codes - hi_codes - {"SEQUENCE_GAP"}

    is_eng_subject = "english" in (subject or "").lower() or "english" in (paper_id or "").lower()
    if hi_codes:
        if not non_hi_codes:
            return "ENGLISH_ONLY"
        if is_eng_subject and non_hi_codes <= {"MISSING_QNO", "SHORT_STEM_EN"}:
            return "ENGLISH_ONLY"

    if not non_hi_codes:
        return "READY"

    return "FLAGGED"


def infer_question_page(chunk_text: str | None, page_start: int, page_end: int, question_en: str, question_number: int | None) -> int:
    """Locate which 1-based page inside a multi-page ``raw_chunks.text`` contains the question."""
    if not chunk_text or page_start == page_end:
        return page_start or 1

    # Split chunk by '### PAGE n' markers
    parts = _PAGE_HEADER_RE.split(chunk_text)
    if len(parts) < 3:
        return page_start

    page_blocks: list[tuple[int, str]] = []
    for i in range(1, len(parts) - 1, 2):
        try:
            pno = int(parts[i])
        except ValueError:
            pno = page_start
        body = parts[i + 1].split("[LOOKAHEAD")[0]
        page_blocks.append((pno, body))

    # Try matching by snippet of question_en
    words = [w for w in re.findall(r"[A-Za-z]{4,}", question_en or "")][:5]
    if len(words) >= 2:
        pattern = re.compile(r".{0,40}".join(re.escape(w) for w in words[:3]), re.IGNORECASE | re.DOTALL)
        for pno, body in page_blocks:
            if pattern.search(body):
                return pno

    # Fallback: match by question_number
    if question_number is not None:
        qno_pat = re.compile(rf"(?:^|\n)\s*{question_number}\s*[.):\-]", re.MULTILINE)
        for pno, body in page_blocks:
            if qno_pat.search(body):
                return pno

    return page_start


def parse_options_json(options_json: str | list[dict[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(options_json, list):
        return options_json
    try:
        data = json.loads(options_json)
        return data if isinstance(data, list) else []
    except Exception:
        return []
