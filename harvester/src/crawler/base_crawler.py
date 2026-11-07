"""Async HTTP client with user-agent rotation, polite delays and exponential backoff."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import random
from pathlib import Path
from urllib.parse import urlparse

import httpx

from config import RAW_HTML_DIR, settings

log = logging.getLogger(__name__)

RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}


class FetchError(RuntimeError):
    pass


class BaseCrawler:
    """Thin, polite wrapper around ``httpx.AsyncClient``.

    * rotates realistic user agents per request
    * sleeps a random 1.5–3s (configurable) between requests to the same host
    * retries transient errors with exponential backoff + jitter
    * honours ``Retry-After`` on 429/503
    """

    def __init__(self, *, concurrency: int | None = None, verify: bool = True):
        self._sem = asyncio.Semaphore(concurrency or settings.download_concurrency)
        self._client: httpx.AsyncClient | None = None
        self._verify = verify
        self._last_hit: dict[str, float] = {}
        self._host_locks: dict[str, asyncio.Lock] = {}

    async def __aenter__(self) -> "BaseCrawler":
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(settings.http_timeout, connect=20.0),
            follow_redirects=True,
            verify=self._verify,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8",
                "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
            },
        )
        return self

    async def __aexit__(self, *exc) -> None:
        if self._client:
            await self._client.aclose()

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            raise RuntimeError("Use 'async with' to open the crawler")
        return self._client

    def headers(self, extra: dict | None = None) -> dict:
        h = {"User-Agent": random.choice(settings.user_agents)}
        if extra:
            h.update(extra)
        return h

    async def _polite_wait(self, url: str) -> None:
        host = urlparse(url).netloc
        lock = self._host_locks.setdefault(host, asyncio.Lock())
        async with lock:
            loop = asyncio.get_running_loop()
            delay = random.uniform(settings.request_delay_min, settings.request_delay_max)
            elapsed = loop.time() - self._last_hit.get(host, 0.0)
            if elapsed < delay:
                await asyncio.sleep(delay - elapsed)
            self._last_hit[host] = loop.time()

    @staticmethod
    def _backoff(attempt: int, retry_after: str | None = None) -> float:
        if retry_after:
            try:
                return min(float(retry_after), 120.0)
            except ValueError:
                pass
        return min(2**attempt + random.uniform(0, 1.0), 60.0)

    async def request(self, method: str, url: str, **kwargs) -> httpx.Response:
        """Perform a request with retries. Raises ``FetchError`` when exhausted."""
        last_exc: Exception | None = None
        extra_headers = kwargs.pop("headers", None)
        for attempt in range(1, settings.http_max_retries + 1):
            async with self._sem:
                await self._polite_wait(url)
                try:
                    resp = await self.client.request(method, url, headers=self.headers(extra_headers), **kwargs)
                except (httpx.TransportError, httpx.TimeoutException) as exc:
                    last_exc = exc
                    wait = self._backoff(attempt)
                    log.warning("%s %s failed (%s), retry %d in %.1fs", method, url, exc, attempt, wait)
                else:
                    if resp.status_code < 400:
                        return resp
                    if resp.status_code not in RETRYABLE_STATUS:
                        raise FetchError(f"{method} {url} -> HTTP {resp.status_code}")
                    last_exc = FetchError(f"HTTP {resp.status_code}")
                    wait = self._backoff(attempt, resp.headers.get("Retry-After"))
                    log.warning("%s %s -> %d, retry %d in %.1fs", method, url, resp.status_code, attempt, wait)
            await asyncio.sleep(wait)
        raise FetchError(f"{method} {url} failed after {settings.http_max_retries} attempts: {last_exc}")

    async def get(self, url: str, **kwargs) -> httpx.Response:
        return await self.request("GET", url, **kwargs)

    async def post(self, url: str, **kwargs) -> httpx.Response:
        return await self.request("POST", url, **kwargs)


def html_snapshot_path(url: str, html: str) -> Path:
    """``data/raw/html/<domain>/<sha256-of-content>.html``"""
    domain = urlparse(url).netloc.replace(":", "_") or "unknown"
    digest = hashlib.sha256(html.encode("utf-8", "ignore")).hexdigest()[:24]
    return RAW_HTML_DIR / domain / f"{digest}.html"


def save_html_snapshot(url: str, html: str) -> Path:
    path = html_snapshot_path(url, html)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(html, encoding="utf-8")
        log.info("Saved HTML snapshot %s (%s)", path.name, url)
    return path


async def fetch_rendered_html(url: str, *, wait_selector: str | None = None, timeout_ms: int = 45000) -> str:
    """Render a JS-heavy page with headless Chromium, blocking heavy/irrelevant assets.

    Requires ``playwright install chromium`` once.
    """
    from playwright.async_api import async_playwright  # local import: optional heavy dep

    blocked_types = {"image", "font", "media", "stylesheet"}
    blocked_hosts = ("google-analytics", "googletagmanager", "doubleclick", "facebook", "hotjar")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            ctx = await browser.new_context(user_agent=random.choice(settings.user_agents))
            page = await ctx.new_page()

            async def _filter(route):
                req = route.request
                if req.resource_type in blocked_types or any(h in req.url for h in blocked_hosts):
                    await route.abort()
                else:
                    await route.continue_()

            await page.route("**/*", _filter)
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            if wait_selector:
                await page.wait_for_selector(wait_selector, timeout=timeout_ms)
            else:
                await page.wait_for_load_state("networkidle", timeout=timeout_ms)
            html = await page.content()
        finally:
            await browser.close()
    save_html_snapshot(url, html)
    return html
