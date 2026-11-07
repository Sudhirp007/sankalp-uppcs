"""Exports: Cloudflare D1 SQL, PostgreSQL (+pgvector) SQL, and a master JSON file.

DDL is generated from the SQLAlchemy models (single source of truth), so the export
schema can never drift from the local SQLite schema.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index, MetaData, Table, UniqueConstraint, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateIndex, CreateTable

from config import EXPORTS_DIR
from src.storage.models import DisputeLog, ExamPaper, Question, QuestionEmbedding

log = logging.getLogger(__name__)

# Pipeline-internal columns that the live exam engine does not need.
_EXCLUDED_COLUMNS = {"questions": {"chunk_id"}}
_EXPORT_TABLES = ("exam_papers", "questions")


# --------------------------------------------------------------------------- #
# SQL literal rendering
# --------------------------------------------------------------------------- #
def sql_literal(value) -> str:
    """Render a Python value as a safe SQL literal (SQLite/D1/PostgreSQL compatible)."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, (datetime, date)):
        value = value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()
    s = str(value).replace("\x00", "")
    return "'" + s.replace("'", "''") + "'"


# --------------------------------------------------------------------------- #
# DDL
# --------------------------------------------------------------------------- #
def _export_metadata(include_embeddings: bool = False) -> MetaData:
    """Copy of the export tables without pipeline-internal columns / foreign keys."""
    src_tables = [ExamPaper.__table__, Question.__table__, DisputeLog.__table__]
    if include_embeddings:
        src_tables.append(QuestionEmbedding.__table__)
    md = MetaData()
    export_names = {t.name for t in src_tables}
    for t in src_tables:
        excluded = _EXCLUDED_COLUMNS.get(t.name, set())
        cols = [c._copy() for c in t.columns if c.name not in excluded]
        checks = [
            CheckConstraint(c.sqltext, name=c.name)
            for c in t.constraints
            if isinstance(c, CheckConstraint) and not any(x in str(c.sqltext) for x in excluded)
        ]
        fks = [
            ForeignKeyConstraint([fk.parent.name], [fk.target_fullname], ondelete=fk.ondelete)
            for fk in t.foreign_keys
            if fk.parent.name not in excluded and fk.column.table.name in export_names
        ]
        uniques = [
            UniqueConstraint(*[c.name for c in u.columns], name=u.name)
            for u in t.constraints
            if isinstance(u, UniqueConstraint) and len(u.columns) > 1
        ]
        new = Table(t.name, md, *cols, *checks, *fks, *uniques)
        for idx in t.indexes:
            if all(c.name in new.c for c in idx.columns):
                Index(idx.name, *[new.c[c.name] for c in idx.columns], unique=idx.unique)
    return md


def schema_ddl(dialect: str = "sqlite", include_embeddings: bool = False) -> str:
    d = sqlite.dialect() if dialect == "sqlite" else postgresql.dialect()
    md = _export_metadata(include_embeddings)
    parts = []
    for t in md.sorted_tables:
        parts.append(str(CreateTable(t, if_not_exists=True).compile(dialect=d)).strip() + ";")
        for idx in sorted(t.indexes, key=lambda i: i.name):
            parts.append(str(CreateIndex(idx, if_not_exists=True).compile(dialect=d)).strip() + ";")
    return "\n\n".join(parts)


# --------------------------------------------------------------------------- #
# Row export
# --------------------------------------------------------------------------- #
def _rows(session: Session, model, statuses: list[str] | None = None):
    stmt = select(model)
    if model is Question and statuses:
        stmt = stmt.where(Question.status.in_(statuses))
    return session.scalars(stmt).all()


def _insert(table: str, columns: list[str], values: list, dialect: str) -> str:
    cols = ", ".join(columns)
    vals = ", ".join(sql_literal(v) for v in values)
    if dialect == "sqlite":
        return f"INSERT OR IGNORE INTO {table} ({cols}) VALUES ({vals});"
    return f"INSERT INTO {table} ({cols}) VALUES ({vals}) ON CONFLICT DO NOTHING;"


