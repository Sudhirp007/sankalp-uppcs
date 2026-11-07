"""High-level pipeline steps used by the CLI (and usable from notebooks / jobs)."""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from config import MANIFEST_DIR, PROCESSED_DIR, RAW_PDF_DIR
from src.crawler.base_crawler import BaseCrawler, fetch_rendered_html, save_html_snapshot
from src.crawler.pdf_downloader import PDFDownloader, sha256_file
from src.crawler.site_scrapers.uppsc import UPPSCScraper
from src.normalizer.quality_gate import (
    classify_review_status,
    evaluate_question_quality,
    infer_question_page,
    parse_options_json,
)
from src.normalizer.schema import ParsedMCQ
from src.parsers.html_parser import extract_pdf_links, extract_question_cards
from src.parsers.pdf_column_parser import PDFColumnParser, build_chunks
from src.storage import database as db
from src.storage.deduplicator import content_hash
from src.storage.models import AnswerKeyEntry, ExamPaper, Question, RawChunk, StagedQuestion, utcnow

log = logging.getLogger(__name__)

_SLUG = re.compile(r"[^a-z0-9]+")


def slugify(*parts) -> str:
    return _SLUG.sub("_", "_".join(str(p) for p in parts if p not in (None, "")).lower()).strip("_")[:120]


def guess_document_type(title: str) -> str:
    t = title.lower()
    return "ANSWER_KEY" if ("answer key" in t or "answer-key" in t or "उत्तर कुंजी" in t) else "QUESTION_PAPER"


def _is_direct_pdf(url: str) -> bool:
    path = urlparse(url).path.lower()
    return path.endswith(".pdf") or "open_pdf.aspx" in path


# --------------------------------------------------------------------------- #
# 1. Download
# --------------------------------------------------------------------------- #
@dataclass
class DownloadSummary:
    listed: int = 0
    downloaded: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)
    papers: list[str] = field(default_factory=list)


CHECKPOINT_PATH = MANIFEST_DIR / "harvest_checkpoint.json"


def save_checkpoint(status: str, roadblock: str | None = None, extra: dict | None = None) -> Path:
    """Persist current pipeline progress and roadblocks so any next run resumes cleanly."""
    db.init_db()
    with db.session_scope() as s:
        stats = db.collect_stats(s)
        all_papers = s.query(ExamPaper).all()
        chunk_pids = {r[0] for r in s.query(RawChunk.paper_id).distinct().all()}
        by_year: dict[str, dict[str, int]] = {}
        for p in all_papers:
            y = str(p.year or "unknown")
            rec = by_year.setdefault(y, {"downloaded": 0, "parsed": 0, "unparsed": 0})
            if p.local_file_path and Path(p.local_file_path).exists():
                rec["downloaded"] += 1
            if p.id in chunk_pids:
                rec["parsed"] += 1
            else:
                rec["unparsed"] += 1

    payload = {
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "status": status,
        "roadblock": roadblock,
        "totals": {
            "papers_registered": stats["papers"],
            "questions_enriched": stats["questions"],
            "chunks_by_status": stats["chunks_by_status"],
        },
        "papers_by_year": dict(sorted(by_year.items(), reverse=True)),
        "resume_command": ".\\.venv\\Scripts\\python.exe -m src.cli harvest --limit-chunks 250 --concurrency 4",
    }
    if extra:
        payload["last_step_summary"] = extra
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    CHECKPOINT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return CHECKPOINT_PATH


def _register_paper(*, paper_id, exam_name, paper_name, year, url, res, series=None, stage=None, doc_type="QUESTION_PAPER"):
    with db.session_scope() as s:
        existing = db.get_paper_by_sha(s, res.sha256)
        if existing and existing.id != paper_id:
            log.info("Same file already registered as %s; skipping %s", existing.id, paper_id)
            return existing.id
        db.upsert_paper(
            s,
            id=paper_id,
            exam_name=exam_name,
            paper_name=paper_name,
            year=year,
            stage=stage,
            source_url=url,
            local_file_path=res.path,
            file_sha256=res.sha256,
            series=series,
            document_type=doc_type,
        )
        return paper_id


