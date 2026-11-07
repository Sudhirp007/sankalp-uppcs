"""Tests for multi-source consensus engine, series mapper, and dispute logging."""
from __future__ import annotations

import json
import pytest

from src.crawler.discovery_fallback import KeyDiscoveryEngine
from src.normalizer.schema import ParsedMCQ
from src.pipeline import persist_mcqs
from src.reconciliation.consensus_engine import ConsensusEngine, SourceAnswer
from src.reconciliation.series_mapper import SeriesMapper
from src.storage.models import DisputeLog, Question, RawChunk


def _mcq(qno: int, text: str, options: list[str], correct: str = "A"):
    return ParsedMCQ.model_validate(
        {
            "question_number": qno,
            "subject": "Indian Polity & Governance",
            "topic": "Indian Polity & Governance -> Preamble -> Basic Structure",
            "difficulty": "EASY",
            "question_en": text,
            "question_hi": "हिंदी प्रश्न: " + text,
            "options": [{"key": k, "text_en": t, "text_hi": "विकल्प " + t} for k, t in zip("ABCD", options)],
            "correct_option": correct,
            "explanation_en": "Authoritative factual explanation.",
        }
    )


@pytest.fixture()
def test_db(tmp_path):
    from src.storage import database as db

    db._engine = None
    db._SessionLocal = None
    db.init_db(f"sqlite:///{(tmp_path / 'recon.db').as_posix()}")
    yield db
    db._engine = None
    db._SessionLocal = None


def test_series_mapper_by_hash(test_db):
    db = test_db
    with db.session_scope() as s:
        db.upsert_paper(s, id="series_a", exam_name="UPPCS", paper_name="GS1 Series A", year=2025, series="A")
        db.upsert_paper(s, id="series_c", exam_name="UPPCS", paper_name="GS1 Series C", year=2025, series="C")
        db.replace_chunks(s, "series_a", [{"chunk_index": 0, "page_start": 1, "page_end": 1, "text": "x", "extraction_method": "TEXT"}])
        db.replace_chunks(s, "series_c", [{"chunk_index": 0, "page_start": 1, "page_end": 1, "text": "x", "extraction_method": "TEXT"}])

    with db.session_scope() as s:
        ca = s.query(RawChunk).filter_by(paper_id="series_a").one()
        cb = s.query(RawChunk).filter_by(paper_id="series_c").one()

        # In Series A, question is #1.
        persist_mcqs(s, ca, [_mcq(1, "What is the capital of India?", ["Delhi", "Mumbai", "Kolkata", "Chennai"], "A")])
        # In Series C, the identical question is #28.
        persist_mcqs(s, cb, [_mcq(28, "What is the capital of India?", ["Mumbai", "Delhi", "Chennai", "Kolkata"], "B")])

    with db.session_scope() as s:
        mapper = SeriesMapper(s)
        mapping = mapper.map_by_content_hash(target_paper_id="series_c", reference_paper_id="series_a")
        assert 28 in mapping
        assert mapping[28].canonical_qno == 1
        assert mapping[28].matched_by == "HASH"


def test_consensus_engine_unanimous_disputed_and_canceled(test_db):
    db = test_db
    with db.session_scope() as s:
        db.upsert_paper(s, id="paper_2025", exam_name="UPPCS", paper_name="GS1", year=2025)
        db.replace_chunks(s, "paper_2025", [{"chunk_index": 0, "page_start": 1, "page_end": 1, "text": "x", "extraction_method": "TEXT"}])

    with db.session_scope() as s:
        c = s.query(RawChunk).filter_by(paper_id="paper_2025").one()
        persist_mcqs(
            s,
            c,
            [
                _mcq(1, "Question 1 stem", ["A1", "B1", "C1", "D1"]),
                _mcq(2, "Question 2 stem", ["A2", "B2", "C2", "D2"]),
                _mcq(3, "Question 3 stem", ["A3", "B3", "C3", "D3"]),
            ],
        )

    # Prepare keys:
    # Q1: Drishti=B, Dhyeya=B, SSGCP=B (unanimous consensus)
    # Q2: Drishti=B, Dhyeya=C, SSGCP=B (dispute: B vs C)
    # Q3: Commission final key = X (canceled question)
    source_map = {
        1: [
            SourceAnswer(source_name="Drishti IAS", source_type="THIRD_PARTY", correct_option="B"),
            SourceAnswer(source_name="Dhyeya IAS", source_type="THIRD_PARTY", correct_option="B"),
            SourceAnswer(source_name="SSGCP", source_type="THIRD_PARTY", correct_option="B"),
        ],
        2: [
            SourceAnswer(source_name="Drishti IAS", source_type="THIRD_PARTY", correct_option="B"),
            SourceAnswer(source_name="Dhyeya IAS", source_type="THIRD_PARTY", correct_option="C"),
            SourceAnswer(source_name="SSGCP", source_type="THIRD_PARTY", correct_option="B"),
        ],
        3: [
            SourceAnswer(source_name="Official Final Key", source_type="OFFICIAL_FINAL", correct_option="X"),
        ],
    }

    with db.session_scope() as s:
        consensus = ConsensusEngine(s)
        stats = consensus.apply_reconciliation("paper_2025", source_map)
        assert stats["reconciled"] == 3
        assert stats["verified"] == 1
        assert stats["disputed"] == 1
        assert stats["canceled"] == 1

    with db.session_scope() as s:
        q1 = s.query(Question).filter_by(question_number=1).one()
        assert q1.status == "VERIFIED"
        assert q1.correct_option == "B"
        assert q1.confidence_score == 1.0

        q2 = s.query(Question).filter_by(question_number=2).one()
        assert q2.status == "DISPUTED"
        assert q2.correct_option == "B"  # majority choice
        assert q2.confidence_score == 0.67

        # Verify dispute log entry created for Q2
        dispute = s.query(DisputeLog).filter_by(question_id=q2.id).one()
        conflicts = json.loads(dispute.conflicting_keys_json)
        assert conflicts["Drishti IAS"] == "B"
        assert conflicts["Dhyeya IAS"] == "C"

        q3 = s.query(Question).filter_by(question_number=3).one()
        assert q3.status == "CANCELED"
        assert q3.correct_option == "X"
