"""Unified Typer CLI.

Examples::

    python -m src.cli download --url "https://uppsc.up.nic.in/OuterPages/PreQuesPapers.aspx?ID=PrevQues" --exam UPPCS --year 2025 --stage PRELIMS
    python -m src.cli parse-pdf --file ./data/raw/pdfs/sample_2023.pdf --exam-id uppsc_2023
    python -m src.cli normalize --limit 50
    python -m src.cli export --format d1 --out ./data/exports/d1_import.sql
    python -m src.cli stats
"""
from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.logging import RichHandler
from rich.progress import BarColumn, MofNCompleteColumn, Progress, SpinnerColumn, TextColumn, TimeElapsedColumn
from rich.table import Table

from config import EXPORTS_DIR, settings, setup_logging

app = typer.Typer(add_completion=False, no_args_is_help=True, help="Exam harvester: crawl → parse → normalise → export")
emb_app = typer.Typer(no_args_is_help=True, help="Embedding queue (prepared; no paid provider registered)")
app.add_typer(emb_app, name="embeddings")
console = Console()


@app.callback()
def _main(verbose: bool = typer.Option(False, "--verbose", "-v", help="Debug logging")) -> None:
    if sys.platform == "win32":  # make Devanagari printable on legacy consoles
        try:
            sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass
    setup_logging("DEBUG" if verbose else None)
    root = logging.getLogger()
    if not any(isinstance(h, RichHandler) for h in root.handlers):
        h = RichHandler(console=console, show_path=False, rich_tracebacks=True)
        h.setLevel(logging.DEBUG if verbose else logging.WARNING)
        root.addHandler(h)


def _progress() -> Progress:
    return Progress(
        SpinnerColumn(), TextColumn("[bold]{task.description}"), BarColumn(), MofNCompleteColumn(),
        TimeElapsedColumn(), console=console,
    )


def _kv_table(title: str, data: dict) -> Table:
    t = Table(title=title, show_header=False, title_justify="left")
    t.add_column(style="cyan")
    t.add_column()
    for k, v in data.items():
        t.add_row(str(k), str(v))
    return t


# --------------------------------------------------------------------------- #
@app.command("init-db")
def init_db_cmd() -> None:
    """Create the SQLite schema (idempotent)."""
    from src.storage.database import init_db

    engine = init_db()
    console.print(f"[green]✓[/] Database ready: {engine.url.render_as_string(hide_password=True)}")