async def download(
    url: str,
    *,
    exam: str | None = None,
    year: int | None = None,
    stage: str | None = None,
    limit: int | None = None,
    render_js: bool = False,
    dry_run: bool = False,
    progress=None,
) -> DownloadSummary:
    """Download PDFs from a direct link, the UPPSC listing page, or any HTML page with PDF links."""
    db.init_db()
    summary = DownloadSummary()
    async with BaseCrawler() as crawler:
        downloader = PDFDownloader(crawler, RAW_PDF_DIR)
        jobs: list[dict] = []

        if _is_direct_pdf(url):
            name = Path(urlparse(url).path).stem
            jobs.append(dict(url=url, title=name, exam_name=exam or "Unknown", paper_name=name, year=year))
        elif "uppsc.up.nic.in" in url:
            scraper = UPPSCScraper(crawler, url)
            rows = await scraper.list_papers(years=[year] if year else None)
            rows = [r for r in rows if r.matches(exam, year, stage)]
            for r in rows:
                jobs.append(
                    dict(
                        url=r.url,
                        title=r.title,
                        exam_name=r.title.split("(")[0].strip() if exam is None else exam,
                        paper_name=r.title,
                        year=r.year or r.listing_year,
                        stage=r.stage,
                        series=r.series,
                        referer=url,
                    )
                )
        else:
            html = await fetch_rendered_html(url) if render_js else (await crawler.get(url)).text
            save_html_snapshot(url, html)
            links = extract_pdf_links(html, url)
            if exam:
                links = [(u, t) for u, t in links if exam.lower() in t.lower() or exam.lower() in u.lower()] or links
            for u, t in links:
                jobs.append(dict(url=u, title=t or Path(urlparse(u).path).stem, exam_name=exam or "Unknown",
                                 paper_name=t or Path(urlparse(u).path).stem, year=year, referer=url))
            cards = extract_question_cards(html)
            if cards:
                log.info("Found %d HTML question cards on %s (use 'parse-html' to ingest)", len(cards), url)

        if limit:
            jobs = jobs[:limit]
        summary.listed = len(jobs)
        if dry_run:
            summary.papers = [f"{j['year']} | {j['title']} | {j['url']}" for j in jobs]
            return summary

        for i, j in enumerate(jobs, 1):
            paper_id = slugify(exam or "paper", j.get("year"), j["paper_name"], j.get("series"))
            try:
                res = await downloader.download(
                    j["url"], filename_hint=paper_id, referer=j.get("referer"), year=j.get("year")
                )
            except Exception as exc:
                log.error("Download failed %s: %s", j["url"], exc)
                summary.failed.append(f"{j['url']}: {exc}")
            else:
                summary.skipped += int(res.skipped)
                summary.downloaded += int(not res.skipped)
                pid = _register_paper(
                    paper_id=paper_id,
                    exam_name=j["exam_name"],
                    paper_name=j["paper_name"],
                    year=j.get("year"),
                    stage=j.get("stage"),
                    url=j["url"],
                    res=res,
                    series=j.get("series"),
                    doc_type=guess_document_type(j["title"]),
                )
                summary.papers.append(pid)
            if progress:
                progress(i, len(jobs))
    roadblock = "; ".join(summary.failed[:3]) if summary.failed else None
    save_checkpoint("DOWNLOAD_PARTIAL" if summary.failed else "DOWNLOAD_COMPLETE", roadblock=roadblock, extra={"downloaded": summary.downloaded, "skipped": summary.skipped, "failed": len(summary.failed)})
    return summary


