"""Central configuration: filesystem paths, API credentials, and tuning knobs.

All secrets are read from the environment (optionally via a local ``.env`` file).
Nothing sensitive is hard-coded here.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
RAW_PDF_DIR = RAW_DIR / "pdfs"
RAW_KEY_DIR = RAW_DIR / "keys"
RAW_HTML_DIR = RAW_DIR / "html"
PROCESSED_DIR = DATA_DIR / "processed"
EXPORTS_DIR = DATA_DIR / "exports"
LOG_DIR = DATA_DIR / "logs"
MANIFEST_DIR = DATA_DIR / "manifests"

ALL_DIRS = (RAW_PDF_DIR, RAW_KEY_DIR, RAW_HTML_DIR, PROCESSED_DIR, EXPORTS_DIR, LOG_DIR, MANIFEST_DIR)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


DEFAULT_USER_AGENTS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.6 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
)


@dataclass(frozen=True)
class Settings:
    # Database
    db_url: str = os.getenv("HARVESTER_DB_URL", f"sqlite:///{(DATA_DIR / 'harvester.db').as_posix()}")

    # Gemini (structured normalisation)
    gemini_api_key: str | None = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    gemini_rpm: int = _env_int("GEMINI_RPM", 10)  # requests per minute (free tier safe default)
    gemini_max_retries: int = _env_int("GEMINI_MAX_RETRIES", 5)
    gemini_temperature: float = _env_float("GEMINI_TEMPERATURE", 0.1)

    # Crawler
    http_timeout: float = _env_float("HTTP_TIMEOUT", 60.0)
    http_max_retries: int = _env_int("HTTP_MAX_RETRIES", 5)
    request_delay_min: float = _env_float("REQUEST_DELAY_MIN", 1.5)
    request_delay_max: float = _env_float("REQUEST_DELAY_MAX", 3.0)
    download_concurrency: int = _env_int("DOWNLOAD_CONCURRENCY", 2)
    user_agents: tuple[str, ...] = field(default=DEFAULT_USER_AGENTS)

    # PDF / OCR
    tesseract_cmd: str | None = os.getenv("TESSERACT_CMD")
    tessdata_prefix: str | None = os.getenv("TESSDATA_PREFIX")
    ocr_languages: str = os.getenv("OCR_LANGUAGES", "hin+eng")
    ocr_dpi: int = _env_int("OCR_DPI", 300)
    ocr_min_chars: int = _env_int("OCR_MIN_CHARS", 100)
    chunk_max_chars: int = _env_int("CHUNK_MAX_CHARS", 3500)


settings = Settings()


def ensure_dirs() -> None:
    """Create every data directory the pipeline writes to (idempotent)."""
    for d in ALL_DIRS:
        d.mkdir(parents=True, exist_ok=True)


def setup_logging(level: str | int | None = None) -> None:
    """Log to ``data/logs/harvester.log`` (file) — the CLI adds a rich console handler."""
    ensure_dirs()
    level = level or os.getenv("LOG_LEVEL", "INFO")
    root = logging.getLogger()
    if any(getattr(h, "_harvester", False) for h in root.handlers):
        return
    fh = logging.FileHandler(LOG_DIR / "harvester.log", encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s"))
    fh._harvester = True  # type: ignore[attr-defined]
    root.addHandler(fh)
    root.setLevel(level)
    # Third-party libraries are noisy at INFO.
    for noisy in ("httpx", "httpcore", "google_genai", "urllib3", "pdfminer"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
