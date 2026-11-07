"""Dual-column exam-PDF layout analyser.

Indian exam booklets (UPPSC/UPSC) are usually two columns per page — often English
on the left and the parallel Hindi version on the right. Many official PDFs are
scans carrying a vendor OCR text layer (e.g. OmniPage) that is fine for English but
turns Devanagari into Latin garbage. This module therefore:

1. reads PyMuPDF text blocks/words and detects the column gutter per page;
2. orders text: left column top→bottom, then right column top→bottom;
3. decides per column whether to OCR (Tesseract at 300 DPI on the column clip):
   always for scanned pages (vendor OCR layers drop whole option rows), and for
   born-digital pages only when the text layer scores poorly / looks like
   mis-mapped Devanagari / contains replacement glyphs;
4. strips repeated headers/footers and decorative noise;
5. groups pages into LLM-sized chunks with a small look-ahead so questions cut at
   a page boundary can still be completed.
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf as fitz

from config import settings
from src.parsers import ocr_engine

log = logging.getLogger(__name__)

_DEVANAGARI = re.compile(r"[\u0900-\u097F]")
_LATIN = re.compile(r"[A-Za-z]")
_OPTION_MARK = re.compile(r"\(\s*[a-dA-D1-4]\s*\)")
_GARBLED = ("\ufffd", "ï¿½", "�")
_STOPWORDS = frozenset(
    "the of is in which following a an and to for by on with from are be was were has have it its that "
    "this as at or not all above none correct statement statements given select answer code below "
    "what who when where how one two india indian state".split()
)


# --------------------------------------------------------------------------- #
# Data classes
# --------------------------------------------------------------------------- #
@dataclass
class ColumnText:
    name: str  # HEADER | LEFT | RIGHT | FULL
    text: str
    method: str = "TEXT"  # TEXT | OCR
    quality: float = 1.0


@dataclass
class PageExtraction:
    page_no: int  # 1-based
    columns: list[ColumnText] = field(default_factory=list)
    two_column: bool = False

    @property
    def method(self) -> str:
        methods = {c.method for c in self.columns if c.text.strip()}
        if not methods:
            return "TEXT"
        return methods.pop() if len(methods) == 1 else "MIXED"

    @property
    def text(self) -> str:
        parts = []
        for c in self.columns:
            if c.text.strip():
                parts.append(f"[{c.name} COLUMN]\n{c.text.strip()}" if c.name in ("LEFT", "RIGHT") else c.text.strip())
        return "\n\n".join(parts)

    @property
    def looks_like_questions(self) -> bool:
        return len(_OPTION_MARK.findall(self.text)) >= 2


# --------------------------------------------------------------------------- #
# Heuristics
# --------------------------------------------------------------------------- #
def text_quality(text: str) -> float:
    """Score 0..1 of how much a text layer looks like real English/Hindi.

    * proper Unicode Devanagari scores high;
    * Latin text is scored by plausible-word ratio and stop-word density —
      Devanagari mis-mapped into Latin (``3TEI 37 1A fii``) scores very low.
    """
    if not text or not text.strip():
        return 0.0
    if any(g in text for g in _GARBLED):
        return 0.0
    cleaned = _OPTION_MARK.sub(" ", text)
    deva = len(_DEVANAGARI.findall(cleaned))
    latin = len(_LATIN.findall(cleaned))
    if deva + latin == 0:
        return 0.0
    if deva / (deva + latin) > 0.5:
        return 0.9
    tokens = [t.strip(".,;:?!'\"()[]-–—/") for t in cleaned.split()]
    tokens = [t for t in tokens if t]
    if not tokens:
        return 0.0
    plausible = 0
    stops = 0
    for t in tokens:
        low = t.lower()
        if low in _STOPWORDS:
            stops += 1
        if t.isdigit() or re.fullmatch(r"\d+(\.\d+)?%?|[ivx]+", low):
            plausible += 1
        elif t.isalpha() and len(t) >= 2 and re.search(r"[aeiouy]", low) and (
            t.islower() or t.istitle() or (t.isupper() and len(t) <= 6)
        ):
            plausible += 1
    plaus_ratio = plausible / len(tokens)
    stop_ratio = min((stops / len(tokens)) / 0.18, 1.0)
    return round(0.5 * plaus_ratio + 0.5 * stop_ratio, 3)


def _is_noise(text: str) -> bool:
    """Decorative dots/bullets, barcodes, lone marks."""
    t = text.strip()
    if not t:
        return True
    alnum = sum(ch.isalnum() for ch in t)
    return alnum < 3 or alnum / max(len(t), 1) < 0.3


def detect_gutter(blocks: list[tuple], page_width: float, max_cross_ratio: float = 0.25) -> float | None:
    """Return x of the column gutter, or None for single-column pages.

    Scanned booklets are often slightly skewed, so a perfectly empty vertical
    strip rarely exists. Instead, for every x in the central 30–70 % band we
    count blocks *crossing* that x and pick the x with the fewest crossings
    (ties → widest run, centre). The split is accepted when crossings are at
    most ``max_cross_ratio`` of blocks and both sides hold ≥ 2 block centres.
    """
    narrow = [b for b in blocks if (b[2] - b[0]) < page_width * 0.75]
    if len(narrow) < 4:
        return None
    lo, hi = int(page_width * 0.3), int(page_width * 0.7)
    crossings = [sum(1 for b in narrow if b[0] < x < b[2]) for x in range(lo, hi)]
    if not crossings:
        return None
    min_cross = min(crossings)
    best_start, best_len, run_start = lo, 0, None
    for i, c in enumerate(crossings + [10**9]):
        if c == min_cross and run_start is None:
            run_start = i
        elif c != min_cross and run_start is not None:
            if i - run_start > best_len:
                best_start, best_len = lo + run_start, i - run_start
            run_start = None
    gutter = best_start + best_len / 2
    left_mass = sum(1 for b in narrow if (b[0] + b[2]) / 2 < gutter)
    right_mass = len(narrow) - left_mass
    if min_cross > len(narrow) * max_cross_ratio or left_mass < 2 or right_mass < 2:
        return None
    return gutter


def find_repeated_lines(pages_lines: list[list[str]], min_ratio: float = 0.4) -> set[str]:
    """Lines (e.g. booklet code 'TUKU-03', 'Page 3 of 30') repeated on many pages."""
    if len(pages_lines) < 3:
        return set()
    counter: Counter[str] = Counter()
    for lines in pages_lines:
        counter.update({_norm_line(l) for l in lines if 0 < len(_norm_line(l)) <= 40})
    threshold = max(3, int(len(pages_lines) * min_ratio))
    return {line for line, n in counter.items() if n >= threshold}


def _norm_line(line: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"\d+", "#", line)).strip().lower()


_PAGE_FOOTER = re.compile(r"^\s*(page\s*)?\d{1,3}\s*(of\s*\d{1,3})?\s*$|^\s*series\s*[-–:]?\s*[a-d]\s*$", re.I)


def _clean_column(text: str, repeated: set[str]) -> str:
    out = []
    for line in text.splitlines():
        if _norm_line(line) in repeated or _PAGE_FOOTER.match(line):
            continue
        if line.strip() and _is_noise(line) and not re.match(r"^\s*\(?\d{1,3}[.)]?\s*$", line):
            continue
        out.append(line.rstrip())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


# --------------------------------------------------------------------------- #
# Main parser
# --------------------------------------------------------------------------- #
class PDFColumnParser:
    def __init__(
        self,
        *,
        ocr_mode: str = "auto",
        quality_threshold: float = 0.6,
        min_chars: int | None = None,
        trust_scan_text_layer: bool = False,
    ):
        if ocr_mode not in ("auto", "always", "never"):
            raise ValueError("ocr_mode must be auto|always|never")
        self.ocr_mode = ocr_mode
        self.quality_threshold = quality_threshold
        self.min_chars = min_chars or settings.ocr_min_chars
        self.trust_scan_text_layer = trust_scan_text_layer
        self._ocr_warned = False

    # ---- OCR helper ---------------------------------------------------------
    def _ocr(self, page: fitz.Page, clip: fitz.Rect | None, psm: int = 4, lang: str | None = None) -> str | None:
        try:
            return ocr_engine.ocr_page(page, clip, psm=psm, lang=lang)
        except ocr_engine.OCRUnavailable as exc:
            if not self._ocr_warned:
                log.warning("OCR fallback unavailable: %s", exc)
                self._ocr_warned = True
            return None

    @staticmethod
    def _has_balanced_options(text: str) -> bool:
        """True if option markers (a),(b),(c),(d) appear in balanced counts (no dropped option rows)."""
        counts = [len(re.findall(rf"\(\s*{ch}\s*\)", text, re.I)) for ch in ("a", "b", "c", "d")]
        if max(counts, default=0) == 0:
            return False
        # Every option letter a..d should appear the same number of times (tolerance <= 1 across a page column)
        return min(counts) >= 1 and (max(counts) - min(counts)) <= 1

    def _needs_ocr(self, text: str, scanned: bool = False) -> tuple[bool, float]:
        q = text_quality(text)
        if self.ocr_mode == "never":
            return False, q
        if self.ocr_mode == "always":
            return True, q
        if scanned and not self.trust_scan_text_layer:
            # Only trust a scan's vendor text layer if it has high quality AND balanced (a)-(d) options
            if q >= 0.78 and len(text.strip()) >= 120 and self._has_balanced_options(text):
                return False, q
            return True, q
        return (q < self.quality_threshold or len(text.strip()) < 40), q

    @staticmethod
    def is_scanned(page: fitz.Page, min_cover: float = 0.7) -> bool:
        """True if a single raster image covers most of the page (scanned booklet).

        Vendor OCR layers on such scans silently drop lines (e.g. whole option rows),
        so in ``auto`` mode scanned pages are always re-OCR'd.
        """
        area = abs(page.rect)
        if not area:
            return False
        try:
            infos = page.get_image_info()
        except Exception:
            return False
        return any(abs(fitz.Rect(i["bbox"]) & page.rect) / area >= min_cover for i in infos)

    # ---- per page -----------------------------------------------------------
    @staticmethod
    def _lines_from_words(words: list[tuple]) -> str:
        """Rebuild reading-order text from PyMuPDF word tuples of one column.

        Words are grouped by their (block, line) ids, lines sorted top→bottom
        (then left→right) — this also splits vendor-OCR lines that were merged
        across both columns.
        """
        lines: dict[tuple[int, int], list[tuple]] = {}
        for w in words:
            lines.setdefault((w[5], w[6]), []).append(w)
        ordered = sorted(
            lines.values(), key=lambda ws: (round(min(w[1] for w in ws) / 3), min(w[0] for w in ws))
        )
        return "\n".join(" ".join(w[4] for w in sorted(ws, key=lambda w: w[0])) for ws in ordered)

    def parse_page(self, page: fitz.Page) -> PageExtraction:
        rect = page.rect
        result = PageExtraction(page_no=page.number + 1)
        # Text blocks (type 0) give the coarse layout; words give precise column assignment.
        blocks = [b for b in page.get_text("blocks", sort=True) if b[6] == 0 and not _is_noise(b[4])]
        total_chars = sum(len(b[4].strip()) for b in blocks)

        # Page with (almost) no text layer -> full-page OCR with automatic segmentation.
        if total_chars < self.min_chars and self.ocr_mode != "never":
            text = self._ocr(page, None, psm=3)
            if text is not None:
                result.columns.append(ColumnText("FULL", text, "OCR", text_quality(text)))
                return result

        words = [w for w in page.get_text("words") if w[4].strip()]
        scanned = self.is_scanned(page)
        gutter = detect_gutter(blocks, rect.width) or detect_gutter(words, rect.width, max_cross_ratio=0.04)
        if gutter is None:
            text = self._lines_from_words(words)
            need, q = self._needs_ocr(text, scanned)
            if need and (ocr := self._ocr(page, None, psm=3)) is not None:
                result.columns.append(ColumnText("FULL", ocr, "OCR", text_quality(ocr)))
            else:
                result.columns.append(ColumnText("FULL", text, "TEXT", q))
            return result

        result.two_column = True
        left_w = [w for w in words if (w[0] + w[2]) / 2 < gutter]
        right_w = [w for w in words if (w[0] + w[2]) / 2 >= gutter]
        col_top = min((w[1] for w in words), default=rect.y0)
        clips = {
            "LEFT": fitz.Rect(rect.x0, max(col_top - 4, rect.y0), gutter + 2, rect.y1),
            "RIGHT": fitz.Rect(gutter - 2, max(col_top - 4, rect.y0), rect.x1, rect.y1),
        }
        texts = {"LEFT": self._lines_from_words(left_w), "RIGHT": self._lines_from_words(right_w)}
        qualities = {name: self._needs_ocr(t, scanned) for name, t in texts.items()}
        for name, text in texts.items():
            need, q = qualities[name]
            other_name = "RIGHT" if name == "LEFT" else "LEFT"
            other = qualities[other_name][1]
            other_text = texts[other_name]
            # Fast-path in 'auto' mode: if the sibling column already has a clean, substantial
            # text layer (e.g. clean English column while Hindi column has garbled vendor OCR),
            # skip slow 300-DPI subprocess OCR on the garbled column because the LLM normalizer
            # generates verified bilingual EN+HI directly from the clean column.
            if (
                need
                and self.ocr_mode == "auto"
                and other >= 0.78
                and len(other_text.strip()) >= 120
                and self._has_balanced_options(other_text)
            ):
                need = False
            # A column whose text layer is already clean English is OCR'd with 'eng' only
            # (avoids spurious Devanagari); everything else uses the configured hin+eng.
            lang = "eng" if (q >= 0.8 and not _DEVANAGARI.search(text)) else None
            if need and (ocr := self._ocr(page, clips[name], lang=lang)) is not None:
                log.debug("Page %d %s column re-OCR'd (text-layer quality %.2f)", result.page_no, name, q)
                result.columns.append(ColumnText(name, ocr, "OCR", text_quality(ocr)))
            else:
                result.columns.append(ColumnText(name, text, "TEXT", q))
        return result

    # ---- whole document -----------------------------------------------------
    def parse(self, pdf_path: str | Path, pages: list[int] | None = None, progress=None) -> list[PageExtraction]:
        """Parse a PDF. ``pages`` = optional 1-based page numbers. ``progress(i, n)`` callback."""
        doc = fitz.open(pdf_path)
        try:
            selected = [p - 1 for p in pages] if pages else list(range(doc.page_count))
            results = []
            for i, pno in enumerate(selected):
                try:
                    results.append(self.parse_page(doc[pno]))
                except Exception as exc:  # keep going; one bad page should not kill a paper
                    log.exception("Failed to parse page %d of %s: %s", pno + 1, pdf_path, exc)
                if progress:
                    progress(i + 1, len(selected))
        finally:
            doc.close()

        repeated = find_repeated_lines([[l for c in r.columns for l in c.text.splitlines()] for r in results])
        if repeated:
            log.debug("Removing repeated header/footer lines: %s", sorted(repeated)[:10])
        for r in results:
            for c in r.columns:
                c.text = _clean_column(c.text, repeated)
        return results


# --------------------------------------------------------------------------- #
# Chunking for the LLM
# --------------------------------------------------------------------------- #
LOOKAHEAD_MARK = "[LOOKAHEAD — start of next page; use ONLY to finish a question cut off above]"


def build_chunks(pages: list[PageExtraction], max_chars: int | None = None, lookahead_chars: int = 700) -> list[dict]:
    """Group question pages into chunks <= ``max_chars`` (page-aligned, so the
    English column and its parallel Hindi column always travel together)."""
    max_chars = max_chars or settings.chunk_max_chars
    qpages = [p for p in pages if p.looks_like_questions]
    skipped = [p.page_no for p in pages if not p.looks_like_questions]
    if skipped:
        log.info("Skipping non-question pages (instructions/blank): %s", skipped)

    groups: list[list[PageExtraction]] = []
    cur: list[PageExtraction] = []
    size = 0
    for p in qpages:
        t = len(p.text)
        if cur and size + t > max_chars:
            groups.append(cur)
            cur, size = [], 0
        cur.append(p)
        size += t
    if cur:
        groups.append(cur)

    chunks = []
    for idx, grp in enumerate(groups):
        body = "\n\n".join(f"### PAGE {p.page_no}\n{p.text}" for p in grp)
        if idx + 1 < len(groups):
            nxt = groups[idx + 1][0]
            heads = [
                f"[{c.name} COLUMN]\n{c.text[:lookahead_chars]}" if c.name in ("LEFT", "RIGHT") else c.text[:lookahead_chars]
                for c in nxt.columns
                if c.name in ("LEFT", "RIGHT", "FULL") and c.text
            ]
            if heads:
                body += f"\n\n{LOOKAHEAD_MARK}\n" + "\n".join(heads)
        methods = {p.method for p in grp}
        chunks.append(
            {
                "chunk_index": idx,
                "page_start": grp[0].page_no,
                "page_end": grp[-1].page_no,
                "text": body,
                "extraction_method": methods.pop() if len(methods) == 1 else "MIXED",
            }
        )
    return chunks
