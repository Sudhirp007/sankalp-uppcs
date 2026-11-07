"""Internet Discovery & Fallback Strategy for Missing Answer Keys.

Searches across accredited educational archives, state PSC coaching repositories
(Drishti IAS, Dhyeya, Youth Competition Times, SSGCP archives, Jagran Josh),
downloads independent keys, and prepares them for multi-source consensus cross-verification.
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urlparse

import httpx

from config import RAW_KEY_DIR, settings
from src.crawler.base_crawler import BaseCrawler
from src.parsers.pdf_column_parser import PDFColumnParser
from src.reconciliation.consensus_engine import SourceAnswer

log = logging.getLogger(__name__)

REPUTABLE_SOURCES = (
    "drishtiias.com",
    "dhyeyaias.com",
    "ssgcp.com",
    "youthcompetitiontimes.com",
    "jagranjosh.com",
    "testbook.com",
)


@dataclass
class DiscoveredKey:
    paper_id: str
    source_name: str
    source_url: str
    source_type: str  # THIRD_PARTY | OFFICIAL_PROVISIONAL | OFFICIAL_FINAL
    local_path: Optional[str] = None
    answers: Dict[int, str] = None  # qno -> option (A/B/C/D/X)


class KeyDiscoveryEngine:
    def __init__(self, key_dir: Path = RAW_KEY_DIR):
        self.key_dir = key_dir
        self.key_dir.mkdir(parents=True, exist_ok=True)

    def generate_search_queries(self, exam_name: str, year: int, paper_name: str, series: Optional[str] = None) -> List[str]:
        """Construct targeted discovery queries across accredited portals."""
        series_str = f"Series {series}" if series else ""
        return [
            f"{exam_name} {year} {paper_name} official answer key pdf {series_str}".strip(),
            f"Drishti IAS {exam_name} {year} {paper_name} answer key pdf {series_str}".strip(),
            f"Dhyeya IAS {exam_name} {year} {paper_name} answer key {series_str}".strip(),
            f"{exam_name} {year} solved question paper answer key pdf".strip(),
        ]

    def save_third_party_key(
        self,
        paper_id: str,
        source_name: str,
        answers: Dict[int, str],
        source_url: str = "",
        source_type: str = "THIRD_PARTY",
    ) -> Path:
        """Store a structured third-party answer key to disk."""
        target_dir = self.key_dir / paper_id
        target_dir.mkdir(parents=True, exist_ok=True)
        key_file = target_dir / f"{source_name.lower().replace(' ', '_')}.json"

        payload = {
            "paper_id": paper_id,
            "source_name": source_name,
            "source_type": source_type,
            "source_url": source_url,
            "answers": {str(k): v for k, v in answers.items()},
        }
        key_file.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        log.info("Saved %s key (%d answers) to %s", source_name, len(answers), key_file)
        return key_file

    def load_keys_for_paper(self, paper_id: str) -> List[DiscoveredKey]:
        """Load all discovered/stored keys for a paper from local disk."""
        target_dir = self.key_dir / paper_id
        if not target_dir.exists():
            return []

        keys = []
        for file in target_dir.glob("*.json"):
            try:
                data = json.loads(file.read_text(encoding="utf-8"))
                answers = {int(k): v.upper() for k, v in data.get("answers", {}).items()}
                keys.append(
                    DiscoveredKey(
                        paper_id=paper_id,
                        source_name=data.get("source_name", file.stem),
                        source_url=data.get("source_url", ""),
                        source_type=data.get("source_type", "THIRD_PARTY"),
                        local_path=str(file),
                        answers=answers,
                    )
                )
            except Exception as exc:
                log.warning("Could not read key file %s: %s", file, exc)
        return keys

    def to_source_answer_map(self, keys: List[DiscoveredKey]) -> Dict[int, List[SourceAnswer]]:
        """Transform loaded keys into {qno: [SourceAnswer, ...]} for ConsensusEngine."""
        out: Dict[int, List[SourceAnswer]] = {}
        for k in keys:
            for qno, opt in k.answers.items():
                out.setdefault(qno, []).append(
                    SourceAnswer(
                        source_name=k.source_name,
                        source_type=k.source_type,
                        correct_option=opt,
                    )
                )
        return out
