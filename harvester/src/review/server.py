"""FastAPI Split-Screen Human Verification Server.

Launch via CLI::

    python -m src.cli review --port 8000

Features:
- Left pane: Rendered PDF page image (via PyMuPDF) + Raw OCR chunk text toggle
- Right pane: Editable bilingual EN/HI stem, options A-D, metadata, and Quality Gate flags
- Keyboard shortcuts:
  - Alt+A : Approve & Promote to final `questions` table -> Next
  - Ctrl+S: Save Edits, Approve & Promote -> Next
  - Alt+I : Vision Re-Extract question & options directly from the PDF page image (Gemini Multimodal)
  - Alt+R : Reject question -> Next
  - Alt+Left / Alt+Right (or K / J outside inputs): Previous / Next item in review queue
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional

import pymupdf as fitz
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from config import BASE_DIR, EXPORTS_DIR, RAW_PDF_DIR
from src import pipeline
from src.normalizer.quality_gate import classify_review_status, evaluate_question_quality
from src.storage import database as db
from src.storage.deduplicator import content_hash
from src.storage.exporter import export_json, export_sql
from src.storage.models import ExamPaper, Question, RawChunk, StagedQuestion, utcnow

log = logging.getLogger(__name__)

app = FastAPI(title="UPPCS Harvester — Human Verification Studio", version="1.0.0")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _resolve_pdf_path(paper: ExamPaper | None) -> Path | None:
    if paper is None:
        return None
    candidates: list[Path] = []
    if paper.local_file_path:
        p = Path(paper.local_file_path)
        candidates.append(p)
        if not p.is_absolute():
            candidates.append(BASE_DIR / p)
            candidates.append(BASE_DIR.parent / p)
        candidates.append(RAW_PDF_DIR / p.name)
        if paper.year:
            candidates.append(RAW_PDF_DIR / str(paper.year) / p.name)
    # Also check workspace root for sample PDFs
    for c in candidates:
        if c.exists() and c.is_file():
            return c
    if paper.local_file_path:
        fname = Path(paper.local_file_path).name
        for found in RAW_PDF_DIR.rglob(fname):
            return found
        ws_pdf = BASE_DIR.parent / "GENERAL STUDIES AND ECONOMICS - 03.pdf"
        if ws_pdf.exists() and "gs_03" in (paper.id or ""):
            return ws_pdf
    return None


def _render_pdf_page_png(pdf_path: Path, page_no: int, dpi: int = 180) -> tuple[bytes, int]:
    """Render 1-based ``page_no`` of ``pdf_path`` to PNG bytes. Returns ``(png_bytes, total_pages)``."""
    doc = fitz.open(pdf_path)
    try:
        total = doc.page_count
        if total == 0:
            raise ValueError("PDF has 0 pages")
        idx = max(0, min(page_no - 1, total - 1))
        page = doc[idx]
        pix = page.get_pixmap(dpi=dpi, alpha=False)
        return pix.tobytes("png"), total
    finally:
        doc.close()


@app.on_event("startup")
def _on_startup() -> None:
    db.init_db()
    with db.session_scope() as s:
        res = pipeline.backfill_staging_from_questions(s)
        if res["backfilled"] > 0:
            log.info("Backfilled %d existing questions into staged_questions (%d flagged)", res["backfilled"], res["flagged"])


# --------------------------------------------------------------------------- #
# Pydantic request payloads
# --------------------------------------------------------------------------- #
class OptionPayload(BaseModel):
    key: str
    text_en: str = ""
    text_hi: Optional[str] = ""


class StagedUpdatePayload(BaseModel):
    question_number: Optional[int] = None
    page_number: Optional[int] = None
    subject: Optional[str] = None
    topic: Optional[str] = None
    difficulty: str = "MEDIUM"
    correct_option: str = "A"
    question_en: str
    question_hi: Optional[str] = None
    options: list[OptionPayload] = Field(default_factory=list)
    explanation_en: Optional[str] = None
    explanation_hi: Optional[str] = None
    reviewer_notes: Optional[str] = None
    review_status: Optional[str] = None  # APPROVED | READY | FLAGGED | REJECTED
    auto_promote: bool = True


class ReextractPayload(BaseModel):
    page_number: Optional[int] = None
    question_number: Optional[int] = None
    match_entire_page: bool = False


class PromoteBatchPayload(BaseModel):
    paper_id: Optional[str] = None
    include_ready: bool = False
    export_after: bool = True


# --------------------------------------------------------------------------- #
# API Routes
# --------------------------------------------------------------------------- #
@app.get("/api/stats")
def api_stats() -> dict[str, Any]:
    with db.session_scope() as s:
        pipeline.backfill_staging_from_questions(s)
        staged_counts = dict(
            s.execute(select(StagedQuestion.review_status, func.count()).group_by(StagedQuestion.review_status)).all()
        )
        final_counts = dict(s.execute(select(Question.status, func.count()).group_by(Question.status)).all())
        papers_rows = s.execute(
            select(
                ExamPaper.id,
                ExamPaper.exam_name,
                ExamPaper.paper_name,
                ExamPaper.year,
                func.count(StagedQuestion.id).label("total"),
            )
            .join(StagedQuestion, StagedQuestion.paper_id == ExamPaper.id)
            .group_by(ExamPaper.id)
            .order_by(ExamPaper.year.desc(), ExamPaper.id)
        ).all()

        # Count flag frequencies across FLAGGED items
        flag_counter: dict[str, int] = {}
        for (flags_str,) in s.execute(
            select(StagedQuestion.quality_flags_json).where(StagedQuestion.review_status == "FLAGGED")
        ).all():
            try:
                for f in json.loads(flags_str or "[]"):
                    code = f.get("code", "OTHER")
                    # Collapse option-specific codes like EMPTY_OPTION_HI_A -> EMPTY_OPTION_HI
                    base_code = code[:-2] if code.endswith(("_A", "_B", "_C", "_D")) else code
                    flag_counter[base_code] = flag_counter.get(base_code, 0) + 1
            except Exception:
                pass

        return {
            "staged": {
                "FLAGGED": staged_counts.get("FLAGGED", 0),
                "ENGLISH_ONLY": staged_counts.get("ENGLISH_ONLY", 0),
                "READY": staged_counts.get("READY", 0),
                "APPROVED": staged_counts.get("APPROVED", 0),
                "REJECTED": staged_counts.get("REJECTED", 0),
                "TOTAL": sum(staged_counts.values()),
            },
            "final_questions": {
                "VERIFIED": final_counts.get("VERIFIED", 0),
                "PENDING": final_counts.get("PENDING", 0),
                "DISPUTED": final_counts.get("DISPUTED", 0),
                "CANCELED": final_counts.get("CANCELED", 0),
                "TOTAL": sum(final_counts.values()),
            },
            "papers": [
                {"id": r[0], "exam_name": r[1], "paper_name": r[2], "year": r[3], "count": r[4]} for r in papers_rows
            ],
            "flag_breakdown": dict(sorted(flag_counter.items(), key=lambda kv: kv[1], reverse=True)),
        }


@app.get("/api/staged")
def api_list_staged(
    status: str = Query("FLAGGED", description="FLAGGED | READY | APPROVED | REJECTED | ALL"),
    paper_id: Optional[str] = Query(None),
    flag_code: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    with db.session_scope() as s:
        stmt = select(StagedQuestion)
        if status and status.upper() != "ALL":
            stmt = stmt.where(StagedQuestion.review_status == status.upper())
        if paper_id:
            stmt = stmt.where(StagedQuestion.paper_id == paper_id)
        if flag_code:
            stmt = stmt.where(StagedQuestion.quality_flags_json.contains(flag_code))
        if search and search.strip():
            q_str = f"%{search.strip()}%"
            if search.strip().isdigit():
                stmt = stmt.where(
                    or_(
                        StagedQuestion.question_number == int(search.strip()),
                        StagedQuestion.question_en.ilike(q_str),
                        StagedQuestion.question_hi.ilike(q_str),
                    )
                )
            else:
                stmt = stmt.where(
                    or_(
                        StagedQuestion.question_en.ilike(q_str),
                        StagedQuestion.question_hi.ilike(q_str),
                        StagedQuestion.options_json.ilike(q_str),
                    )
                )

        total = s.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        stmt = (
            stmt.order_by(
                StagedQuestion.quality_score.asc(),
                StagedQuestion.paper_id.asc(),
                StagedQuestion.page_number.asc(),
                StagedQuestion.question_number.asc(),
            )
            .limit(limit)
            .offset(offset)
        )
        rows = s.scalars(stmt).all()
        items = []
        for r in rows:
            try:
                flags = json.loads(r.quality_flags_json or "[]")
            except Exception:
                flags = []
            items.append(
                {
                    "id": r.id,
                    "paper_id": r.paper_id,
                    "page_number": r.page_number or 1,
                    "question_number": r.question_number,
                    "question_en_preview": (r.question_en or "")[:95],
                    "review_status": r.review_status,
                    "quality_score": r.quality_score,
                    "flag_codes": [f.get("code") for f in flags],
                    "promoted_question_id": r.promoted_question_id,
                }
            )
        return {"total": total, "items": items}


@app.get("/api/staged/{staged_id}")
def api_get_staged(staged_id: str) -> dict[str, Any]:
    with db.session_scope() as s:
        sq = s.get(StagedQuestion, staged_id)
        if sq is None:
            raise HTTPException(status_code=404, detail="Staged question not found")
        d = db.staged_to_dict(sq)
        paper = s.get(ExamPaper, sq.paper_id) if sq.paper_id else None
        chunk = s.get(RawChunk, sq.chunk_id) if sq.chunk_id else None
        pdf_path = _resolve_pdf_path(paper)
        page_count = paper.page_count if paper and paper.page_count else None
        if pdf_path and not page_count:
            try:
                with fitz.open(pdf_path) as doc:
                    page_count = doc.page_count
            except Exception:
                page_count = None

        d["paper"] = (
            {
                "id": paper.id,
                "exam_name": paper.exam_name,
                "paper_name": paper.paper_name,
                "year": paper.year,
                "page_count": page_count or 32,
                "has_pdf": pdf_path is not None,
                "pdf_filename": pdf_path.name if pdf_path else None,
            }
            if paper
            else None
        )
        d["chunk"] = (
            {
                "id": chunk.id,
                "page_start": chunk.page_start,
                "page_end": chunk.page_end,
                "extraction_method": chunk.extraction_method,
                "text": chunk.text,
            }
            if chunk
            else None
        )
        return d


@app.get("/api/papers/{paper_id}/pages/{page_no}/image")
def api_paper_page_image(paper_id: str, page_no: int, dpi: int = Query(180, ge=96, le=350)) -> Response:
    with db.session_scope() as s:
        paper = s.get(ExamPaper, paper_id)
        pdf_path = _resolve_pdf_path(paper)
        if pdf_path is None:
            raise HTTPException(status_code=404, detail=f"PDF file not found on disk for paper {paper_id}")
    try:
        png_bytes, total_pages = _render_pdf_page_png(pdf_path, page_no, dpi=dpi)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to render PDF page: {exc}") from exc
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "X-Total-Pages": str(total_pages),
            "Cache-Control": "public, max-age=3600",
        },
    )


@app.put("/api/staged/{staged_id}")
def api_update_staged(staged_id: str, payload: StagedUpdatePayload) -> dict[str, Any]:
    with db.session_scope() as s:
        sq = s.get(StagedQuestion, staged_id)
        if sq is None:
            raise HTTPException(status_code=404, detail="Staged question not found")

        opts_dicts = [o.model_dump() for o in payload.options]
        score, flags = evaluate_question_quality(
            question_number=payload.question_number,
            question_en=payload.question_en,
            question_hi=payload.question_hi,
            options=opts_dicts,
        )

        sq.question_number = payload.question_number
        if payload.page_number is not None:
            sq.page_number = payload.page_number
        sq.subject = payload.subject
        sq.topic = payload.topic
        sq.difficulty = payload.difficulty
        sq.correct_option = payload.correct_option
        sq.question_en = payload.question_en.strip()
        sq.question_hi = (payload.question_hi or "").strip() or None
        sq.language = "BILINGUAL" if (sq.question_en and sq.question_hi) else ("HI" if sq.question_hi else "EN")
        sq.options_json = json.dumps(opts_dicts, ensure_ascii=False)
        sq.explanation_en = (payload.explanation_en or "").strip() or None
        sq.explanation_hi = (payload.explanation_hi or "").strip() or None
        sq.reviewer_notes = payload.reviewer_notes
        sq.content_hash = content_hash(sq.question_en, [o.text_en for o in payload.options], sq.question_hi)
        sq.quality_score = score
        sq.quality_flags_json = json.dumps(flags, ensure_ascii=False)

        if payload.review_status:
            sq.review_status = payload.review_status.upper()
            sq.reviewed_at = utcnow()
        else:
            sq.review_status = classify_review_status(flags, subject=sq.subject, paper_id=sq.paper_id)

        s.flush()
        promote_res = None
        if sq.review_status == "APPROVED" and payload.auto_promote:
            promote_res = pipeline.promote_staged_questions(s, ids=[sq.id])

        return {"item": db.staged_to_dict(sq), "promoted": promote_res}


@app.post("/api/staged/{staged_id}/reextract")
async def api_reextract_from_pdf_image(staged_id: str, payload: ReextractPayload) -> dict[str, Any]:
    """Render the PDF page image and use Gemini Multimodal Vision to re-extract the question cleanly."""
    from src.normalizer.gemini_cleaner import GeminiCleaner

    with db.session_scope() as s:
        sq = s.get(StagedQuestion, staged_id)
        if sq is None:
            raise HTTPException(status_code=404, detail="Staged question not found")
        paper = s.get(ExamPaper, sq.paper_id) if sq.paper_id else None
        pdf_path = _resolve_pdf_path(paper)
        if pdf_path is None:
            raise HTTPException(status_code=404, detail="PDF file not available on disk for Vision re-extraction")
        target_page = payload.page_number or sq.page_number or 1
        target_qno = payload.question_number if payload.question_number is not None else sq.question_number
        hint_text = sq.question_en or ""
        ctx = f"{paper.exam_name} | {paper.paper_name} | {paper.year or ''} | page {target_page}" if paper else ""

    png_bytes, _ = _render_pdf_page_png(pdf_path, target_page, dpi=240)
    try:
        cleaner = GeminiCleaner()
        res = await cleaner.extract_from_page_image(
            png_bytes,
            question_number=None if payload.match_entire_page else target_qno,
            hint_text="" if payload.match_entire_page else hint_text,
            context=ctx,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini Vision extraction failed: {exc}") from exc

    if not res.questions:
        raise HTTPException(
            status_code=422,
            detail="Gemini Vision did not find a matching complete MCQ on this page. Try adjusting the PDF Page # on the left.",
        )

    # Pick best matching question from returned batch
    chosen = res.questions[0]
    if target_qno is not None:
        for m in res.questions:
            if m.question_number == target_qno:
                chosen = m
                break

    opts_dicts = [o.model_dump() for o in chosen.options]
    score, flags = evaluate_question_quality(
        question_number=chosen.question_number,
        question_en=chosen.question_en,
        question_hi=chosen.question_hi,
        options=opts_dicts,
    )
    return {
        "extracted": {
            "question_number": chosen.question_number,
            "page_number": target_page,
            "subject": chosen.subject,
            "topic": chosen.topic,
            "difficulty": chosen.difficulty,
            "correct_option": chosen.correct_option,
            "question_en": chosen.question_en,
            "question_hi": chosen.question_hi,
            "options": opts_dicts,
            "explanation_en": chosen.explanation_en,
            "explanation_hi": chosen.explanation_hi,
            "quality_score": score,
            "quality_flags": flags,
        },
        "all_extracted_count": len(res.questions),
    }


@app.post("/api/promote")
def api_promote_batch(payload: PromoteBatchPayload) -> dict[str, Any]:
    with db.session_scope() as s:
        res = pipeline.promote_staged_questions(
            s, paper_id=payload.paper_id, include_ready=payload.include_ready
        )
        exports = {}
        if payload.export_after:
            d1_out = EXPORTS_DIR / "d1_import.sql"
            pg_out = EXPORTS_DIR / "pg_import.sql"
            json_out = EXPORTS_DIR / "questions_master.json"
            exports["d1"] = export_sql(s, d1_out, fmt="d1", statuses=["VERIFIED"])
            exports["postgres"] = export_sql(s, pg_out, fmt="postgres", statuses=["VERIFIED"])
            exports["json"] = export_json(s, json_out, statuses=["VERIFIED"])
    return {"promoted": res, "exports": exports}


class BulkApproveEnglishPayload(BaseModel):
    paper_id: Optional[str] = None


@app.post("/api/staged/bulk-approve-english-only")
def api_bulk_approve_english_only(payload: BulkApproveEnglishPayload) -> dict[str, Any]:
    """Approve and promote all ENGLISH_ONLY staged questions en masse."""
    with db.session_scope() as s:
        q = s.query(StagedQuestion).filter(StagedQuestion.review_status == "ENGLISH_ONLY")
        if payload.paper_id:
            q = q.filter(StagedQuestion.paper_id == payload.paper_id)
        rows = q.all()
        ids = [r.id for r in rows]
        for r in rows:
            r.review_status = "APPROVED"
            r.reviewed_at = utcnow()
        s.flush()
        promoted = pipeline.promote_staged_questions(s, ids=ids) if ids else {"evaluated": 0, "inserted": 0, "updated": 0, "duplicates": 0}
    return {"approved_count": len(ids), "promoted": promoted}


# --------------------------------------------------------------------------- #
# Single-Page Split-Screen Review Studio HTML
# --------------------------------------------------------------------------- #
INDEX_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>UPPCS Harvester — Human Verification Studio</title>
  <style>
    :root {
      --bg: #0f172a;
      --panel: #1e293b;
      --panel-alt: #0b1120;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --green: #10b981;
      --amber: #f59e0b;
      --red: #ef4444;
      --purple: #a855f7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Devanagari", sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    /* Top Header */
    header {
      background: var(--panel-alt);
      border-bottom: 1px solid var(--border);
      padding: 8px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-shrink: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 15px;
      color: var(--accent);
    }
    .stats-pills {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .pill {
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: var(--panel);
      border: 1px solid var(--border);
      cursor: pointer;
      transition: 0.15s;
    }
    .pill:hover { border-color: var(--accent); }
    .pill.flagged { color: #fca5a5; border-color: #7f1d1d; background: rgba(239, 68, 68, 0.12); }
    .pill.english-only { color: #c4b5fd; border-color: #5b21b6; background: rgba(139, 92, 246, 0.16); }
    .pill.ready { color: #fde68a; border-color: #78350f; background: rgba(245, 158, 11, 0.12); }
    .pill.approved { color: #6ee7b7; border-color: #065f46; background: rgba(16, 185, 129, 0.12); }
    .pill.final { color: #bae6fd; border-color: #0369a1; background: rgba(56, 189, 248, 0.12); }

    /* Split Screen Container */
    .workspace {
      display: grid;
      grid-template-columns: 48% 52%;
      flex: 1;
      overflow: hidden;
    }

    /* Left Pane: PDF & Raw Chunk Viewer */
    .left-pane {
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      background: #090d16;
      overflow: hidden;
    }
    .pane-toolbar {
      padding: 8px 12px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 13px;
    }
    .toolbar-group {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pdf-viewport {
      flex: 1;
      overflow: auto;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 12px;
    }
    .pdf-viewport img {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
      box-shadow: 0 8px 25px rgba(0,0,0,0.6);
      background: #fff;
      transform-origin: top center;
    }
    .raw-chunk-view {
      flex: 1;
      overflow: auto;
      padding: 16px;
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 12.5px;
      line-height: 1.55;
      white-space: pre-wrap;
      color: #cbd5e1;
      display: none;
    }

    /* Right Pane: Queue & Editor */
    .right-pane {
      display: flex;
      flex-direction: column;
      background: var(--bg);
      overflow: hidden;
    }
    .filter-bar {
      padding: 8px 12px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    select, input[type="text"], input[type="number"], textarea {
      background: #0f172a;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 9px;
      font-size: 13px;
      font-family: inherit;
    }
    select:focus, input:focus, textarea:focus {
      outline: none;
      border-color: var(--accent);
    }
    .editor-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Quality Flag Alert Box */
    .flags-banner {
      border-radius: 8px;
      padding: 10px 12px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.4);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .flags-banner.clean {
      background: rgba(16, 185, 129, 0.1);
      border-color: rgba(16, 185, 129, 0.4);
    }
    .flags-banner.english-only {
      background: rgba(139, 92, 246, 0.12);
      border-color: rgba(139, 92, 246, 0.5);
    }
    .flag-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12.5px;
    }
    .badge {
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge.HIGH { background: var(--red); color: #fff; }
    .badge.MEDIUM { background: var(--amber); color: #000; }
    .badge.LOW { background: var(--accent); color: #000; }

    /* Form Controls */
    .meta-grid {
      display: grid;
      grid-template-columns: 80px 80px 95px 110px 1fr 1.2fr;
      gap: 8px;
    }
    .field-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .field-group label {
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .bilingual-stems {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .bilingual-stems textarea {
      width: 100%;
      min-height: 115px;
      resize: vertical;
      line-height: 1.45;
    }
    .options-box {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .opt-row {
      display: grid;
      grid-template-columns: 38px 1fr 1fr;
      gap: 8px;
      align-items: center;
    }
    .opt-key-btn {
      height: 34px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: #0f172a;
      color: var(--muted);
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .opt-key-btn.correct {
      background: var(--green);
      color: #052e16;
      border-color: var(--green);
    }
    .flagged-input {
      border-color: var(--red) !important;
      background: rgba(239, 68, 68, 0.06) !important;
    }

    /* Sticky Action Footer */
    .action-bar {
      padding: 10px 16px;
      background: var(--panel-alt);
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-shrink: 0;
    }
    .btn {
      padding: 7px 13px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: 0.15s;
    }
    .btn:hover:not(:disabled) { filter: brightness(1.15); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-approve { background: var(--green); color: #052e16; border-color: var(--green); }
    .btn-save { background: var(--accent); color: #082f49; border-color: var(--accent); }
    .btn-vision { background: var(--purple); color: #fff; border-color: var(--purple); }
    .btn-reject { background: rgba(239,68,68,0.18); color: #fca5a5; border-color: #991b1b; }
    .kbd {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(0,0,0,0.28);
      font-family: monospace;
    }
    #toast {
      position: fixed;
      bottom: 64px;
      right: 20px;
      padding: 10px 16px;
      border-radius: 8px;
      background: #1e293b;
      border: 1px solid var(--accent);
      color: #fff;
      font-size: 13px;
      box-shadow: 0 8px 20px rgba(0,0,0,0.5);
      display: none;
      z-index: 1000;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span>🛡️ UPPCS Human Verification Studio</span>
      <span style="font-size:12px; color:var(--muted); font-weight:400;">Raw Chunks → Enriched Staging → Human Verified → Final Tables</span>
    </div>
    <div class="stats-pills">
      <span class="pill flagged" onclick="setFilterStatus('FLAGGED')" id="stat-flagged" title="True OCR/structural defects needing human verification">🚩 OCR Defects: 0</span>
      <span class="pill english-only" onclick="setFilterStatus('ENGLISH_ONLY')" id="stat-eng-only" title="English stem & options complete; only Hindi part missing">🌐 English-Only: 0</span>
      <span class="pill ready" onclick="setFilterStatus('READY')" id="stat-ready">⏳ Ready: 0</span>
      <span class="pill approved" onclick="setFilterStatus('APPROVED')" id="stat-approved">✅ Approved: 0</span>
      <span class="pill final" id="stat-final">🏆 Final Verified: 0</span>
      <button class="btn" style="background:rgba(139,92,246,0.22); border-color:#7c3aed; color:#ddd6fe;" onclick="bulkApproveEnglishOnly()" title="Verify & promote all English-Only questions en masse">
        🌐 Approve All English-Only
      </button>
      <button class="btn btn-approve" onclick="promoteAllApproved()" title="Promote all APPROVED staging rows to final questions table and export SQL/JSON">
        🚀 Promote & Export Verified
      </button>
    </div>
  </header>

  <div class="workspace">
    <!-- LEFT PANE: PDF Page & Raw Chunk Text -->
    <div class="left-pane">
      <div class="pane-toolbar">
        <div class="toolbar-group">
          <button class="btn" id="btn-mode-pdf" onclick="setLeftMode('pdf')" style="border-color:var(--accent);">📄 PDF Page</button>
          <button class="btn" id="btn-mode-raw" onclick="setLeftMode('raw')">📝 Raw Chunk Text</button>
        </div>
        <div class="toolbar-group">
          <button class="btn" onclick="stepPdfPage(-1)">◀ Prev Page</button>
          <span>Page <input type="number" id="pdf-page-input" value="1" min="1" style="width:58px; text-align:center;" onchange="onPdfPageInput()" /> / <span id="pdf-page-total">?</span></span>
          <button class="btn" onclick="stepPdfPage(1)">Next Page ▶</button>
        </div>
        <div class="toolbar-group">
          <select id="pdf-zoom" onchange="applyZoom()">
            <option value="100">Fit Width</option>
            <option value="125">125%</option>
            <option value="150">150%</option>
            <option value="175">175%</option>
          </select>
        </div>
      </div>
      <div class="pdf-viewport" id="pdf-viewport">
        <img id="pdf-image" alt="PDF Page Preview" />
      </div>
      <div class="raw-chunk-view" id="raw-chunk-view"></div>
    </div>

    <!-- RIGHT PANE: Queue Navigation + Bilingual Question Editor -->
    <div class="right-pane">
      <div class="filter-bar">
        <select id="filter-status" onchange="reloadQueue()">
          <option value="FLAGGED">🚩 Critical OCR Defects (Needs Human Review)</option>
          <option value="ENGLISH_ONLY">🌐 English-Only (Missing Hindi Only — En Masse)</option>
          <option value="READY">⏳ Ready for Review (Bilingual Complete)</option>
          <option value="APPROVED">✅ Approved</option>
          <option value="REJECTED">🗑️ Rejected</option>
          <option value="ALL">📋 All Staged Questions</option>
        </select>
        <select id="filter-paper" onchange="reloadQueue()" style="max-width:210px;">
          <option value="">All Exam Papers</option>
        </select>
        <select id="filter-flag" onchange="reloadQueue()" style="max-width:190px;">
          <option value="">All Defect Types</option>
        </select>
        <input type="text" id="filter-search" placeholder="Search Q# or text..." style="width:140px;" onkeydown="if(event.key==='Enter') reloadQueue()" />
        <div style="margin-left:auto; display:flex; align-items:center; gap:6px;">
          <button class="btn" onclick="navigateQueue(-1)" title="Previous Question (Alt+Left or K)">◀</button>
          <span id="queue-pos" style="font-size:12.5px; font-weight:600; min-width:85px; text-align:center;">0 / 0</span>
          <button class="btn" onclick="navigateQueue(1)" title="Next Question (Alt+Right or J)">▶</button>
        </div>
      </div>

      <div class="editor-scroll" id="editor-container">
        <!-- Quality Gate Banner -->
        <div class="flags-banner" id="flags-banner">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong id="flags-title" style="font-size:13px;">Automated Quality Gate</strong>
            <button class="btn btn-vision" onclick="visionReextract(false)" id="btn-vision">
              ✨ Re-Extract from PDF Image <span class="kbd">Alt+I</span>
            </button>
          </div>
          <div id="flags-list"></div>
        </div>

        <!-- Metadata Row -->
        <div class="meta-grid">
          <div class="field-group">
            <label>Question #</label>
            <input type="number" id="f-qno" placeholder="e.g. 14" />
          </div>
          <div class="field-group">
            <label>PDF Page #</label>
            <input type="number" id="f-page" min="1" onchange="syncPageFromForm()" />
          </div>
          <div class="field-group">
            <label>Answer Key</label>
            <select id="f-correct" onchange="highlightCorrectKey()">
              <option value="A">Option A</option>
              <option value="B">Option B</option>
              <option value="C">Option C</option>
              <option value="D">Option D</option>
              <option value="X">X (Deleted)</option>
            </select>
          </div>
          <div class="field-group">
            <label>Difficulty</label>
            <select id="f-difficulty">
              <option value="EASY">EASY</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HARD">HARD</option>
            </select>
          </div>
          <div class="field-group">
            <label>Subject</label>
            <input type="text" id="f-subject" />
          </div>
          <div class="field-group">
            <label>Micro-Topic</label>
            <input type="text" id="f-topic" />
          </div>
        </div>

        <!-- Bilingual Stems -->
        <div class="bilingual-stems">
          <div class="field-group">
            <label>English Question Stem</label>
            <textarea id="f-qen" placeholder="Full English question stem..."></textarea>
          </div>
          <div class="field-group">
            <label>Hindi Question Stem (देवनागरी)</label>
            <textarea id="f-qhi" placeholder="पूरा हिंदी प्रश्न..."></textarea>
          </div>
        </div>

        <!-- 4 Options Grid -->
        <div class="options-box">
          <div style="display:grid; grid-template-columns:38px 1fr 1fr; gap:8px; font-size:11px; font-weight:600; color:var(--muted); text-transform:uppercase;">
            <span>Key</span>
            <span>English Option Text</span>
            <span>Hindi Option Text (विकल्प)</span>
          </div>
          <div class="opt-row">
            <button type="button" class="opt-key-btn" id="key-btn-A" onclick="selectCorrectOption('A')">A</button>
            <input type="text" id="f-opt-a-en" placeholder="Option A (English)" />
            <input type="text" id="f-opt-a-hi" placeholder="विकल्प A (हिंदी)" />
          </div>
          <div class="opt-row">
            <button type="button" class="opt-key-btn" id="key-btn-B" onclick="selectCorrectOption('B')">B</button>
            <input type="text" id="f-opt-b-en" placeholder="Option B (English)" />
            <input type="text" id="f-opt-b-hi" placeholder="विकल्प B (हिंदी)" />
          </div>
          <div class="opt-row">
            <button type="button" class="opt-key-btn" id="key-btn-C" onclick="selectCorrectOption('C')">C</button>
            <input type="text" id="f-opt-c-en" placeholder="Option C (English)" />
            <input type="text" id="f-opt-c-hi" placeholder="विकल्प C (हिंदी)" />
          </div>
          <div class="opt-row">
            <button type="button" class="opt-key-btn" id="key-btn-D" onclick="selectCorrectOption('D')">D</button>
            <input type="text" id="f-opt-d-en" placeholder="Option D (English)" />
            <input type="text" id="f-opt-d-hi" placeholder="विकल्प D (हिंदी)" />
          </div>
        </div>

        <!-- Explanations -->
        <div class="bilingual-stems">
          <div class="field-group">
            <label>Explanation (English)</label>
            <textarea id="f-expen" style="min-height:68px;"></textarea>
          </div>
          <div class="field-group">
            <label>Explanation (Hindi)</label>
            <textarea id="f-exphi" style="min-height:68px;"></textarea>
          </div>
        </div>
      </div>

      <!-- Sticky Bottom Action Bar -->
      <div class="action-bar">
        <div style="display:flex; gap:8px;">
          <button class="btn btn-reject" onclick="saveAndStatus('REJECTED')">
            🗑️ Reject <span class="kbd">Alt+R</span>
          </button>
          <button class="btn" onclick="saveAndStatus(null)">
            💾 Save Draft
          </button>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-save" onclick="saveAndStatus('APPROVED')">
            ✨ Save Edits & Approve <span class="kbd">Ctrl+S</span>
          </button>
          <button class="btn btn-approve" onclick="saveAndStatus('APPROVED')">
            ✅ Approve & Next <span class="kbd">Alt+A</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <div id="toast"></div>

  <script>
    let queue = [];
    let currentIndex = 0;
    let currentItem = null;
    let leftMode = 'pdf';

    function showToast(msg, color = 'var(--accent)') {
      const t = document.getElementById('toast');
      t.style.borderColor = color;
      t.textContent = msg;
      t.style.display = 'block';
      clearTimeout(window._toastTimer);
      window._toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3200);
    }

    async function loadStats() {
      const res = await fetch('/api/stats');
      const data = await res.json();
      document.getElementById('stat-flagged').textContent = `🚩 OCR Defects: ${data.staged.FLAGGED}`;
      document.getElementById('stat-eng-only').textContent = `🌐 English-Only: ${data.staged.ENGLISH_ONLY || 0}`;
      document.getElementById('stat-ready').textContent = `⏳ Ready: ${data.staged.READY}`;
      document.getElementById('stat-approved').textContent = `✅ Approved: ${data.staged.APPROVED}`;
      document.getElementById('stat-final').textContent = `🏆 Final Verified: ${data.final_questions.VERIFIED} / ${data.final_questions.TOTAL}`;

      const paperSel = document.getElementById('filter-paper');
      if (paperSel.options.length <= 1) {
        for (const p of data.papers) {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = `${p.year || ''} | ${p.paper_name.slice(0, 32)} (${p.count})`;
          paperSel.appendChild(opt);
        }
      }
      const flagSel = document.getElementById('filter-flag');
      const curFlag = flagSel.value;
      flagSel.innerHTML = '<option value="">All Defect Types</option>';
      for (const [code, cnt] of Object.entries(data.flag_breakdown || {})) {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = `${code} (${cnt})`;
        flagSel.appendChild(opt);
      }
      flagSel.value = curFlag;
    }

    function setFilterStatus(st) {
      document.getElementById('filter-status').value = st;
      reloadQueue();
    }

    async function reloadQueue() {
      await loadStats();
      const status = document.getElementById('filter-status').value;
      const paper = document.getElementById('filter-paper').value;
      const flag = document.getElementById('filter-flag').value;
      const search = document.getElementById('filter-search').value;
      const params = new URLSearchParams({ status, limit: 1000 });
      if (paper) params.set('paper_id', paper);
      if (flag) params.set('flag_code', flag);
      if (search) params.set('search', search);

      const res = await fetch(`/api/staged?${params.toString()}`);
      const data = await res.json();
      queue = data.items || [];
      currentIndex = 0;
      if (queue.length > 0) {
        await loadStagedItem(queue[0].id);
      } else {
        document.getElementById('queue-pos').textContent = '0 / 0';
        showToast('No items match this filter.', 'var(--amber)');
      }
    }

    async function navigateQueue(delta) {
      if (!queue.length) return;
      currentIndex = Math.max(0, Math.min(queue.length - 1, currentIndex + delta));
      await loadStagedItem(queue[currentIndex].id);
    }

    async function loadStagedItem(id) {
      const res = await fetch(`/api/staged/${id}`);
      if (!res.ok) return;
      const item = await res.json();
      currentItem = item;
      document.getElementById('queue-pos').textContent = `${currentIndex + 1} / ${queue.length}`;

      // Populate form
      document.getElementById('f-qno').value = item.question_number ?? '';
      document.getElementById('f-page').value = item.page_number ?? 1;
      document.getElementById('f-correct').value = item.correct_option || 'A';
      document.getElementById('f-difficulty').value = item.difficulty || 'MEDIUM';
      document.getElementById('f-subject').value = item.subject || '';
      document.getElementById('f-topic').value = item.topic || '';
      document.getElementById('f-qen').value = item.question_en || '';
      document.getElementById('f-qhi').value = item.question_hi || '';
      document.getElementById('f-expen').value = item.explanation_en || '';
      document.getElementById('f-exphi').value = item.explanation_hi || '';

      const optsMap = { A: {}, B: {}, C: {}, D: {} };
      for (const o of (item.options || [])) {
        if (optsMap[o.key]) optsMap[o.key] = o;
      }
      for (const k of ['A', 'B', 'C', 'D']) {
        const kl = k.toLowerCase();
        document.getElementById(`f-opt-${kl}-en`).value = optsMap[k].text_en || '';
        document.getElementById(`f-opt-${kl}-hi`).value = optsMap[k].text_hi || '';
      }

      highlightCorrectKey();
      renderQualityFlags(item.quality_flags || [], item.quality_score, item.review_status);

      // Update Left Pane (PDF & Raw Chunk)
      const totalPages = item.paper?.page_count || 32;
      document.getElementById('pdf-page-total').textContent = totalPages;
      document.getElementById('raw-chunk-view').textContent = item.chunk?.text || '(No raw chunk text)';
      loadPdfPage(item.paper_id, item.page_number || 1);
    }

    function renderQualityFlags(flags, score, status) {
      // Clear previous red borders
      document.querySelectorAll('.flagged-input').forEach(el => el.classList.remove('flagged-input'));
      const banner = document.getElementById('flags-banner');
      const title = document.getElementById('flags-title');
      const list = document.getElementById('flags-list');
      list.innerHTML = '';

      if (!flags || flags.length === 0) {
        banner.className = 'flags-banner clean';
        title.textContent = `✅ Quality Score: ${(score * 100).toFixed(0)}% (${status}) — No automated defects detected`;
        return;
      }
      if (status === 'ENGLISH_ONLY') {
        banner.className = 'flags-banner english-only';
        title.textContent = `🌐 English-Only Question (${(score * 100).toFixed(0)}%) — English stem & all 4 options are complete; only Hindi part is missing (can be approved en masse)`;
      } else {
        banner.className = 'flags-banner';
        title.textContent = `🚩 Critical OCR Defect (${(score * 100).toFixed(0)}%) — ${flags.length} issue(s) to verify against PDF`;
      }
      for (const f of flags) {
        const row = document.createElement('div');
        row.className = 'flag-item';
        row.innerHTML = `<span class="badge ${f.severity}">${f.severity}</span> <code>${f.code}</code> <span>${f.message}</span>`;
        list.appendChild(row);

        // Highlight specific field
        const fieldMap = {
          question_number: 'f-qno',
          question_en: 'f-qen',
          question_hi: 'f-qhi',
          option_a_en: 'f-opt-a-en',
          option_b_en: 'f-opt-b-en',
          option_c_en: 'f-opt-c-en',
          option_d_en: 'f-opt-d-en',
          option_a_hi: 'f-opt-a-hi',
          option_b_hi: 'f-opt-b-hi',
          option_c_hi: 'f-opt-c-hi',
          option_d_hi: 'f-opt-d-hi',
        };
        if (f.field && fieldMap[f.field]) {
          document.getElementById(fieldMap[f.field])?.classList.add('flagged-input');
        }
      }
    }

    function selectCorrectOption(k) {
      document.getElementById('f-correct').value = k;
      highlightCorrectKey();
    }

    function highlightCorrectKey() {
      const cur = document.getElementById('f-correct').value;
      for (const k of ['A', 'B', 'C', 'D']) {
        const btn = document.getElementById(`key-btn-${k}`);
        if (k === cur) btn.classList.add('correct');
        else btn.classList.remove('correct');
      }
    }

    function loadPdfPage(paperId, pageNo) {
      if (!paperId) return;
      document.getElementById('pdf-page-input').value = pageNo;
      const img = document.getElementById('pdf-image');
      img.src = `/api/papers/${encodeURIComponent(paperId)}/pages/${pageNo}/image?dpi=180`;
    }

    function stepPdfPage(delta) {
      const inp = document.getElementById('pdf-page-input');
      const next = Math.max(1, parseInt(inp.value || '1', 10) + delta);
      inp.value = next;
      document.getElementById('f-page').value = next;
      if (currentItem) loadPdfPage(currentItem.paper_id, next);
    }

    function onPdfPageInput() {
      const next = Math.max(1, parseInt(document.getElementById('pdf-page-input').value || '1', 10));
      document.getElementById('f-page').value = next;
      if (currentItem) loadPdfPage(currentItem.paper_id, next);
    }

    function syncPageFromForm() {
      const next = Math.max(1, parseInt(document.getElementById('f-page').value || '1', 10));
      if (currentItem) loadPdfPage(currentItem.paper_id, next);
    }

    function setLeftMode(mode) {
      leftMode = mode;
      document.getElementById('pdf-viewport').style.display = mode === 'pdf' ? 'flex' : 'none';
      document.getElementById('raw-chunk-view').style.display = mode === 'raw' ? 'block' : 'none';
      document.getElementById('btn-mode-pdf').style.borderColor = mode === 'pdf' ? 'var(--accent)' : 'var(--border)';
      document.getElementById('btn-mode-raw').style.borderColor = mode === 'raw' ? 'var(--accent)' : 'var(--border)';
    }

    function applyZoom() {
      const z = parseInt(document.getElementById('pdf-zoom').value, 10);
      const img = document.getElementById('pdf-image');
      if (z === 100) {
        img.style.maxWidth = '100%';
        img.style.width = 'auto';
      } else {
        img.style.maxWidth = 'none';
        img.style.width = `${z}%`;
      }
    }

    function collectFormPayload(reviewStatus) {
      const qnoRaw = document.getElementById('f-qno').value.trim();
      const pageRaw = document.getElementById('f-page').value.trim();
      return {
        question_number: qnoRaw ? parseInt(qnoRaw, 10) : null,
        page_number: pageRaw ? parseInt(pageRaw, 10) : 1,
        correct_option: document.getElementById('f-correct').value,
        difficulty: document.getElementById('f-difficulty').value,
        subject: document.getElementById('f-subject').value.trim(),
        topic: document.getElementById('f-topic').value.trim(),
        question_en: document.getElementById('f-qen').value.trim(),
        question_hi: document.getElementById('f-qhi').value.trim(),
        explanation_en: document.getElementById('f-expen').value.trim(),
        explanation_hi: document.getElementById('f-exphi').value.trim(),
        options: ['A', 'B', 'C', 'D'].map(k => ({
          key: k,
          text_en: document.getElementById(`f-opt-${k.toLowerCase()}-en`).value.trim(),
          text_hi: document.getElementById(`f-opt-${k.toLowerCase()}-hi`).value.trim(),
        })),
        review_status: reviewStatus,
        auto_promote: true,
      };
    }

    async function saveAndStatus(status) {
      if (!currentItem) return;
      const payload = collectFormPayload(status);
      const res = await fetch(`/api/staged/${currentItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(`Error: ${err.detail || 'Save failed'}`, 'var(--red)');
        return;
      }
      const data = await res.json();
      await loadStats();
      if (status === 'APPROVED') {
        showToast(`✅ Q.${payload.question_number || '?'} verified & promoted to final questions table!`, 'var(--green)');
        if (currentIndex + 1 < queue.length) {
          await navigateQueue(1);
        }
      } else if (status === 'REJECTED') {
        showToast(`🗑️ Question marked REJECTED.`, 'var(--amber)');
        if (currentIndex + 1 < queue.length) {
          await navigateQueue(1);
        }
      } else {
        currentItem = data.item;
        renderQualityFlags(currentItem.quality_flags || [], currentItem.quality_score, currentItem.review_status);
        showToast('💾 Draft saved & Quality Gate updated.');
      }
    }

    async function visionReextract(matchEntirePage = false) {
      if (!currentItem) return;
      const btn = document.getElementById('btn-vision');
      btn.disabled = true;
      btn.textContent = '⏳ Reading PDF Page Image with Gemini Vision...';
      try {
        const pageNo = parseInt(document.getElementById('f-page').value || '1', 10);
        const qnoRaw = document.getElementById('f-qno').value.trim();
        const res = await fetch(`/api/staged/${currentItem.id}/reextract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            page_number: pageNo,
            question_number: qnoRaw ? parseInt(qnoRaw, 10) : null,
            match_entire_page: matchEntirePage,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.detail || 'Vision re-extraction failed', 'var(--red)');
          return;
        }
        const ex = data.extracted;
        if (ex.question_number !== null && ex.question_number !== undefined) {
          document.getElementById('f-qno').value = ex.question_number;
        }
        document.getElementById('f-qen').value = ex.question_en || '';
        document.getElementById('f-qhi').value = ex.question_hi || '';
        if (ex.subject) document.getElementById('f-subject').value = ex.subject;
        if (ex.topic) document.getElementById('f-topic').value = ex.topic;
        if (ex.explanation_en) document.getElementById('f-expen').value = ex.explanation_en;
        if (ex.explanation_hi) document.getElementById('f-exphi').value = ex.explanation_hi;
        for (const o of (ex.options || [])) {
          const kl = o.key.toLowerCase();
          document.getElementById(`f-opt-${kl}-en`).value = o.text_en || '';
          document.getElementById(`f-opt-${kl}-hi`).value = o.text_hi || '';
        }
        renderQualityFlags(ex.quality_flags || [], ex.quality_score || 1.0, 'READY');
        showToast('✨ Extracted full stem & options from PDF page image! Review and press Ctrl+S to Approve.', 'var(--purple)');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '✨ Re-Extract from PDF Image <span class="kbd">Alt+I</span>';
      }
    }

    async function promoteAllApproved() {
      const res = await fetch('/api/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_ready: false, export_after: true }),
      });
      const data = await res.json();
      await loadStats();
      showToast(
        `🚀 Promoted ${data.promoted.evaluated} approved questions (${data.promoted.updated} updated, ${data.promoted.inserted} new) & exported D1/PG/JSON!`,
        'var(--green)'
      );
    }

    async function bulkApproveEnglishOnly() {
      const paper = document.getElementById('filter-paper').value || null;
      const scopeLabel = paper ? `for selected paper (${paper})` : 'across ALL papers';
      if (!confirm(`Verify and approve all 🌐 English-Only questions ${scopeLabel} and promote them to the final questions table?`)) {
        return;
      }
      const res = await fetch('/api/staged/bulk-approve-english-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper_id: paper }),
      });
      const data = await res.json();
      await reloadQueue();
      showToast(
        `🌐 Verified & promoted ${data.approved_count} English-Only question(s) en masse!`,
        'var(--purple)'
      );
    }

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveAndStatus('APPROVED');
        return;
      }
      if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        saveAndStatus('APPROVED');
        return;
      }
      if (e.altKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        visionReextract(false);
        return;
      }
      if (e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        saveAndStatus('REJECTED');
        return;
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        navigateQueue(1);
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateQueue(-1);
        return;
      }
    });

    reloadQueue();
  </script>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse)
def index_page() -> HTMLResponse:
    return HTMLResponse(content=INDEX_HTML)