# --------------------------------------------------------------------------- #
# 2. Parse PDF -> raw_chunks
# --------------------------------------------------------------------------- #
def parse_pdf(
    file: Path,
    *,
    exam_id: str | None = None,
    exam_name: str | None = None,
    paper_name: str | None = None,
    year: int | None = None,
    ocr_mode: str = "auto",
    pages: list[int] | None = None,
    progress=None,
) -> dict:
    db.init_db()
    file = file.resolve()
    sha = sha256_file(file)
    with db.session_scope() as s:
        paper = db.get_paper_by_sha(s, sha)
        if paper is None or (exam_id and paper.id != exam_id):
            paper = s.get(ExamPaper, exam_id) if exam_id else None
        if paper is None:
            paper = db.upsert_paper(
                s,
                id=exam_id or slugify(exam_name or "paper", year, file.stem),
                exam_name=exam_name or "Unknown",
                paper_name=paper_name or file.stem,
                year=year,
                local_file_path=str(file),
                file_sha256=sha,
            )
        else:
            db.upsert_paper(s, id=paper.id, exam_name=exam_name, paper_name=paper_name, year=year,
                            local_file_path=str(file))
        paper_id = paper.id

    parser = PDFColumnParser(ocr_mode=ocr_mode)
    page_results = parser.parse(file, pages=pages, progress=progress)
    chunks = build_chunks(page_results)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    dump = PROCESSED_DIR / f"{paper_id}.pages.json"
    dump.write_text(
        json.dumps(
            [
                {
                    "page": p.page_no,
                    "two_column": p.two_column,
                    "method": p.method,
                    "is_question_page": p.looks_like_questions,
                    "columns": [{"name": c.name, "method": c.method, "quality": c.quality, "text": c.text}
                                for c in p.columns],
                }
                for p in page_results
            ],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    with db.session_scope() as s:
        if not pages:
            s.get(ExamPaper, paper_id).page_count = len(page_results)
        added = db.replace_chunks(s, paper_id, chunks)
    return {
        "paper_id": paper_id,
        "pages": len(page_results),
        "ocr_pages": sum(1 for p in page_results if p.method in ("OCR", "MIXED")),
        "question_pages": sum(1 for p in page_results if p.looks_like_questions),
        "chunks": len(chunks),
        "chunks_added": added,
        "processed_json": str(dump),
    }


# --------------------------------------------------------------------------- #
# 2b. Parse saved HTML question-bank page -> raw_chunks
# --------------------------------------------------------------------------- #
def parse_html(file: Path, *, exam_id: str, exam_name: str = "Unknown", source_url: str | None = None,
               max_chars: int = 9000) -> dict:
    db.init_db()
    html = file.read_text(encoding="utf-8", errors="ignore")
    cards = extract_question_cards(html)
    chunks, buf, size = [], [], 0
    for c in cards:
        if buf and size + len(c.text) > max_chars:
            chunks.append("\n\n---\n\n".join(buf))
            buf, size = [], 0
        buf.append(c.text)
        size += len(c.text)
    if buf:
        chunks.append("\n\n---\n\n".join(buf))
    with db.session_scope() as s:
        db.upsert_paper(s, id=exam_id, exam_name=exam_name, paper_name=file.stem, source_url=source_url,
                        local_file_path=str(file.resolve()), document_type="OTHER")
        added = db.replace_chunks(
            s,
            exam_id,
            [
                {"chunk_index": i, "page_start": 1, "page_end": 1, "text": t, "extraction_method": "TEXT"}
                for i, t in enumerate(chunks)
            ],
        )
    return {"paper_id": exam_id, "cards": len(cards), "chunks": len(chunks), "chunks_added": added}


# --------------------------------------------------------------------------- #
# 3. Normalise raw_chunks -> staged_questions -> questions
# --------------------------------------------------------------------------- #
def stage_mcqs(s, chunk: RawChunk, mcqs: list[ParsedMCQ], *, promoted_map: dict[int, str] | None = None) -> tuple[int, int]:
    """Insert or update questions in ``staged_questions`` with Automated Quality Gate scoring.

    Returns ``(staged_count, flagged_count)``.
    """
    keys = {
        k.question_number: k.correct_option
        for k in s.query(AnswerKeyEntry).filter(AnswerKeyEntry.paper_id == chunk.paper_id)
    }
    staged = flagged = 0
    prev_qno: int | None = None
    for idx, m in enumerate(mcqs):
        opts_list = [o.model_dump() for o in m.options]
        h = content_hash(m.question_en, [o.text_en for o in m.options], m.question_hi)
        score, flags = evaluate_question_quality(
            question_number=m.question_number,
            question_en=m.question_en,
            question_hi=m.question_hi,
            options=opts_list,
            prev_question_number=prev_qno,
        )
        if m.question_number is not None:
            prev_qno = m.question_number
        review_status = classify_review_status(flags, subject=m.subject, paper_id=chunk.paper_id)
        if review_status == "FLAGGED":
            flagged += 1
        page_no = infer_question_page(chunk.text, chunk.page_start, chunk.page_end, m.question_en, m.question_number)

        if m.question_number is not None and m.question_number in keys:
            correct = keys[m.question_number]
            source = "OFFICIAL_FINAL"
            conf = 1.0
        else:
            correct = m.correct_option
            source = "LLM_INFERRED"
            conf = 0.5

        promoted_id = (promoted_map or {}).get(idx)
        s.add(
            StagedQuestion(
                paper_id=chunk.paper_id,
                chunk_id=chunk.id,
                page_number=page_no,
                question_number=m.question_number,
                subject=m.subject,
                topic=m.topic,
                difficulty=m.difficulty,
                language=m.language,
                question_en=m.question_en,
                question_hi=m.question_hi,
                options_json=json.dumps(opts_list, ensure_ascii=False),
                correct_option=correct,
                source_key_type=source,
                confidence_score=conf,
                answer_source=source,
                explanation_en=m.explanation_en,
                explanation_hi=m.explanation_hi,
                content_hash=h,
                quality_score=score,
                quality_flags_json=json.dumps(flags, ensure_ascii=False),
                review_status=review_status,
                promoted_question_id=promoted_id,
            )
        )
        staged += 1
    s.flush()
    return staged, flagged


def persist_mcqs(s, chunk: RawChunk, mcqs: list[ParsedMCQ]) -> tuple[int, int]:
    """Insert new questions; record duplicates as variants. Returns (inserted, duplicates)."""
    inserted = dupes = 0
    promoted_map: dict[int, str] = {}
    keys = {
        k.question_number: k.correct_option
        for k in s.query(AnswerKeyEntry).filter(AnswerKeyEntry.paper_id == chunk.paper_id)
    }
    for idx, m in enumerate(mcqs):
        h = content_hash(m.question_en, [o.text_en for o in m.options], m.question_hi)
        existing = db.get_question_by_hash(s, h)
        if existing:
            if not (existing.paper_id == chunk.paper_id and existing.question_number == m.question_number):
                db.add_variant(s, existing, chunk.paper_id, m.question_number)
            promoted_map[idx] = existing.id
            dupes += 1
            continue
        if m.question_number is not None and m.question_number in keys:
            correct = keys[m.question_number]
            source = "OFFICIAL_FINAL"
            conf = 1.0
            status = "CANCELED" if correct == "X" else "VERIFIED"
        else:
            correct = m.correct_option
            source = "LLM_INFERRED"
            conf = 0.5
            status = "PENDING"
        q = Question(
            paper_id=chunk.paper_id,
            chunk_id=chunk.id,
            question_number=m.question_number,
            subject=m.subject,
            topic=m.topic,
            difficulty=m.difficulty,
            language=m.language,
            question_en=m.question_en,
            question_hi=m.question_hi,
            options_json=json.dumps([o.model_dump() for o in m.options], ensure_ascii=False),
            correct_option=correct,
            source_key_type=source,
            confidence_score=conf,
            answer_source=source,
            explanation_en=m.explanation_en,
            explanation_hi=m.explanation_hi,
            content_hash=h,
            status=status,
        )
        s.add(q)
        s.flush()
        promoted_map[idx] = q.id
        inserted += 1

    stage_mcqs(s, chunk, mcqs, promoted_map=promoted_map)
    return inserted, dupes


def promote_staged_questions(
    s,
    *,
    ids: list[str] | None = None,
    paper_id: str | None = None,
    include_ready: bool = False,
) -> dict:
    """Promote human-verified (``APPROVED``) questions from ``staged_questions`` into ``questions``."""
    allowed_statuses = ["APPROVED", "READY"] if include_ready else ["APPROVED"]
    q = s.query(StagedQuestion).filter(StagedQuestion.review_status.in_(allowed_statuses))
    if ids:
        q = q.filter(StagedQuestion.id.in_(ids))
    if paper_id:
        q = q.filter(StagedQuestion.paper_id == paper_id)
    rows = q.all()

    inserted = updated = duplicates = 0
    for sq in rows:
        opts = parse_options_json(sq.options_json)
        h = content_hash(sq.question_en, [str(o.get("text_en") or "") for o in opts], sq.question_hi)
        sq.content_hash = h

        target_q: Question | None = None
        if sq.promoted_question_id:
            target_q = s.get(Question, sq.promoted_question_id)

        by_hash = db.get_question_by_hash(s, h)
        if target_q is None and by_hash is not None:
            if not (by_hash.paper_id == sq.paper_id and by_hash.question_number == sq.question_number):
                db.add_variant(s, by_hash, sq.paper_id, sq.question_number)
            target_q = by_hash
            duplicates += 1

        if target_q is not None:
            # Update the final Question row with human-verified fields
            target_q.question_number = sq.question_number
            target_q.subject = sq.subject
            target_q.topic = sq.topic
            target_q.difficulty = sq.difficulty
            target_q.language = "BILINGUAL" if (sq.question_en and sq.question_hi) else ("HI" if sq.question_hi else "EN")
            target_q.question_en = sq.question_en
            target_q.question_hi = sq.question_hi
            target_q.options_json = sq.options_json
            target_q.correct_option = sq.correct_option
            target_q.explanation_en = sq.explanation_en
            target_q.explanation_hi = sq.explanation_hi
            # Avoid unique constraint collision if another row already owns h
            if by_hash is None or by_hash.id == target_q.id:
                target_q.content_hash = h
            target_q.status = "CANCELED" if sq.correct_option == "X" else "VERIFIED"
            target_q.confidence_score = 1.0
            sq.promoted_question_id = target_q.id
            if by_hash is None or by_hash.id == target_q.id:
                updated += 1
        else:
            new_q = Question(
                paper_id=sq.paper_id,
                chunk_id=sq.chunk_id,
                question_number=sq.question_number,
                subject=sq.subject,
                topic=sq.topic,
                difficulty=sq.difficulty,
                language="BILINGUAL" if (sq.question_en and sq.question_hi) else ("HI" if sq.question_hi else "EN"),
                question_en=sq.question_en,
                question_hi=sq.question_hi,
                options_json=sq.options_json,
                correct_option=sq.correct_option,
                source_key_type=sq.source_key_type,
                confidence_score=1.0,
                answer_source=sq.answer_source,
                explanation_en=sq.explanation_en,
                explanation_hi=sq.explanation_hi,
                content_hash=h,
                status="CANCELED" if sq.correct_option == "X" else "VERIFIED",
            )
            s.add(new_q)
            s.flush()
            sq.promoted_question_id = new_q.id
            inserted += 1

        if sq.review_status != "APPROVED":
            sq.review_status = "APPROVED"
            sq.reviewed_at = utcnow()

    s.flush()
    return {"evaluated": len(rows), "inserted": inserted, "updated": updated, "duplicates": duplicates}


def backfill_staging_from_questions(s) -> dict:
    """Populate ``staged_questions`` from existing ``questions`` rows and run the Quality Gate."""
    existing_promoted = {
        r[0] for r in s.query(StagedQuestion.promoted_question_id).filter(StagedQuestion.promoted_question_id.is_not(None)).all()
    }
    chunks_by_id = {c.id: c for c in s.query(RawChunk).all()}
    questions = (
        s.query(Question)
        .order_by(Question.paper_id, Question.chunk_id, Question.question_number, Question.created_at)
        .all()
    )
    added = flagged = ready = 0
    prev_paper: str | None = None
    prev_qno: int | None = None

    for q in questions:
        if q.id in existing_promoted:
            continue
        if q.paper_id != prev_paper:
            prev_paper = q.paper_id
            prev_qno = None

        opts = parse_options_json(q.options_json)
        score, flags = evaluate_question_quality(
            question_number=q.question_number,
            question_en=q.question_en,
            question_hi=q.question_hi,
            options=opts,
            prev_question_number=prev_qno,
        )
        if q.question_number is not None:
            prev_qno = q.question_number

        chunk = chunks_by_id.get(q.chunk_id) if q.chunk_id else None
        page_no = (
            infer_question_page(chunk.text, chunk.page_start, chunk.page_end, q.question_en, q.question_number)
            if chunk
            else 1
        )
        if q.status == "VERIFIED":
            status = "APPROVED"
        else:
            status = classify_review_status(flags, subject=q.subject, paper_id=q.paper_id)
            if status == "FLAGGED":
                flagged += 1
            else:
                ready += 1

        s.add(
            StagedQuestion(
                paper_id=q.paper_id,
                chunk_id=q.chunk_id,
                page_number=page_no,
                question_number=q.question_number,
                subject=q.subject,
                topic=q.topic,
                difficulty=q.difficulty,
                language=q.language,
                question_en=q.question_en,
                question_hi=q.question_hi,
                options_json=q.options_json,
                correct_option=q.correct_option,
                source_key_type=q.source_key_type,
                confidence_score=q.confidence_score,
                answer_source=q.answer_source,
                explanation_en=q.explanation_en,
                explanation_hi=q.explanation_hi,
                content_hash=q.content_hash,
                quality_score=score,
                quality_flags_json=json.dumps(flags, ensure_ascii=False),
                review_status=status,
                promoted_question_id=q.id,
            )
        )
        added += 1
    s.flush()
    return {"backfilled": added, "flagged": flagged, "ready": ready}


def rescore_staged_questions(s) -> dict:
    """Re-run the Quality Gate on all unreviewed staged questions, preserving APPROVED/REJECTED rows."""
    rows = (
        s.query(StagedQuestion)
        .filter(StagedQuestion.review_status.notin_(["APPROVED", "REJECTED"]))
        .order_by(StagedQuestion.paper_id, StagedQuestion.page_number, StagedQuestion.question_number)
        .all()
    )
    counts = {"FLAGGED": 0, "ENGLISH_ONLY": 0, "READY": 0}
    prev_paper: str | None = None
    prev_qno: int | None = None
    for sq in rows:
        if sq.paper_id != prev_paper:
            prev_paper = sq.paper_id
            prev_qno = None
        opts = parse_options_json(sq.options_json)
        score, flags = evaluate_question_quality(
            question_number=sq.question_number,
            question_en=sq.question_en,
            question_hi=sq.question_hi,
            options=opts,
            prev_question_number=prev_qno,
        )
        if sq.question_number is not None:
            prev_qno = sq.question_number
        st = classify_review_status(flags, subject=sq.subject, paper_id=sq.paper_id)
        sq.quality_score = score
        sq.quality_flags_json = json.dumps(flags, ensure_ascii=False)
        sq.review_status = st
        counts[st] = counts.get(st, 0) + 1
    s.flush()
    return counts


async def normalize(
    *,
    limit: int = 50,
    paper_id: str | None = None,
    concurrency: int = 2,
    retry_failed: bool = False,
    model: str | None = None,
    stage_only: bool = False,
    progress=None,
) -> dict:
    from src.normalizer.gemini_cleaner import GeminiCleaner, QuotaExhaustedError

    db.init_db()
    cleaner = GeminiCleaner(model=model)
    with db.session_scope() as s:
        chunks = db.pending_chunks(s, limit, paper_id, retry_failed)
        papers = {p.id: p for p in s.query(ExamPaper).filter(ExamPaper.id.in_({c.paper_id for c in chunks}))}
        items = []
        for c in chunks:
            p = papers.get(c.paper_id)
            ctx = f"{p.exam_name} | {p.paper_name} | {p.year or ''} | pages {c.page_start}-{c.page_end}" if p else ""
            items.append((c.id, c.text, ctx))

    totals = {
        "chunks": len(items),
        "ok": 0,
        "failed": 0,
        "skipped_quota": 0,
        "questions": 0,
        "flagged": 0,
        "duplicates": 0,
        "invalid": 0,
    }
    if not items:
        return totals

    done = 0
    quota_roadblock: str | None = None
    async for cid, result in cleaner.parse_chunks(items, concurrency=concurrency):
        with db.session_scope() as s:
            chunk = s.get(RawChunk, cid)
            if chunk is None:
                continue
            if isinstance(result, QuotaExhaustedError):
                # Leave chunk as PENDING so the next run picks it up seamlessly
                totals["skipped_quota"] += 1
                if not quota_roadblock:
                    quota_roadblock = str(result)
            elif isinstance(result, Exception):
                db.mark_chunk(s, chunk, "FAILED", error=str(result)[:1000])
                totals["failed"] += 1
            else:
                if stage_only:
                    staged, flg = stage_mcqs(s, chunk, result.questions)
                    ins, dup = staged, 0
                    totals["flagged"] += flg
                else:
                    ins, dup = persist_mcqs(s, chunk, result.questions)
                err = "; ".join(result.invalid)[:1000] if result.invalid else None
                db.mark_chunk(s, chunk, "NORMALIZED", error=err, found=len(result.questions))
                totals["ok"] += 1
                totals["questions"] += ins
                totals["duplicates"] += dup
                totals["invalid"] += len(result.invalid)
        done += 1
        if progress:
            progress(done, len(items))
    save_checkpoint(
        "PAUSED_QUOTA_EXHAUSTED" if quota_roadblock else "NORMALIZE_COMPLETE",
        roadblock=quota_roadblock,
        extra=totals,
    )
    return totals


# --------------------------------------------------------------------------- #
# 4. Answer keys
# --------------------------------------------------------------------------- #
_KEY_PAIR = re.compile(r"\b(\d{1,3})\s*[.):\-]?\s*\(?([a-dA-D])\)?(?![a-zA-Z])")


def regex_answer_key(text: str) -> dict[int, str]:
    """Cheap fallback for simple '1. (b)  2. (c)' style keys."""
    pairs: dict[int, str] = {}
    for n, opt in _KEY_PAIR.findall(text):
        pairs.setdefault(int(n), opt.upper())
    return pairs


async def ingest_answer_key(file: Path, *, paper_id: str, series: str | None = None, use_llm: bool = True) -> dict:
    db.init_db()
    with db.session_scope() as s:
        if s.get(ExamPaper, paper_id) is None:
            raise ValueError(f"Unknown paper id {paper_id!r}; parse/download the question paper first")
    pages = PDFColumnParser(ocr_mode="auto").parse(file)
    text = "\n\n".join(p.text for p in pages)
    if use_llm:
        from src.normalizer.gemini_cleaner import GeminiCleaner

        batch = await GeminiCleaner().parse_answer_key(text, series)
        answers = {a.question_number: a.correct_option for a in batch.answers}
    else:
        answers = regex_answer_key(text)
    with db.session_scope() as s:
        for qno, opt in answers.items():
            row = s.query(AnswerKeyEntry).filter_by(paper_id=paper_id, question_number=qno).one_or_none()
            if row:
                row.correct_option, row.source = opt, str(file)
            else:
                s.add(AnswerKeyEntry(paper_id=paper_id, question_number=qno, correct_option=opt, source=str(file)))
        s.flush()
        updated = db.apply_answer_keys(s, paper_id)
    return {"paper_id": paper_id, "answers": len(answers), "questions_updated": updated}


# --------------------------------------------------------------------------- #
# 5. Multi-Source Consensus Reconciliation
# --------------------------------------------------------------------------- #
def reconcile_paper(paper_id: str) -> dict:
    """Evaluate all discovered answer keys for a paper, resolving consensus & disputes."""
    from src.crawler.discovery_fallback import KeyDiscoveryEngine
    from src.reconciliation.consensus_engine import ConsensusEngine

    db.init_db()
    engine = KeyDiscoveryEngine()
    keys = engine.load_keys_for_paper(paper_id)
    if not keys:
        return {"paper_id": paper_id, "status": "NO_KEYS_FOUND", "reconciled": 0, "verified": 0, "disputed": 0, "canceled": 0}

    source_map = engine.to_source_answer_map(keys)
    with db.session_scope() as s:
        consensus = ConsensusEngine(s)
        stats = consensus.apply_reconciliation(paper_id, source_map)
    return {"paper_id": paper_id, "keys_evaluated": len(keys), **stats}

