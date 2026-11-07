"""Portal cataloger & audit manifest generator for UPPSC papers and answer keys."""
from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from config import MANIFEST_DIR, settings
from src.crawler.base_crawler import BaseCrawler
from src.crawler.site_scrapers.uppsc import UPPSCScraper
from src.storage import database as db
from src.storage.models import ExamPaper

log = logging.getLogger(__name__)

AUDIT_MANIFEST_PATH = MANIFEST_DIR / "audit_manifest.json"
_SLUG = re.compile(r"[^a-z0-9]+")


def slugify(*parts) -> str:
    return _SLUG.sub("_", "_".join(str(p) for p in parts if p not in (None, "")).lower()).strip("_")[:120]


@dataclass
class PaperAuditRecord:
    paper_id: str
    exam_name: str
    paper_name: str
    stage: str
    year: int | None
    series: str | None
    source_url: str
    local_file_path: str | None
    file_sha256: str | None
    document_type: str
    has_official_key: bool
    key_source_type: str | None  # OFFICIAL_FINAL | OFFICIAL_PROVISIONAL | THIRD_PARTY_CONSENSUS | NONE
    status: str  # DOWNLOADED | CATALOGED | MISSING_KEY | COMPLETE
    scanned_at: str


async def scan_and_catalog_portal(
    *,
    exam_filter: str | None = "UPPCS",
    years: list[int] | None = None,
    save_manifest: bool = True,
) -> dict:
    """Crawl UPPSC previous question paper archives across all years and generate the audit manifest."""
    db.init_db()
    async with BaseCrawler() as crawler:
        scraper = UPPSCScraper(crawler)
        portal_years = await scraper.available_years()
        target_years = [y for y in portal_years if not years or y in years]
        log.info("Cataloging UPPSC portal for years: %s", target_years)
        
        all_papers = await scraper.list_papers(years=target_years)

    records: list[PaperAuditRecord] = []
    now = datetime.now().isoformat(timespec="seconds")

    with db.session_scope() as s:
        for p in all_papers:
            if exam_filter and not p.matches(exam_filter, None, None):
                continue

            stage = p.stage
            paper_id = f"uppsc_{p.year or 'unknown'}_{p.stage.lower()}_{slugify(p.paper, p.series)}"
            existing_paper = s.get(ExamPaper, paper_id) or db.get_paper_by_sha(s, p.url)

            has_key = bool(existing_paper and existing_paper.has_official_key)
            local_path = existing_paper.local_file_path if existing_paper else None
            sha = existing_paper.file_sha256 if existing_paper else None

            status = "COMPLETE" if (local_path and has_key) else ("DOWNLOADED" if local_path else "MISSING_KEY")

            rec = PaperAuditRecord(
                paper_id=paper_id,
                exam_name=p.title.split("(")[0].strip() or "UPPCS",
                paper_name=p.title,
                stage=stage,
                year=p.year,
                series=p.series,
                source_url=p.url,
                local_file_path=local_path,
                file_sha256=sha,
                document_type="QUESTION_PAPER",
                has_official_key=has_key,
                key_source_type="OFFICIAL_FINAL" if has_key else "NONE",
                status=status,
                scanned_at=now,
            )
            records.append(rec)

    manifest_data = {
        "generated_at": now,
        "portal": "https://uppsc.up.nic.in",
        "exam_filter": exam_filter,
        "total_cataloged": len(records),
        "downloaded_count": sum(1 for r in records if r.local_file_path),
        "missing_key_count": sum(1 for r in records if not r.has_official_key),
        "papers": [asdict(r) for r in records],
    }

    if save_manifest:
        AUDIT_MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
        AUDIT_MANIFEST_PATH.write_text(json.dumps(manifest_data, indent=2, ensure_ascii=False), encoding="utf-8")
        log.info("Saved audit manifest with %d papers to %s", len(records), AUDIT_MANIFEST_PATH)

    return manifest_data
