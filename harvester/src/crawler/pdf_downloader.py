"""Resilient, memory-friendly PDF download manager.

* streams with ``iter_bytes`` into a ``.part`` file (constant memory)
* SHA256 is computed while streaming; identical content is stored once
* a URL manifest (``data/raw/pdfs/manifest.json``) skips URLs fetched before
* retries with exponential backoff via :class:`BaseCrawler` policies
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse

import httpx

from config import RAW_PDF_DIR, settings
from src.crawler.base_crawler import RETRYABLE_STATUS, BaseCrawler, FetchError

log = logging.getLogger(__name__)

MANIFEST_PATH = RAW_PDF_DIR / "manifest.json"
_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass
class DownloadResult:
    url: str
    path: str
    sha256: str
    size: int
    skipped: bool = False  # True if served from manifest / duplicate content
    reason: str = ""


def safe_filename(name: str, max_len: int = 120) -> str:
    name = _SAFE.sub("_", name).strip("._") or "file"
    return name[:max_len]


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


class Manifest:
    """Tiny JSON-backed index: url -> {sha256, path, size}; sha256 -> path."""

    def __init__(self, path: Path = MANIFEST_PATH):
        self.path = path
        self._lock = asyncio.Lock()
        self.data: dict = {"urls": {}, "hashes": {}}
        if path.exists():
            try:
                self.data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                log.warning("Corrupt manifest %s, starting fresh", path)

    def by_url(self, url: str) -> dict | None:
        rec = self.data["urls"].get(url)
        if rec and Path(rec["path"]).exists():
            return rec
        return None

    def by_hash(self, sha: str) -> str | None:
        p = self.data["hashes"].get(sha)
        return p if p and Path(p).exists() else None

    async def record(self, res: DownloadResult) -> None:
        async with self._lock:
            self.data["urls"][res.url] = {"sha256": res.sha256, "path": res.path, "size": res.size}
            self.data["hashes"].setdefault(res.sha256, res.path)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp.replace(self.path)


class PDFDownloader:
    def __init__(self, crawler: BaseCrawler, dest_dir: Path = RAW_PDF_DIR, manifest: Manifest | None = None):
        self.crawler = crawler
        self.dest_dir = dest_dir
        self.manifest = manifest or Manifest()

    def _target_name(self, url: str, hint: str | None) -> str:
        base = hint or Path(unquote(urlparse(url).path)).stem or "document"
        return safe_filename(base) + ".pdf"

    async def download(
        self,
        url: str,
        *,
        filename_hint: str | None = None,
        force: bool = False,
        referer: str | None = None,
        year: int | str | None = None,
    ) -> DownloadResult:
        """Stream ``url`` to disk. ``referer`` mimics clicking the link on its listing page
        (some portals, e.g. UPPSC ``Open_PDF.aspx``, only serve files from their own pages)."""
        if not force and (rec := self.manifest.by_url(url)):
            log.info("Skip (already downloaded): %s", url)
            return DownloadResult(url, rec["path"], rec["sha256"], rec["size"], skipped=True, reason="manifest")

        target_dir = self.dest_dir / str(year) if year else self.dest_dir
        target_dir.mkdir(parents=True, exist_ok=True)
        final = target_dir / self._target_name(url, filename_hint)
        part = final.with_suffix(".pdf.part")
        last_exc: Exception | None = None

        for attempt in range(1, settings.http_max_retries + 1):
            await self.crawler._polite_wait(url)
            h = hashlib.sha256()
            size = 0
            try:
                async with self.crawler._sem:
                    headers = self.crawler.headers({"Referer": referer} if referer else None)
                    async with self.crawler.client.stream("GET", url, headers=headers) as resp:
                        if resp.status_code in RETRYABLE_STATUS:
                            raise FetchError(f"HTTP {resp.status_code}")
                        if resp.status_code >= 400:
                            raise PermissionError(f"HTTP {resp.status_code} for {url}")
                        with part.open("wb") as f:
                            first = True
                            async for chunk in resp.aiter_bytes(chunk_size=64 * 1024):
                                if first:
                                    if not chunk.lstrip()[:5].startswith(b"%PDF"):
                                        ctype = resp.headers.get("content-type", "?")
                                        raise ValueError(f"Not a PDF (content-type={ctype}) at {url}")
                                    first = False
                                f.write(chunk)
                                h.update(chunk)
                                size += len(chunk)
                break
            except (PermissionError, ValueError) as exc:  # non-retryable
                part.unlink(missing_ok=True)
                raise FetchError(str(exc)) from exc
            except (httpx.TransportError, httpx.TimeoutException, FetchError) as exc:
                last_exc = exc
                part.unlink(missing_ok=True)
                wait = BaseCrawler._backoff(attempt)
                log.warning("Download %s failed (%s); retry %d in %.1fs", url, exc, attempt, wait)
                await asyncio.sleep(wait)
        else:
            raise FetchError(f"Download failed after retries: {url}: {last_exc}")

        sha = h.hexdigest()
        if existing := self.manifest.by_hash(sha):
            part.unlink(missing_ok=True)
            res = DownloadResult(url, existing, sha, size, skipped=True, reason="duplicate-content")
            log.info("Duplicate content for %s -> %s", url, existing)
        else:
            if final.exists() and sha256_file(final) != sha:
                final = final.with_name(f"{final.stem}_{sha[:8]}.pdf")
            part.replace(final)
            res = DownloadResult(url, str(final), sha, size)
            log.info("Downloaded %s (%.1f KB) -> %s", url, size / 1024, final.name)
        await self.manifest.record(res)
        return res

    async def download_many(
        self, items: list[tuple[str, str | None]], referer: str | None = None
    ) -> list[DownloadResult | Exception]:
        """Download ``[(url, filename_hint), ...]`` concurrently (bounded by crawler semaphore)."""
        tasks = [self.download(u, filename_hint=h, referer=referer) for u, h in items]
        return await asyncio.gather(*tasks, return_exceptions=True)


def result_as_dict(r: DownloadResult) -> dict:
    return asdict(r)