def export_sql(
    session: Session,
    out_path: Path,
    *,
    fmt: str = "d1",
    statuses: list[str] | None = None,
    include_schema: bool = True,
) -> dict:
    """Write an import script. ``fmt``: ``d1`` (SQLite dialect) or ``postgres``."""
    if fmt not in ("d1", "sqlite", "postgres"):
        raise ValueError("fmt must be d1|sqlite|postgres")
    dialect = "postgres" if fmt == "postgres" else "sqlite"
    md = _export_metadata(include_embeddings=dialect == "postgres")
    questions = _rows(session, Question, statuses)
    paper_ids = {q.paper_id for q in questions if q.paper_id}
    papers = [p for p in _rows(session, ExamPaper) if p.id in paper_ids]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = [
        f"-- Generated by exam harvester on {datetime.now().isoformat(timespec='seconds')}",
        f"-- Target: {'Cloudflare D1 / SQLite' if dialect == 'sqlite' else 'PostgreSQL (+pgvector)'}",
        f"-- Papers: {len(papers)}  Questions: {len(questions)}  Status filter: {statuses or 'ALL'}",
        "",
    ]
    if dialect == "sqlite":
        # D1 enforces FKs; defer checks to the end of the import transaction.
        lines += ["PRAGMA defer_foreign_keys = true;", ""]
    if include_schema:
        if dialect == "postgres":
            lines += ["CREATE EXTENSION IF NOT EXISTS vector;", ""]
        lines += [schema_ddl("sqlite" if dialect == "sqlite" else "postgresql", dialect == "postgres"), ""]

    disputes = session.scalars(select(DisputeLog).where(DisputeLog.question_id.in_({q.id for q in questions}))).all() if questions else []

    for table_name, rows in (("exam_papers", papers), ("questions", questions), ("dispute_logs", disputes)):
        cols = [c.name for c in md.tables[table_name].columns]
        lines.append(f"-- {table_name}: {len(rows)} rows")
        for r in rows:
            lines.append(_insert(table_name, cols, [getattr(r, c) for c in cols], dialect))
        lines.append("")

    if dialect == "postgres":
        embs = session.scalars(select(QuestionEmbedding).where(QuestionEmbedding.status == "DONE")).all()
        embs = [e for e in embs if e.question_id in {q.id for q in questions}]
        cols = [c.name for c in md.tables["question_embeddings"].columns]
        lines.append(f"-- question_embeddings (DONE): {len(embs)} rows")
        for e in embs:
            vals = []
            for c in cols:
                v = getattr(e, c)
                vals.append(None if v is None else ("[" + ",".join(f"{x:.8g}" for x in v) + "]") if c == "embedding" else v)
            lines.append(_insert("question_embeddings", cols, vals, dialect))

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log.info("Exported %d questions / %d papers to %s", len(questions), len(papers), out_path)
    return {"path": str(out_path), "papers": len(papers), "questions": len(questions)}


def export_json(session: Session, out_path: Path | None = None, statuses: list[str] | None = None) -> dict:
    out_path = out_path or EXPORTS_DIR / "questions_master.json"
    papers = {p.id: p for p in _rows(session, ExamPaper)}
    items = []
    for q in _rows(session, Question, statuses):
        p = papers.get(q.paper_id)
        items.append(
            {
                "id": q.id,
                "paper": {"id": p.id, "exam_name": p.exam_name, "paper_name": p.paper_name, "year": p.year}
                if p
                else None,
                "question_number": q.question_number,
                "subject": q.subject,
                "topic": q.topic,
                "difficulty": q.difficulty,
                "language": q.language,
                "question_en": q.question_en,
                "question_hi": q.question_hi,
                "options": json.loads(q.options_json),
                "correct_option": q.correct_option,
                "source_key_type": getattr(q, "source_key_type", q.answer_source),
                "confidence_score": getattr(q, "confidence_score", 1.0),
                "answer_source": q.answer_source,
                "explanation_en": q.explanation_en,
                "explanation_hi": q.explanation_hi,
                "status": q.status,
                "content_hash": q.content_hash,
                "variants": [{"paper_id": v.paper_id, "question_number": v.question_number} for v in q.variants],
                "disputes": [
                    {
                        "disputed_sources": d.disputed_sources,
                        "conflicting_keys": json.loads(d.conflicting_keys_json) if d.conflicting_keys_json else {},
                        "committee_notes": d.committee_notes,
                        "status_flag": d.status_flag,
                    }
                    for d in getattr(q, "dispute_logs", [])
                ],
            }
        )
    items.sort(key=lambda x: ((x["paper"] or {}).get("id") or "", x["question_number"] or 0))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Exported %d questions to %s", len(items), out_path)
    return {"path": str(out_path), "questions": len(items)}