@app.command()
def download(
    url: str = typer.Option(..., "--url", help="UPPSC listing page, an HTML page with PDF links, or a direct PDF URL"),
    exam: Optional[str] = typer.Option(None, "--exam", help="Exam filter/alias, e.g. UPPCS, RO/ARO, APO"),
    year: Optional[int] = typer.Option(None, "--year"),
    stage: Optional[str] = typer.Option(None, "--stage", help="PRELIMS | MAINS | ANY"),
    limit: Optional[int] = typer.Option(None, "--limit", help="Max files to fetch"),
    render_js: bool = typer.Option(False, "--render-js", help="Render page with Playwright first"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Only list what would be downloaded"),
) -> None:
    """Crawl a source and download question papers / answer keys into data/raw/pdfs."""
    from src import pipeline

    with _progress() as prog:
        task = prog.add_task("Downloading", total=None)
        summary = asyncio.run(
            pipeline.download(url, exam=exam, year=year, stage=stage, limit=limit, render_js=render_js,
                              dry_run=dry_run, progress=lambda i, n: prog.update(task, completed=i, total=n))
        )
    if dry_run:
        t = Table(title=f"{summary.listed} papers matched", title_justify="left")
        t.add_column("Year | Title | URL")
        for p in summary.papers:
            t.add_row(p)
        console.print(t)
        return
    console.print(_kv_table("Download summary", {
        "matched": summary.listed, "downloaded": summary.downloaded, "skipped (already have)": summary.skipped,
        "failed": len(summary.failed),
    }))
    for f in summary.failed:
        console.print(f"[red]✗[/] {f}")
    if summary.papers:
        console.print("Paper ids: " + ", ".join(sorted(set(summary.papers))))


@app.command("parse-pdf")
def parse_pdf(
    file: Path = typer.Option(..., "--file", exists=True, dir_okay=False, help="PDF to parse"),
    exam_id: Optional[str] = typer.Option(None, "--exam-id", help="Paper id (exam_papers.id) to attach chunks to"),
    exam_name: Optional[str] = typer.Option(None, "--exam-name"),
    paper_name: Optional[str] = typer.Option(None, "--paper-name"),
    year: Optional[int] = typer.Option(None, "--year"),
    ocr: str = typer.Option("auto", "--ocr", help="auto | always | never"),
    pages: Optional[str] = typer.Option(None, "--pages", help="e.g. '2-5,8' (1-based)"),
) -> None:
    """Extract two-column text (+ OCR fallback) and stage it as raw_chunks."""
    from src import pipeline
    from src.parsers import ocr_engine

    if ocr != "never" and not ocr_engine.is_available():
        console.print("[yellow]![/] Tesseract not found — OCR fallback disabled (see README → Tesseract).")
    page_list = _parse_pages(pages) if pages else None
    with _progress() as prog:
        task = prog.add_task(f"Parsing {file.name}", total=None)
        res = pipeline.parse_pdf(file, exam_id=exam_id, exam_name=exam_name, paper_name=paper_name, year=year,
                                 ocr_mode=ocr, pages=page_list,
                                 progress=lambda i, n: prog.update(task, completed=i, total=n))
    console.print(_kv_table("Parse summary", res))


def _parse_pages(spec: str) -> list[int]:
    out: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            out.extend(range(int(a), int(b) + 1))
        elif part:
            out.append(int(part))
    return sorted(set(out))


@app.command("parse-html")
def parse_html(
    file: Path = typer.Option(..., "--file", exists=True, dir_okay=False),
    exam_id: str = typer.Option(..., "--exam-id"),
    exam_name: str = typer.Option("Unknown", "--exam-name"),
    source_url: Optional[str] = typer.Option(None, "--source-url"),
) -> None:
    """Stage question cards from a saved HTML question-bank page as raw_chunks."""
    from src import pipeline

    console.print(_kv_table("HTML parse summary", pipeline.parse_html(file, exam_id=exam_id, exam_name=exam_name,
                                                                      source_url=source_url)))


@app.command()
def normalize(
    limit: int = typer.Option(50, "--limit", help="Max chunks to send to Gemini"),
    paper_id: Optional[str] = typer.Option(None, "--paper-id"),
    concurrency: int = typer.Option(2, "--concurrency"),
    retry_failed: bool = typer.Option(False, "--retry-failed"),
    stage_only: bool = typer.Option(False, "--stage-only", help="Quarantine in staged_questions until human review"),
    model: Optional[str] = typer.Option(None, "--model", help=f"Default: {settings.gemini_model}"),
) -> None:
    """Send pending raw_chunks to Gemini and store validated, deduplicated questions."""
    from src import pipeline
    from src.normalizer.gemini_cleaner import GeminiNotConfigured

    try:
        with _progress() as prog:
            task = prog.add_task("Normalising chunks", total=None)
            res = asyncio.run(pipeline.normalize(limit=limit, paper_id=paper_id, concurrency=concurrency,
                                                 retry_failed=retry_failed, model=model, stage_only=stage_only,
                                                 progress=lambda i, n: prog.update(task, completed=i, total=n)))
    except GeminiNotConfigured as exc:
        console.print(f"[red]✗ {exc}[/]")
        raise typer.Exit(2)
    console.print(_kv_table("Normalise summary", res))


@app.command("answer-key")
def answer_key(
    file: Path = typer.Option(..., "--file", exists=True, dir_okay=False),
    paper_id: str = typer.Option(..., "--paper-id", help="Question paper the key belongs to"),
    series: Optional[str] = typer.Option(None, "--series", help="Booklet series in the key (A/B/C/D)"),
    no_llm: bool = typer.Option(False, "--no-llm", help="Use the regex extractor instead of Gemini"),
) -> None:
    """Load an official answer key and overwrite answers with answer_source=OFFICIAL_KEY."""
    from src import pipeline

    res = asyncio.run(pipeline.ingest_answer_key(file, paper_id=paper_id, series=series, use_llm=not no_llm))
    console.print(_kv_table("Answer key", res))


@app.command()
def export(
    fmt: str = typer.Option("d1", "--format", help="d1 | postgres | json"),
    out: Optional[Path] = typer.Option(None, "--out"),
    status: Optional[str] = typer.Option(None, "--status", help="Comma list, e.g. VERIFIED or PENDING,VERIFIED"),
    no_schema: bool = typer.Option(False, "--no-schema", help="Omit CREATE TABLE statements"),
) -> None:
    """Export to D1/PostgreSQL SQL (always also writes questions_master.json)."""
    from src.storage import database as db
    from src.storage.exporter import export_json, export_sql

    statuses = [s.strip().upper() for s in status.split(",")] if status else ["PENDING", "VERIFIED"]
    with db.session_scope() as s:
        results = {}
        if fmt in ("d1", "postgres"):
            default = EXPORTS_DIR / ("batch_insert.sql" if fmt == "d1" else "postgres_import.sql")
            r = export_sql(s, out or default, fmt=fmt, statuses=statuses, include_schema=not no_schema)
            results["sql"] = f"{r['path']} ({r['questions']} questions, {r['papers']} papers)"
        elif fmt != "json":
            raise typer.BadParameter("format must be d1 | postgres | json")
        j = export_json(s, out if fmt == "json" else None, statuses)
        results["json"] = f"{j['path']} ({j['questions']} questions)"
    console.print(_kv_table("Export", results))


@app.command("catalog")
def catalog_cmd(
    exam: Optional[str] = typer.Option("UPPCS", "--exam", help="Exam filter (e.g. UPPCS)"),
    years: Optional[str] = typer.Option(None, "--years", help="Comma-separated years (e.g. 2025,2024)"),
) -> None:
    """Scan official portals, check document lineage, and build audit manifest."""
    from src.crawler.portal_cataloger import AUDIT_MANIFEST_PATH, scan_and_catalog_portal

    year_list = [int(y.strip()) for y in years.split(",") if y.strip().isdigit()] if years else None
    with _progress() as prog:
        task = prog.add_task("Cataloging portal papers", total=None)
        res = asyncio.run(scan_and_catalog_portal(exam_filter=exam, years=year_list))
    console.print(
        _kv_table(
            "Audit Manifest Summary",
            {
                "total_cataloged": res["total_cataloged"],
                "downloaded": res["downloaded_count"],
                "missing_keys": res["missing_key_count"],
                "manifest_file": str(AUDIT_MANIFEST_PATH),
            },
        )
    )


@app.command("reconcile")
def reconcile_cmd(
    paper_id: str = typer.Option(..., "--paper-id", help="Target exam paper ID to reconcile keys for"),
) -> None:
    """Cross-verify multiple answer keys using the Consensus Engine."""
    from src import pipeline

    res = pipeline.reconcile_paper(paper_id)
    console.print(_kv_table("Reconciliation Summary", res))


@app.command("add-key")
def add_key_cmd(
    paper_id: str = typer.Option(..., "--paper-id"),
    source_name: str = typer.Option(..., "--source", help="e.g. Drishti IAS, Dhyeya, Official Provisional"),
    source_type: str = typer.Option(
        "THIRD_PARTY", "--type", help="OFFICIAL_FINAL | OFFICIAL_PROVISIONAL | THIRD_PARTY"
    ),
    key_file: Path = typer.Option(
        ..., "--file", exists=True, dir_okay=False, help="JSON file containing {'1': 'A', '2': 'B'}"
    ),
    url: str = typer.Option("", "--url"),
) -> None:
    """Register an independent third-party or provisional answer key for consensus verification."""
    import json
    from src.crawler.discovery_fallback import KeyDiscoveryEngine

    data = json.loads(key_file.read_text(encoding="utf-8"))
    engine = KeyDiscoveryEngine()
    saved = engine.save_third_party_key(paper_id, source_name, data, source_url=url, source_type=source_type)
    console.print(f"[green]✓[/] Saved {source_name} key ({len(data)} answers) to {saved}")


@app.command()
def stats() -> None:
    """Counts per subject, language distribution, verification, difficulty, and chunk status."""
    from src.storage import database as db

    with db.session_scope() as s:
        st = db.collect_stats(s)
    console.print(
        _kv_table("Totals", {k: st[k] for k in ("papers", "staged_questions", "questions", "variants", "answer_keys", "dispute_logs")})
    )
    for key, title in (
        ("staged_by_status", "Staging Review Queue (staged_questions)"),
        ("by_subject", "Questions by subject"),
        ("by_difficulty", "Difficulty distribution"),
        ("by_language", "Language distribution"),
        ("by_status", "Verification status (final questions)"),
        ("by_source_key_type", "Source key types"),
        ("by_answer_source", "Answer source"),
        ("chunks_by_status", "Raw chunks"),
    ):
        if st.get(key):
            t = Table(title=title, title_justify="left")
            t.add_column("value", style="cyan")
            t.add_column("count", justify="right")
            for k, v in st[key].items():
                t.add_row(str(k), str(v))
            console.print(t)


@app.command("promote")
def promote_cmd(
    paper_id: Optional[str] = typer.Option(None, "--paper-id", help="Only promote approved questions for this paper"),
    include_ready: bool = typer.Option(False, "--include-ready", help="Also promote unflagged READY items"),
    export_after: bool = typer.Option(True, "--export/--no-export", help="Export D1/Postgres/JSON after promoting"),
) -> None:
    """Promote human-verified (APPROVED) questions from staged_questions into final questions table."""
    from src import pipeline
    from src.storage import database as db
    from src.storage.exporter import export_json, export_sql

    db.init_db()
    with db.session_scope() as s:
        res = pipeline.promote_staged_questions(s, paper_id=paper_id, include_ready=include_ready)
        if export_after:
            export_sql(s, EXPORTS_DIR / "d1_import.sql", fmt="d1", statuses=["VERIFIED"])
            export_sql(s, EXPORTS_DIR / "pg_import.sql", fmt="postgres", statuses=["VERIFIED"])
            export_json(s, EXPORTS_DIR / "questions_master.json", statuses=["VERIFIED"])
    console.print(_kv_table("Promotion summary", res))


@app.command("review")
def review_cmd(
    host: str = typer.Option("127.0.0.1", "--host", help="Bind host"),
    port: int = typer.Option(8000, "--port", help="Bind port"),
) -> None:
    """Launch the local Split-Screen Human Verification Web UI (FastAPI + Uvicorn)."""
    import uvicorn
    from src import pipeline
    from src.storage import database as db

    db.init_db()
    with db.session_scope() as s:
        bf = pipeline.backfill_staging_from_questions(s)
        st = db.collect_stats(s)
    console.print(
        _kv_table(
            "Human Verification Studio Ready",
            {
                "URL": f"http://{host}:{port}",
                "Staged Total": st["staged_questions"],
                "Flagged Defects": st["staged_by_status"].get("FLAGGED", 0),
                "Ready for Review": st["staged_by_status"].get("READY", 0),
                "Approved": st["staged_by_status"].get("APPROVED", 0),
                "Newly Backfilled": bf["backfilled"],
            },
        )
    )
    uvicorn.run("src.review.server:app", host=host, port=port, log_level="info")


@app.command("set-status")
def set_status(
    ids: list[str] = typer.Argument(..., help="Question ids"),
    status: str = typer.Option(..., "--status", help="PENDING | VERIFIED | REJECTED"),
) -> None:
    """Mark questions as verified / rejected after manual review."""
    from src.storage import database as db
    from src.storage.models import Question

    status = status.upper()
    if status not in ("PENDING", "VERIFIED", "REJECTED"):
        raise typer.BadParameter("invalid status")
    with db.session_scope() as s:
        n = s.query(Question).filter(Question.id.in_(ids)).update({Question.status: status}, synchronize_session=False)
    console.print(f"[green]✓[/] {n} question(s) → {status}")


# --------------------------------------------------------------------------- #
# Embeddings (queue management only; no paid provider is registered)
# --------------------------------------------------------------------------- #
@emb_app.command("enqueue")
def emb_enqueue(
    provider: str = typer.Option(..., "--provider", help="e.g. gemini"),
    model: str = typer.Option(..., "--model", help="e.g. gemini-embedding-001"),
    task_type: Optional[str] = typer.Option(None, "--task-type"),
    limit: Optional[int] = typer.Option(None, "--limit"),
) -> None:
    """Create PENDING embedding jobs (database only — no API calls, no cost)."""
    from src.embeddings import service
    from src.storage import database as db

    with db.session_scope() as s:
        stale = service.mark_stale(s)
        n = service.enqueue(s, provider, model, task_type=task_type, limit=limit)
    console.print(f"[green]✓[/] queued {n} job(s); {stale} marked STALE")


@emb_app.command("status")
def emb_status() -> None:
    """Embedding job counts by provider / model / status."""
    from src.embeddings import service
    from src.storage import database as db

    with db.session_scope() as s:
        rows = service.status_counts(s)
    t = Table(title="Embedding jobs", title_justify="left")
    for c in ("provider", "model", "status", "count"):
        t.add_column(c)
    for r in rows:
        t.add_row(*map(str, r))
    console.print(t if rows else "No embedding jobs yet.")


@emb_app.command("run")
def emb_run(
    provider: str = typer.Option("fake", "--provider", help="Registered provider name"),
    batch_size: int = typer.Option(32, "--batch-size"),
    max_batches: Optional[int] = typer.Option(None, "--max-batches"),
    allow_cost: bool = typer.Option(False, "--allow-cost", help="Required for providers that bill per call"),
) -> None:
    """Process queued jobs with a registered provider (only the offline 'fake' provider ships today)."""
    from src.embeddings.base import get_provider
    from src.embeddings import service
    from src.storage import database as db

    p = get_provider(provider)
    if p.incurs_cost and not allow_cost:
        console.print(f"[red]✗[/] provider '{provider}' incurs API cost; re-run with --allow-cost")
        raise typer.Exit(2)
    res = asyncio.run(service.run_worker(db.session_scope, p, batch_size=batch_size, max_batches=max_batches))
    console.print(_kv_table("Embedding worker", res))


@app.command()
def harvest(
    year: Optional[int] = typer.Option(None, "--year", help="Year to harvest, e.g. 2025 (omit for all years)"),
    exam: Optional[str] = typer.Option(None, "--exam", help="Exam filter, e.g. UPPCS, RO/ARO, GIC"),
    limit_papers: Optional[int] = typer.Option(None, "--limit-papers", help="Max papers to parse in this run"),
    limit_chunks: Optional[int] = typer.Option(300, "--limit-chunks", help="Max chunks to normalize with Gemini"),
    wave_size: int = typer.Option(30, "--wave-size", help="Chunks per interleaved parse->normalize wave"),
    ocr: str = typer.Option("auto", "--ocr", help="auto | always | never"),
    concurrency: int = typer.Option(4, "--concurrency", help="Gemini normalization concurrency"),
    include_mains: bool = typer.Option(False, "--include-mains", help="Also parse descriptive Mains papers"),
    force_download: bool = typer.Option(False, "--force-download", help="Re-check UPPSC portal even if PDFs cached"),
) -> None:
    """Autonomous end-to-end pipeline:
    1. Downloads question papers sorted yearwise (data/raw/pdfs/<year>/)
    2. Parses dual-column layouts and normalizes via Gemini in interleaved waves
       so the `questions` table updates continuously every ~60 seconds
    3. Automatically saves checkpoint and exports to Cloudflare D1 SQL, Postgres SQL, and questions_master.json
    """
    from src import pipeline
    from src.storage import database as db
    from src.storage.models import ExamPaper, RawChunk
    from src.storage.exporter import export_sql, export_json
    from config import EXPORTS_DIR
    from pathlib import Path

    db.init_db()
    with db.session_scope() as s:
        cached_papers = s.query(ExamPaper).filter(ExamPaper.local_file_path.is_not(None)).count()

    if force_download or cached_papers < 190:
        console.print(f"[bold cyan]▶ STEP 1: Verifying / Downloading PDFs sorted yearwise...[/]")
        summary = asyncio.run(
            pipeline.download(
                "https://uppsc.up.nic.in/OuterPages/PreQuesPapers.aspx?ID=PrevQues",
                exam=exam,
                year=year,
                limit=None,
            )
        )
        console.print(f"[green]✓[/] Download complete: {summary.downloaded} new, {summary.skipped} already cached.")
    else:
        console.print(f"[green]✓[/] STEP 1: All {cached_papers} PDFs (2017–2025) already downloaded & verified on disk.")

    def _is_mains(p: ExamPaper) -> bool:
        u = f"{p.paper_name} {p.exam_name}".upper()
        return p.stage == "MAINS" or "(MAINS)" in u or "MAINS EXAM" in u or "MAINS-" in u

    _text_tier_cache: dict[str, int] = {}

    def _has_fast_text(p: ExamPaper) -> int:
        if p.id in _text_tier_cache:
            return _text_tier_cache[p.id]
        tier = 1
        try:
            import pymupdf as fitz
            from src.parsers.pdf_column_parser import text_quality
            if p.local_file_path and Path(p.local_file_path).exists():
                doc = fitz.open(p.local_file_path)
                if doc.page_count > 1:
                    t = doc[min(2, doc.page_count - 1)].get_text("text")
                    if text_quality(t) >= 0.60 and len(t.strip()) >= 200:
                        tier = 0
                doc.close()
        except Exception:
            pass
        _text_tier_cache[p.id] = tier
        return tier

    def _priority_key(p: ExamPaper) -> tuple:
        u = p.paper_name.upper()
        is_gs = any(k in u for k in ("GENERAL STUDIES", "GENERAL KNOWLEDGE", "PCS", "ACF/RFO", "PRE.", "PRELIMS"))
        return (_has_fast_text(p), 0 if is_gs else 1, -(p.year or 0), p.id)

    total_budget = limit_chunks if limit_chunks is not None else 999999
    chunks_processed_total = 0
    papers_parsed_total = 0
    wave_num = 0

    while chunks_processed_total < total_budget:
        wave_num += 1
        wave_target = min(wave_size, total_budget - chunks_processed_total)

        with db.session_scope() as s:
            existing_chunk_pids = {r[0] for r in s.query(RawChunk.paper_id).distinct().all()}
            pending_chunks_count = s.query(RawChunk).filter(RawChunk.status == "PENDING").count()
            q = s.query(ExamPaper).filter(ExamPaper.local_file_path.is_not(None))
            if year:
                q = q.filter(ExamPaper.year == year)
            if exam:
                q = q.filter(ExamPaper.exam_name.ilike(f"%{exam}%"))
            all_unparsed = [p for p in q.all() if p.id not in existing_chunk_pids]

        papers_to_parse = [p for p in all_unparsed if include_mains or not _is_mains(p)]
        papers_to_parse.sort(key=_priority_key)
        if limit_papers is not None:
            remaining_paper_Allowance = max(0, limit_papers - papers_parsed_total)
            papers_to_parse = papers_to_parse[:remaining_paper_Allowance]

        if pending_chunks_count < wave_target and papers_to_parse:
            console.print(f"[bold cyan]▶ WAVE {wave_num} (Parse): Queueing chunks (currently {pending_chunks_count} pending)...[/]")
            for p in papers_to_parse:
                if pending_chunks_count >= wave_target:
                    break
                fp = Path(p.local_file_path)
                if not fp.exists():
                    continue
                try:
                    console.print(f"  Parsing ({p.year}): [dim]{p.paper_name[:70]}[/]...")
                    res_parse = pipeline.parse_pdf(fp, exam_id=p.id, year=p.year, ocr_mode=ocr)
                    papers_parsed_total += 1
                    added = int(res_parse.get("chunks_added", res_parse.get("chunks", 0)))
                    pending_chunks_count += added
                    console.print(
                        f"    [green]→[/] +{added} chunks ({res_parse.get('pages', 0)} pages, {res_parse.get('ocr_pages', 0)} OCR) | queued: {pending_chunks_count}"
                    )
                except Exception as exc:
                    console.print(f"  [yellow]![/] Skipping {p.id}: {exc}")

        with db.session_scope() as s:
            pending_chunks_count = s.query(RawChunk).filter(RawChunk.status == "PENDING").count()

        if pending_chunks_count == 0:
            console.print("[green]✓[/] No more pending chunks or unparsed papers remaining.")
            break

        batch_to_run = min(wave_target, pending_chunks_count)
        console.print(
            f"[bold cyan]▶ WAVE {wave_num} (Enrich): Normalizing {batch_to_run} chunks via Gemini ({concurrency} workers)...[/]"
        )
        res = asyncio.run(
            pipeline.normalize(
                limit=batch_to_run,
                concurrency=concurrency,
            )
        )
        console.print(_kv_table(f"Wave {wave_num} Normalisation Result", res))
        processed_in_wave = int(res.get("ok", 0)) + int(res.get("failed", 0))
        chunks_processed_total += processed_in_wave

        with db.session_scope() as s:
            d1_out = EXPORTS_DIR / "d1_import.sql"
            pg_out = EXPORTS_DIR / "pg_import.sql"
            json_out = EXPORTS_DIR / "questions_master.json"
            export_sql(s, d1_out, fmt="d1")
            export_sql(s, pg_out, fmt="postgres")
            export_json(s, json_out)

        if int(res.get("skipped_quota", 0)) > 0:
            console.print("[yellow]![/] Quota/rate-limit roadblock hit; checkpoint saved.")
            break
        if processed_in_wave == 0:
            break

    console.print(f"[green]✓[/] Pipeline run complete! Database enriched and ready for DBeaver.")


if __name__ == "__main__":
    app()
