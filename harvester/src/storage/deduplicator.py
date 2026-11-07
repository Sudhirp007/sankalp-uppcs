"""Text normalisation + deterministic content hashing for deduplication.

Design note: the hash covers the normalised question stem **plus the sorted option
texts**. Hashing the stem alone would collapse distinct UPPCS questions that share
generic stems such as "Which of the following statements is/are correct?".
Sorting the options makes the hash invariant to option shuffling across booklet
series (A/B/C/D).
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Iterable

# Leading question numbers: "Q.14", "Q 14.", "14.", "14)", "(14)", "प्रश्न 14", "14 -"
_LEADING_NUM = re.compile(
    r"^\s*(?:"
    r"(?:q(?:uestion)?|प्रश्न)\s*\.?\s*(?:no\.?\s*)?\(?\d{1,3}\)?\s*[.):\-–]?"  # Q.14 / Question 14 / प्रश्न 14
    r"|\(\d{1,3}\)"  # (14)
    r"|\d{1,3}\s*[.):\-–](?!\d)"  # 14.  14)  14 -   (but not 14.5)
    r")\s*",
    re.IGNORECASE,
)
_OPTION_PREFIX = re.compile(r"^\s*\(?[a-dA-D1-4]\)\s*|^\s*[a-dA-D]\.\s+")
# Python's \w excludes Devanagari vowel signs (category Mc/Mn), so keep that block
# explicitly — except the danda punctuation marks । ॥ (U+0964/U+0965).
_NON_WORD = re.compile(r"[^\w\s\u0900-\u0963\u0966-\u097F]", re.UNICODE)
_WS = re.compile(r"\s+")


def normalize_text(text: str | None) -> str:
    """Lower-case, strip question numbers, punctuation and redundant whitespace.

    Devanagari letters and vowel signs (matras) are preserved; dandas are removed.
    """
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text)
    t = _LEADING_NUM.sub("", t, count=1)
    t = t.lower()
    t = _NON_WORD.sub(" ", t)
    return _WS.sub(" ", t).strip()


def normalize_option(text: str | None) -> str:
    if not text:
        return ""
    return normalize_text(_OPTION_PREFIX.sub("", text, count=1))


def content_hash(question_en: str, options_en: Iterable[str] = (), question_hi: str | None = None) -> str:
    """SHA256 of the normalised question (+ sorted options). Falls back to Hindi stem."""
    stem = normalize_text(question_en) or normalize_text(question_hi)
    opts = sorted(o for o in (normalize_option(x) for x in options_en) if o)
    payload = stem + "\x1f" + "\x1e".join(opts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
