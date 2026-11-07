"""PyMuPDF -> image -> Tesseract bilingual (Hindi + English) OCR."""
from __future__ import annotations

import logging
import os
import shutil
from functools import lru_cache
from pathlib import Path

import pymupdf as fitz
from PIL import Image

from config import BASE_DIR, settings

log = logging.getLogger(__name__)

_WINDOWS_DEFAULTS = (
    Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
    Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
    Path(os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe")),
)
_LOCAL_TESSDATA = BASE_DIR / "tessdata"


class OCRUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _configure() -> str | None:
    """Locate the tesseract binary and tessdata dir. Returns binary path or None."""
    import pytesseract

    cmd = settings.tesseract_cmd or shutil.which("tesseract")
    if not cmd:
        cmd = next((str(p) for p in _WINDOWS_DEFAULTS if p.exists()), None)
    if not cmd:
        log.warning("Tesseract binary not found; OCR fallback disabled")
        return None
    pytesseract.pytesseract.tesseract_cmd = cmd
    # Prefer explicit env, else a project-local ./tessdata (lets us ship hin.traineddata without admin rights).
    if settings.tessdata_prefix:
        os.environ["TESSDATA_PREFIX"] = settings.tessdata_prefix
    elif (_LOCAL_TESSDATA / "hin.traineddata").exists():
        os.environ["TESSDATA_PREFIX"] = str(_LOCAL_TESSDATA)
    return cmd


def is_available() -> bool:
    return _configure() is not None


@lru_cache(maxsize=1)
def available_languages() -> frozenset[str]:
    if not is_available():
        return frozenset()
    import pytesseract

    try:
        return frozenset(pytesseract.get_languages(config=""))
    except Exception as exc:  # pragma: no cover - environment specific
        log.warning("Could not list tesseract languages: %s", exc)
        return frozenset()


def resolve_languages(requested: str | None = None) -> str:
    """Drop language packs that are not installed (warns once), keep order."""
    requested = requested or settings.ocr_languages
    have = available_languages()
    langs = [l for l in requested.split("+") if l in have]
    missing = [l for l in requested.split("+") if l not in have]
    if missing:
        log.warning("Tesseract language pack(s) missing: %s (installed: %s)", missing, sorted(have))
    if not langs:
        raise OCRUnavailable(f"None of the OCR languages {requested!r} are installed")
    return "+".join(langs)


def render_image(page: fitz.Page, clip: fitz.Rect | None = None, dpi: int | None = None) -> Image.Image:
    """Render a page (or clip region) to a grayscale PIL image."""
    pix = page.get_pixmap(dpi=dpi or settings.ocr_dpi, clip=clip, colorspace=fitz.csGRAY, alpha=False)
    return Image.frombytes("L", (pix.width, pix.height), pix.samples)


def ocr_page(
    page: fitz.Page,
    clip: fitz.Rect | None = None,
    *,
    lang: str | None = None,
    dpi: int | None = None,
    psm: int = 4,
) -> str:
    """OCR a page / region. ``psm 4`` = single column of variable-size text (best for exam columns)."""
    if not is_available():
        raise OCRUnavailable("Tesseract is not installed or not on PATH (set TESSERACT_CMD)")
    import pytesseract

    img = render_image(page, clip, dpi)
    text = pytesseract.image_to_string(img, lang=resolve_languages(lang), config=f"--oem 1 --psm {psm}")
    log.debug("OCR page %d clip=%s -> %d chars", page.number + 1, clip, len(text))
    return text
