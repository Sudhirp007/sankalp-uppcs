"""SQLAlchemy 2.0 ORM models.

The core tables (``exam_papers``, ``questions``) mirror the live exam-engine schema
and stay SQLite / Cloudflare D1 / PostgreSQL compatible. Pipeline-internal tables:

* ``raw_chunks``          – extracted text waiting for LLM normalisation (staging).
* ``answer_keys``         – official answer-key entries keyed by paper + question number.
* ``question_variants``   – the same question seen in another paper / series.
* ``question_embeddings`` – provider-agnostic embedding store + background job queue.
"""
from __future__ import annotations

import uuid
from array import array
from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator, UserDefinedType


def new_uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --------------------------------------------------------------------------- #
# Dimension-agnostic vector type
# --------------------------------------------------------------------------- #
class _PgVector(UserDefinedType):
    """pgvector column *without* a fixed dimension (``vector``).

    Dimension is deliberately unset until an embedding model is chosen; a typed
    column + HNSW index can be added later via migration (see README).
    """

    cache_ok = True

    def get_col_spec(self, **kw) -> str:  # noqa: D401
        return "vector"


class EmbeddingVector(TypeDecorator):
    """Float vector stored as packed float32 BLOB on SQLite and ``vector`` on PostgreSQL."""

    impl = LargeBinary
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(_PgVector())
        return dialect.type_descriptor(LargeBinary())

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            return "[" + ",".join(f"{float(v):.8g}" for v in value) + "]"
        return array("f", (float(v) for v in value)).tobytes()

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, (bytes, bytearray, memoryview)):
            arr = array("f")
            arr.frombytes(bytes(value))
            return list(arr)
        if isinstance(value, str):
            return [float(x) for x in value.strip("[]").split(",") if x]
        return list(value)


class Base(DeclarativeBase):
    pass


