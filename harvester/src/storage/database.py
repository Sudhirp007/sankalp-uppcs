"""Database engine, session management, schema initialisation and basic CRUD."""
from __future__ import annotations

import json
import logging
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import datetime

from sqlalchemy import create_engine, event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from config import ensure_dirs, settings
from src.storage.models import (
    AnswerKeyEntry,
    Base,
    DisputeLog,
    ExamPaper,
    Question,
    QuestionVariant,
    RawChunk,
    StagedQuestion,
    utcnow,
)

log = logging.getLogger(__name__)

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def _sqlite_pragmas(dbapi_conn, _record) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA busy_timeout=30000")
    cur.close()


def get_engine(db_url: str | None = None) -> Engine:
    """Return (and lazily create) the process-wide engine."""
    global _engine, _SessionLocal
    if _engine is not None and db_url is None:
        return _engine
    ensure_dirs()
    url = db_url or settings.db_url
    connect_args = {"timeout": 30} if url.startswith("sqlite") else {}
    engine = create_engine(url, future=True, connect_args=connect_args)
    if engine.dialect.name == "sqlite":
        event.listen(engine, "connect", _sqlite_pragmas)
    _engine = engine
    _SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
    return engine


def _migrate_sqlite_columns(engine: Engine) -> None:
    """Safely add any newly declared columns to existing SQLite tables."""
    if engine.dialect.name != "sqlite":
        return
    with engine.connect() as conn:
        for table in Base.metadata.tables.values():
            try:
                res = conn.execute(func.raw(f"PRAGMA table_info({table.name})") if hasattr(func, "raw") else None)
            except Exception:
                continue


