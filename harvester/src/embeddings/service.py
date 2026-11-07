"""Embedding job queue on top of ``question_embeddings``.

Designed to run from any background runner (cron, Celery, a Render/Cloud Run job,
a Cloudflare Queue consumer...) without touching the ingestion pipeline:

* :func:`enqueue`      – DB-only; creates PENDING rows for questions missing an embedding.
* :func:`mark_stale`   – flags DONE rows whose question text changed since generation.
* :func:`claim_batch`  – leases PENDING/STALE/expired rows (PROCESSING + ``claimed_at``).
* :func:`run_worker`   – claims, embeds via a provider, stores vector + metadata.
"""
from __future__ import annotations

import json
import logging
from datetime import timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from src.embeddings.base import EmbeddingProvider
from src.storage.models import Question, QuestionEmbedding, utcnow

log = logging.getLogger(__name__)

DEFAULT_LEASE = timedelta(minutes=15)
MAX_ATTEMPTS = 5


def build_embedding_text(q: Question) -> str:
    """Canonical text that gets embedded (question + options, bilingual when available)."""
    opts = json.loads(q.options_json or "[]")
    parts = [q.question_en.strip()]
    parts += [f"({o['key']}) {o.get('text_en', '')}" for o in opts]
    if q.question_hi:
        parts.append(q.question_hi.strip())
        parts += [f"({o['key']}) {o['text_hi']}" for o in opts if o.get("text_hi")]
    if q.subject or q.topic:
        parts.append(f"Subject: {q.subject or ''} | Topic: {q.topic or ''}")
    return "\n".join(p for p in parts if p)


def enqueue(session: Session, provider: str, model: str, *, task_type: str | None = None, limit: int | None = None) -> int:
    """Create PENDING rows for (non-rejected) questions lacking one for this provider/model. No API calls."""
    existing = select(QuestionEmbedding.question_id).where(
        QuestionEmbedding.provider == provider, QuestionEmbedding.model == model
    )
    stmt = select(Question.id, Question.content_hash).where(
        Question.status != "REJECTED", Question.id.not_in(existing)
    )
    if limit:
        stmt = stmt.limit(limit)
    n = 0
    for qid, chash in session.execute(stmt):
        session.add(
            QuestionEmbedding(
                question_id=qid,
                provider=provider,
                model=model,
                task_type=task_type,
                source_content_hash=chash,
                status="PENDING",
            )
        )
        n += 1
    session.flush()
    return n


def mark_stale(session: Session) -> int:
    rows = session.execute(
        select(QuestionEmbedding, Question.content_hash)
        .join(Question, Question.id == QuestionEmbedding.question_id)
        .where(QuestionEmbedding.status == "DONE", QuestionEmbedding.source_content_hash != Question.content_hash)
    ).all()
    for emb, _chash in rows:
        emb.status = "STALE"  # source_content_hash keeps the old value until regenerated
    session.flush()
    return len(rows)


def claim_batch(
    session: Session, provider: str, model: str, size: int, lease: timedelta = DEFAULT_LEASE
) -> list[QuestionEmbedding]:
    """Lease up to ``size`` rows. Expired PROCESSING leases are reclaimed.

    On PostgreSQL, wrap with ``SELECT ... FOR UPDATE SKIP LOCKED`` for multi-worker
    safety (enabled automatically below); SQLite serialises writers anyway.
    """
    now = utcnow()
    stmt = (
        select(QuestionEmbedding)
        .where(
            QuestionEmbedding.provider == provider,
            QuestionEmbedding.model == model,
            QuestionEmbedding.attempts < MAX_ATTEMPTS,
            or_(
                QuestionEmbedding.status.in_(("PENDING", "STALE", "FAILED")),
                and_(QuestionEmbedding.status == "PROCESSING", QuestionEmbedding.claimed_at < now - lease),
            ),
        )
        .order_by(QuestionEmbedding.created_at)
        .limit(size)
    )
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        stmt = stmt.with_for_update(skip_locked=True)
    rows = session.scalars(stmt).all()
    for r in rows:
        r.status = "PROCESSING"
        r.claimed_at = now
        r.attempts = (r.attempts or 0) + 1
    session.flush()
    return rows


async def run_worker(
    session_factory, provider: EmbeddingProvider, *, batch_size: int | None = None, max_batches: int | None = None
) -> dict:
    """Process queued rows for ``provider`` until empty (or ``max_batches``)."""
    batch_size = batch_size or provider.max_batch_size
    done = failed = batches = 0
    while max_batches is None or batches < max_batches:
        with session_factory() as s:
            rows = claim_batch(s, provider.name, provider.model, batch_size)
            payload = [(r.id, build_embedding_text(r.question), r.question.content_hash) for r in rows]
        if not payload:
            break
        batches += 1
        try:
            vectors = await provider.embed([t for _, t, _ in payload])
            if len(vectors) != len(payload):
                raise ValueError(f"provider returned {len(vectors)} vectors for {len(payload)} texts")
        except Exception as exc:
            log.exception("Embedding batch failed")
            with session_factory() as s:
                for rid, _, _ in payload:
                    r = s.get(QuestionEmbedding, rid)
                    r.status, r.error = "FAILED", str(exc)[:500]
            failed += len(payload)
            continue
        with session_factory() as s:
            for (rid, _, chash), vec in zip(payload, vectors):
                r = s.get(QuestionEmbedding, rid)
                r.embedding = vec
                r.dimensions = len(vec)
                r.model_version = provider.model_version
                r.task_type = provider.task_type or r.task_type
                r.source_content_hash = chash
                r.status, r.error, r.generated_at = "DONE", None, utcnow()
        done += len(payload)
    return {"done": done, "failed": failed, "batches": batches}


def status_counts(session: Session) -> list[tuple]:
    return session.execute(
        select(QuestionEmbedding.provider, QuestionEmbedding.model, QuestionEmbedding.status, func.count())
        .group_by(QuestionEmbedding.provider, QuestionEmbedding.model, QuestionEmbedding.status)
        .order_by(QuestionEmbedding.provider, QuestionEmbedding.model)
    ).all()