# --------------------------------------------------------------------------- #
# Core tables (mirrors live exam engine)
# --------------------------------------------------------------------------- #
class ExamPaper(Base):
    __tablename__ = "exam_papers"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    exam_name: Mapped[str] = mapped_column(Text, nullable=False)
    paper_name: Mapped[str] = mapped_column(Text, nullable=False)
    stage: Mapped[str | None] = mapped_column(Text)  # PRELIMS | MAINS
    paper_code: Mapped[str | None] = mapped_column(Text)  # GS Paper 1, CSAT Paper 2
    year: Mapped[int | None] = mapped_column(Integer)
    series: Mapped[str | None] = mapped_column(Text)  # 'A'..'D' booklet series
    has_official_key: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    source_url: Mapped[str | None] = mapped_column(Text)
    provenance_url: Mapped[str | None] = mapped_column(Text)
    local_file_path: Mapped[str | None] = mapped_column(Text)
    file_sha256: Mapped[str | None] = mapped_column(Text, unique=True)
    page_count: Mapped[int | None] = mapped_column(Integer)
    document_type: Mapped[str] = mapped_column(Text, default="QUESTION_PAPER", server_default="QUESTION_PAPER")
    scraped_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())

    questions: Mapped[list[Question]] = relationship(back_populates="paper")
    chunks: Mapped[list[RawChunk]] = relationship(back_populates="paper", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("document_type IN ('QUESTION_PAPER','ANSWER_KEY','OTHER')", name="ck_paper_doctype"),
    )


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    paper_id: Mapped[str | None] = mapped_column(Text, ForeignKey("exam_papers.id"))
    question_number: Mapped[int | None] = mapped_column(Integer)
    subject: Mapped[str | None] = mapped_column(Text)
    topic: Mapped[str | None] = mapped_column(Text)  # Micro-topic
    difficulty: Mapped[str] = mapped_column(Text, default="MEDIUM", server_default="MEDIUM")
    language: Mapped[str] = mapped_column(Text, default="EN", server_default="EN")
    question_en: Mapped[str] = mapped_column(Text, nullable=False)
    question_hi: Mapped[str | None] = mapped_column(Text)
    options_json: Mapped[str] = mapped_column(Text, nullable=False)
    correct_option: Mapped[str] = mapped_column(Text, nullable=False)
    explanation_en: Mapped[str | None] = mapped_column(Text)
    explanation_hi: Mapped[str | None] = mapped_column(Text)
    source_key_type: Mapped[str] = mapped_column(
        Text, default="UNKNOWN", server_default="UNKNOWN"
    )  # OFFICIAL_FINAL | OFFICIAL_PROVISIONAL | THIRD_PARTY_CONSENSUS | THIRD_PARTY | LLM_INFERRED | UNKNOWN
    confidence_score: Mapped[float] = mapped_column(Float, default=1.0, server_default="1.0")
    content_hash: Mapped[str | None] = mapped_column(Text, unique=True)
    status: Mapped[str] = mapped_column(Text, default="PENDING", server_default="PENDING")
    # Legacy / alias compatibility
    answer_source: Mapped[str] = mapped_column(Text, default="UNKNOWN", server_default="UNKNOWN")
    chunk_id: Mapped[str | None] = mapped_column(Text, ForeignKey("raw_chunks.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, server_default=func.current_timestamp()
    )

    paper: Mapped[ExamPaper | None] = relationship(back_populates="questions")
    variants: Mapped[list[QuestionVariant]] = relationship(back_populates="question", cascade="all, delete-orphan")
    dispute_logs: Mapped[list[DisputeLog]] = relationship(back_populates="question", cascade="all, delete-orphan")
    embeddings: Mapped[list[QuestionEmbedding]] = relationship(
        back_populates="question", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_questions_subject", "subject"),
        Index("idx_questions_hash", "content_hash"),
        Index("idx_questions_paper_qno", "paper_id", "question_number"),
        Index("idx_questions_status", "status"),
        CheckConstraint("difficulty IN ('EASY','MEDIUM','HARD')", name="ck_q_difficulty"),
        CheckConstraint("language IN ('EN','HI','BILINGUAL')", name="ck_q_language"),
        CheckConstraint("correct_option IN ('A','B','C','D','X')", name="ck_q_correct"),
        CheckConstraint("status IN ('PENDING','VERIFIED','DISPUTED','CANCELED','REJECTED')", name="ck_q_status"),
        CheckConstraint(
            "source_key_type IN ('OFFICIAL_FINAL','OFFICIAL_PROVISIONAL','THIRD_PARTY_CONSENSUS','THIRD_PARTY','LLM_INFERRED','UNKNOWN')",
            name="ck_q_source_key_type",
        ),
    )


class DisputeLog(Base):
    """Audit log for disputed or contested questions."""

    __tablename__ = "dispute_logs"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    question_id: Mapped[str] = mapped_column(Text, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    disputed_sources: Mapped[str | None] = mapped_column(Text)
    conflicting_keys_json: Mapped[str | None] = mapped_column(Text)
    committee_notes: Mapped[str | None] = mapped_column(Text)
    status_flag: Mapped[str] = mapped_column(Text, default="PENDING_REVIEW", server_default="PENDING_REVIEW")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, server_default=func.current_timestamp())

    question: Mapped[Question] = relationship(back_populates="dispute_logs")


# --------------------------------------------------------------------------- #
# Pipeline tables
# --------------------------------------------------------------------------- #
class StagedQuestion(Base):
    """Quarantine / Human-in-the-Loop staging table for LLM-enriched questions.

    Questions land here after normalization, are evaluated by the Automated Quality
    Gate (`quality_score`, `quality_flags_json`, `review_status`), verified/edited
    in the Split-Screen Human Review UI, and only promoted to the final `questions`
    table once `review_status == 'APPROVED'`.
    """

    __tablename__ = "staged_questions"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    paper_id: Mapped[str | None] = mapped_column(Text, ForeignKey("exam_papers.id", ondelete="CASCADE"))
    chunk_id: Mapped[str | None] = mapped_column(Text, ForeignKey("raw_chunks.id", ondelete="SET NULL"))
    page_number: Mapped[int | None] = mapped_column(Integer)
    question_number: Mapped[int | None] = mapped_column(Integer)
    subject: Mapped[str | None] = mapped_column(Text)
    topic: Mapped[str | None] = mapped_column(Text)
    difficulty: Mapped[str] = mapped_column(Text, default="MEDIUM", server_default="MEDIUM")
    language: Mapped[str] = mapped_column(Text, default="BILINGUAL", server_default="BILINGUAL")
    question_en: Mapped[str] = mapped_column(Text, nullable=False)
    question_hi: Mapped[str | None] = mapped_column(Text)
    options_json: Mapped[str] = mapped_column(Text, nullable=False)
    correct_option: Mapped[str] = mapped_column(Text, nullable=False, default="A")
    explanation_en: Mapped[str | None] = mapped_column(Text)
    explanation_hi: Mapped[str | None] = mapped_column(Text)
    source_key_type: Mapped[str] = mapped_column(Text, default="UNKNOWN", server_default="UNKNOWN")
    confidence_score: Mapped[float] = mapped_column(Float, default=0.5, server_default="0.5")
    answer_source: Mapped[str] = mapped_column(Text, default="UNKNOWN", server_default="UNKNOWN")
    content_hash: Mapped[str | None] = mapped_column(Text)

    # Quality Gate & Human Verification metadata
    quality_score: Mapped[float] = mapped_column(Float, default=1.0, server_default="1.0")
    quality_flags_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    review_status: Mapped[str] = mapped_column(
        Text, default="READY", server_default="READY"
    )  # FLAGGED | READY | APPROVED | REJECTED
    reviewer_notes: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    promoted_question_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("questions.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, server_default=func.current_timestamp()
    )

    __table_args__ = (
        Index("idx_staged_paper_qno", "paper_id", "question_number"),
        Index("idx_staged_review_status", "review_status"),
        Index("idx_staged_quality_score", "quality_score"),
        CheckConstraint(
            "review_status IN ('FLAGGED','ENGLISH_ONLY','READY','APPROVED','REJECTED')",
            name="ck_staged_review_status",
        ),
    )


class RawChunk(Base):
    """Text slice of a paper awaiting (or done with) LLM normalisation."""

    __tablename__ = "raw_chunks"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    paper_id: Mapped[str] = mapped_column(Text, ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    page_start: Mapped[int] = mapped_column(Integer, nullable=False)  # 1-based
    page_end: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    char_count: Mapped[int] = mapped_column(Integer, default=0)
    extraction_method: Mapped[str] = mapped_column(Text, default="TEXT")  # TEXT | OCR | MIXED
    status: Mapped[str] = mapped_column(Text, default="PENDING", server_default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    questions_found: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    normalized_at: Mapped[datetime | None] = mapped_column(DateTime)

    paper: Mapped[ExamPaper] = relationship(back_populates="chunks")

    __table_args__ = (
        UniqueConstraint("paper_id", "chunk_index", name="uq_chunk_paper_index"),
        Index("idx_chunks_status", "status"),
        CheckConstraint("status IN ('PENDING','NORMALIZED','FAILED','SKIPPED')", name="ck_chunk_status"),
        CheckConstraint("extraction_method IN ('TEXT','OCR','MIXED')", name="ck_chunk_method"),
    )


class AnswerKeyEntry(Base):
    """One official answer: (paper, question number) -> option."""

    __tablename__ = "answer_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    paper_id: Mapped[str] = mapped_column(Text, ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False)
    question_number: Mapped[int] = mapped_column(Integer, nullable=False)
    correct_option: Mapped[str] = mapped_column(Text, nullable=False)  # A-D, or X = deleted/bonus
    source: Mapped[str | None] = mapped_column(Text)  # file / url the key came from
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (UniqueConstraint("paper_id", "question_number", name="uq_answer_paper_qno"),)


class QuestionVariant(Base):
    """Records where a (deduplicated) question also appeared — e.g. Series B vs Series A."""

    __tablename__ = "question_variants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[str] = mapped_column(Text, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    paper_id: Mapped[str | None] = mapped_column(Text, ForeignKey("exam_papers.id", ondelete="CASCADE"))
    question_number: Mapped[int | None] = mapped_column(Integer)
    seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    question: Mapped[Question] = relationship(back_populates="variants")

    __table_args__ = (
        UniqueConstraint("question_id", "paper_id", "question_number", name="uq_variant"),
    )


class QuestionEmbedding(Base):
    """Provider-agnostic embedding row; also serves as the background job queue.

    Lifecycle: PENDING -> PROCESSING -> DONE | FAILED; DONE -> STALE when the
    question's ``content_hash`` changes after generation.
    One row per (question, provider, model) so multiple models can coexist.
    """

    __tablename__ = "question_embeddings"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    question_id: Mapped[str] = mapped_column(Text, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)  # e.g. 'gemini'
    model: Mapped[str] = mapped_column(String(128), nullable=False)  # e.g. 'gemini-embedding-001'
    model_version: Mapped[str | None] = mapped_column(String(64))
    task_type: Mapped[str | None] = mapped_column(String(64))  # e.g. RETRIEVAL_DOCUMENT
    dimensions: Mapped[int | None] = mapped_column(Integer)  # recorded per row; not fixed in schema
    embedding: Mapped[list[float] | None] = mapped_column(EmbeddingVector)
    source_content_hash: Mapped[str | None] = mapped_column(Text)  # questions.content_hash at generation
    status: Mapped[str] = mapped_column(Text, default="PENDING", server_default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    error: Mapped[str | None] = mapped_column(Text)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime)  # worker lease timestamp
    generated_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    question: Mapped[Question] = relationship(back_populates="embeddings")

    __table_args__ = (
        UniqueConstraint("question_id", "provider", "model", name="uq_embedding_q_model"),
        Index("idx_embeddings_status", "status"),
        CheckConstraint(
            "status IN ('PENDING','PROCESSING','DONE','FAILED','STALE')", name="ck_embedding_status"
        ),
    )