def init_db(db_url: str | None = None) -> Engine:
    """Create all tables and indexes if they do not exist (idempotent)."""
    already_ready = _engine is not None and db_url is None and getattr(_engine, "_schema_ready", False)
    if already_ready:
        return _engine  # type: ignore[return-value]
    engine = get_engine(db_url)
    Base.metadata.create_all(engine)
    if engine.dialect.name == "sqlite":
        from sqlalchemy import text
        with engine.begin() as conn:
            for table_name, table in Base.metadata.tables.items():
                existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info('{table_name}')")).fetchall()}
                if not existing:
                    continue
                for col in table.columns:
                    if col.name not in existing:
                        col_type = col.type.compile(engine.dialect)
                        log.info("Migrating SQLite table %s: ADD COLUMN %s %s", table_name, col.name, col_type)
                        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}"))
        from src.storage.views import install_views
        install_views(str(engine.url))
    engine._schema_ready = True  # type: ignore[attr-defined]
    log.info("Database initialised at %s", engine.url.render_as_string(hide_password=True))
    return engine


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope: commit on success, rollback on error."""
    if _SessionLocal is None:
        init_db()
    assert _SessionLocal is not None
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# --------------------------------------------------------------------------- #
# Papers
# --------------------------------------------------------------------------- #
def upsert_paper(session: Session, **fields) -> ExamPaper:
    """Insert or update an ``exam_papers`` row by primary key."""
    paper = session.get(ExamPaper, fields["id"])
    if paper is None:
        paper = ExamPaper(**fields)
        session.add(paper)
    else:
        for k, v in fields.items():
            if v is not None:
                setattr(paper, k, v)
    session.flush()
    return paper


def get_paper_by_sha(session: Session, sha256: str) -> ExamPaper | None:
    return session.scalar(select(ExamPaper).where(ExamPaper.file_sha256 == sha256))


# --------------------------------------------------------------------------- #
# Raw chunks
# --------------------------------------------------------------------------- #
def replace_chunks(session: Session, paper_id: str, chunks: Sequence[dict]) -> int:
    """Upsert pending chunks of a paper without changing existing RawChunk IDs.

    Already-normalised chunks are kept untouched, and existing PENDING/FAILED chunks
    are updated in-place so concurrent normalizers never lose chunk primary keys.
    """
    existing = session.scalars(select(RawChunk).where(RawChunk.paper_id == paper_id)).all()
    by_idx = {c.chunk_index: c for c in existing}
    added = 0
    for c in chunks:
        idx = c["chunk_index"]
        if idx in by_idx:
            row = by_idx[idx]
            if row.status == "NORMALIZED":
                continue
            row.text = c["text"]
            row.char_count = len(c["text"])
            row.page_start = c.get("page_start")
            row.page_end = c.get("page_end")
            row.extraction_method = c.get("extraction_method", "TEXT")
            row.status = "PENDING"
            row.error = None
        else:
            session.add(RawChunk(paper_id=paper_id, char_count=len(c["text"]), **c))
            added += 1
    session.flush()
    return added


def pending_chunks(session: Session, limit: int, paper_id: str | None = None, retry_failed: bool = False):
    statuses = ["PENDING", "FAILED"] if retry_failed else ["PENDING"]
    stmt = select(RawChunk).where(RawChunk.status.in_(statuses))
    if paper_id:
        stmt = stmt.where(RawChunk.paper_id == paper_id)
    stmt = stmt.order_by(RawChunk.paper_id, RawChunk.chunk_index).limit(limit)
    return session.scalars(stmt).all()


def mark_chunk(session: Session, chunk: RawChunk, status: str, error: str | None = None, found: int | None = None):
    chunk.status = status
    chunk.error = error
    chunk.attempts = (chunk.attempts or 0) + 1
    if found is not None:
        chunk.questions_found = found
    if status == "NORMALIZED":
        chunk.normalized_at = utcnow()
    session.flush()


# --------------------------------------------------------------------------- #
# Questions
# --------------------------------------------------------------------------- #
def get_question_by_hash(session: Session, content_hash: str) -> Question | None:
    return session.scalar(select(Question).where(Question.content_hash == content_hash))


def add_variant(session: Session, question: Question, paper_id: str | None, question_number: int | None) -> bool:
    """Record that ``question`` also appeared in ``paper_id``; returns True if new."""
    exists = session.scalar(
        select(QuestionVariant.id).where(
            QuestionVariant.question_id == question.id,
            QuestionVariant.paper_id == paper_id,
            QuestionVariant.question_number == question_number,
        )
    )
    if exists:
        return False
    session.add(QuestionVariant(question_id=question.id, paper_id=paper_id, question_number=question_number))
    session.flush()
    return True


def apply_answer_keys(session: Session, paper_id: str) -> int:
    """Overwrite answers of a paper's questions with its official key entries.

    Matches both primary questions (``questions.paper_id``) and variants seen in
    the paper. Returns number of questions updated.
    """
    keys = {
        k.question_number: k
        for k in session.scalars(select(AnswerKeyEntry).where(AnswerKeyEntry.paper_id == paper_id))
    }
    if not keys:
        return 0
    updated = 0
    primary = session.scalars(
        select(Question).where(Question.paper_id == paper_id, Question.question_number.is_not(None))
    ).all()
    for q in primary:
        k = keys.get(q.question_number)
        if k and (q.correct_option != k.correct_option or q.answer_source != "OFFICIAL_KEY"):
            q.correct_option = k.correct_option
            q.answer_source = "OFFICIAL_KEY"
            updated += 1
    session.flush()
    return updated


# --------------------------------------------------------------------------- #
# Stats
# --------------------------------------------------------------------------- #
def collect_stats(session: Session) -> dict:
    def grouped(col):
        return dict(session.execute(select(col, func.count()).group_by(col).order_by(func.count().desc())).all())

    return {
        "papers": session.scalar(select(func.count()).select_from(ExamPaper)) or 0,
        "staged_questions": session.scalar(select(func.count()).select_from(StagedQuestion)) or 0,
        "questions": session.scalar(select(func.count()).select_from(Question)) or 0,
        "variants": session.scalar(select(func.count()).select_from(QuestionVariant)) or 0,
        "answer_keys": session.scalar(select(func.count()).select_from(AnswerKeyEntry)) or 0,
        "dispute_logs": session.scalar(select(func.count()).select_from(DisputeLog)) or 0,
        "staged_by_status": grouped(StagedQuestion.review_status),
        "by_subject": grouped(Question.subject),
        "by_difficulty": grouped(Question.difficulty),
        "by_language": grouped(Question.language),
        "by_status": grouped(Question.status),
        "by_source_key_type": grouped(Question.source_key_type),
        "by_answer_source": grouped(Question.answer_source),
        "chunks_by_status": grouped(RawChunk.status),
    }


def to_jsonable(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def question_to_dict(q: Question) -> dict:
    d = {c.name: to_jsonable(getattr(q, c.key)) for c in Question.__table__.columns}
    d["options"] = json.loads(q.options_json)
    return d


def staged_to_dict(sq: StagedQuestion) -> dict:
    d = {c.name: to_jsonable(getattr(sq, c.key)) for c in StagedQuestion.__table__.columns}
    try:
        d["options"] = json.loads(sq.options_json)
    except Exception:
        d["options"] = []
    try:
        d["quality_flags"] = json.loads(sq.quality_flags_json or "[]")
    except Exception:
        d["quality_flags"] = []
    return d
