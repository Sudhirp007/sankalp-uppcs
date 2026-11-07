"""Unit tests: dedup hashing, column parser heuristics, schema validation, exporter, embeddings queue."""
from __future__ import annotations

import asyncio
import json
import sqlite3

import pytest

from src.normalizer.gemini_cleaner import validate_batch_json
from src.normalizer.schema import ParsedMCQ
from src.parsers.pdf_column_parser import PageExtraction, ColumnText, build_chunks, detect_gutter, text_quality
from src.storage.deduplicator import content_hash, normalize_text
from src.storage.exporter import sql_literal


# ----------------------------------------------------------------- dedup
@pytest.mark.parametrize(
    "raw",
    ["Q.14 Which river is the longest?", "14. Which river is the longest?", "(14) which river is THE longest",
     "Question 14: Which river is the longest ?", "प्रश्न 14 Which river is the longest?"],
)
def test_normalize_strips_numbers_and_punct(raw):
    assert normalize_text(raw) == "which river is the longest"


def test_normalize_keeps_decimals_and_hindi():
    assert normalize_text("14.5% of GDP is?") .startswith("14 5")
    assert "भारत" in normalize_text("1. भारत की राजधानी क्या है?")


def test_hash_invariant_to_option_order_but_not_options():
    a = content_hash("Which is correct?", ["Only 1", "Only 2", "Both", "Neither"])
    b = content_hash("Q.7 Which is correct ?", ["(b) Only 2", "(a) Only 1", "Neither", "Both"])
    c = content_hash("Which is correct?", ["Only 3", "Only 2", "Both", "Neither"])
    assert a == b
    assert a != c


# ----------------------------------------------------------------- parser
def test_text_quality_separates_english_from_mismapped_hindi():
    english = "Which of the following statements is correct about the Indian Constitution? (a) Only 1 (b) Only 2"
    garbage = "3TEI 37 1A 1 i d tT TI1 fi fi flT wmff rpfkr TT9T 3Tf1jtr"
    assert text_quality(english) > 0.8
    assert text_quality(garbage) < 0.4
    assert text_quality("भारत का संविधान किस वर्ष लागू हुआ?") > 0.8
    assert text_quality("broken \ufffd glyphs") == 0.0


def _blk(x0, x1, y0=0, y1=10):
    return (x0, y0, x1, y1, "text", 0, 0)


def test_detect_gutter_two_columns_with_skew():
    blocks = [_blk(60, 300), _blk(65, 306), _blk(55, 325), _blk(70, 290), _blk(318, 520), _blk(306, 521), _blk(330, 500)]
    g = detect_gutter(blocks, 612)
    assert g is not None and 290 < g < 320


def test_detect_gutter_single_column():
    blocks = [_blk(60, 550), _blk(62, 540), _blk(61, 545), _blk(70, 500)]
    assert detect_gutter(blocks, 612) is None


def test_build_chunks_skips_instruction_pages_and_adds_lookahead():
    q = "1. Question?\n(a) x\n(b) y\n(c) z\n(d) w"
    pages = [PageExtraction(1, [ColumnText("FULL", "Instructions to candidates")])] + [
        PageExtraction(i, [ColumnText("LEFT", q * 3), ColumnText("RIGHT", "हिंदी " + q)], True) for i in range(2, 6)
    ]
    chunks = build_chunks(pages, max_chars=250)
    assert chunks[0]["page_start"] == 2
    assert all(c["page_start"] >= 2 for c in chunks)
    assert "LOOKAHEAD" in chunks[0]["text"] and "LOOKAHEAD" not in chunks[-1]["text"]


# ----------------------------------------------------------------- schema
def _mcq(**kw):
    base = dict(
        question_number=1, subject="Indian Polity", topic="Preamble", difficulty="EASY",
        question_en="Which word was added by the 42nd Amendment?",
        options=[{"key": k, "text_en": t} for k, t in zip("DCBA", ["Republic", "Sovereign", "Democratic", "Socialist"])],
        correct_option="A",
    )
    base.update(kw)
    return base


def test_parsed_mcq_sorts_and_validates_options():
    m = ParsedMCQ.model_validate(_mcq())
    assert [o.key for o in m.options] == ["A", "B", "C", "D"]
    assert m.language == "EN"
    assert ParsedMCQ.model_validate(_mcq(question_hi="प्रश्न")).language == "BILINGUAL"
    with pytest.raises(Exception):
        ParsedMCQ.model_validate(_mcq(options=[{"key": "A", "text_en": "x"}]))


def test_validate_batch_keeps_good_items():
    raw = json.dumps({"questions": [_mcq(), _mcq(options=[]), _mcq(question_number=3)]})
    res = validate_batch_json(raw)
    assert len(res.questions) == 2 and len(res.invalid) == 1 and res.raw_count == 3


# ----------------------------------------------------------------- export
def test_sql_literal_escaping_roundtrip():
    tricky = "It's \"quoted\"; DROP TABLE x; -- \n भारत"
    lit = sql_literal(tricky)
    con = sqlite3.connect(":memory:")
    assert con.execute(f"SELECT {lit}").fetchone()[0] == tricky
    assert sql_literal(None) == "NULL" and sql_literal(5) == "5"


# ----------------------------------------------------------------- end-to-end (in-memory DB)
@pytest.fixture()
def mem_db(tmp_path, monkeypatch):
    from src.storage import database as db

    db._engine = None
    db._SessionLocal = None
    db.init_db(f"sqlite:///{(tmp_path / 't.db').as_posix()}")
    yield db
    db._engine = None
    db._SessionLocal = None


def test_persist_dedup_variants_and_answer_keys(mem_db, tmp_path):
    from src.pipeline import persist_mcqs
    from src.storage.exporter import export_json, export_sql
    from src.storage.models import AnswerKeyEntry, Question, RawChunk

    db = mem_db
    with db.session_scope() as s:
        db.upsert_paper(s, id="p_a", exam_name="UPPCS", paper_name="GS1 Series A", year=2025)
        db.upsert_paper(s, id="p_b", exam_name="UPPCS", paper_name="GS1 Series B", year=2025)
        db.replace_chunks(s, "p_a", [{"chunk_index": 0, "page_start": 1, "page_end": 1, "text": "x", "extraction_method": "TEXT"}])
        db.replace_chunks(s, "p_b", [{"chunk_index": 0, "page_start": 1, "page_end": 1, "text": "x", "extraction_method": "TEXT"}])
        s.add(AnswerKeyEntry(paper_id="p_a", question_number=1, correct_option="D"))
    with db.session_scope() as s:
        ca = s.query(RawChunk).filter_by(paper_id="p_a").one()
        cb = s.query(RawChunk).filter_by(paper_id="p_b").one()
        assert persist_mcqs(s, ca, [ParsedMCQ.model_validate(_mcq())]) == (1, 0)
        assert persist_mcqs(s, cb, [ParsedMCQ.model_validate(_mcq(question_number=37))]) == (0, 1)
    with db.session_scope() as s:
        q = s.query(Question).one()
        assert q.correct_option == "D" and q.answer_source in ("OFFICIAL_FINAL", "OFFICIAL_KEY")
        assert [(v.paper_id, v.question_number) for v in q.variants] == [("p_b", 37)]
        out = tmp_path / "d1.sql"
        export_sql(s, out, fmt="d1")
        export_json(s, tmp_path / "m.json")
        pg = tmp_path / "pg.sql"
        export_sql(s, pg, fmt="postgres")
    # The D1 script must execute cleanly on a fresh SQLite database.
    con = sqlite3.connect(":memory:")
    con.executescript(out.read_text(encoding="utf-8"))
    assert con.execute("SELECT count(*) FROM questions").fetchone()[0] == 1
    assert "chunk_id" not in out.read_text(encoding="utf-8")
    pg_sql = pg.read_text(encoding="utf-8")
    assert "CREATE EXTENSION IF NOT EXISTS vector" in pg_sql and "embedding vector" in pg_sql


def test_embedding_queue_with_fake_provider(mem_db):
    from src.embeddings import service
    from src.embeddings.base import FakeEmbeddingProvider
    from src.pipeline import persist_mcqs
    from src.storage.models import QuestionEmbedding, RawChunk

    db = mem_db
    with db.session_scope() as s:
        db.upsert_paper(s, id="p", exam_name="UPPCS", paper_name="GS1", year=2025)
        db.replace_chunks(s, "p", [{"chunk_index": 0, "page_start": 1, "page_end": 1, "text": "x", "extraction_method": "TEXT"}])
    with db.session_scope() as s:
        persist_mcqs(s, s.query(RawChunk).one(), [ParsedMCQ.model_validate(_mcq())])
        assert service.enqueue(s, "fake", "sha256-hash") == 1
        assert service.enqueue(s, "fake", "sha256-hash") == 0  # idempotent
    res = asyncio.run(service.run_worker(db.session_scope, FakeEmbeddingProvider(dimensions=8)))
    assert res["done"] == 1
    with db.session_scope() as s:
        e = s.query(QuestionEmbedding).one()
        assert e.status == "DONE" and e.dimensions == 8 and len(e.embedding) == 8 and e.generated_at


def test_quality_gate_and_staging_promotion_flow(mem_db):
    from src.normalizer.quality_gate import evaluate_question_quality
    from src.pipeline import promote_staged_questions, stage_mcqs
    from src.storage.models import Question, RawChunk, StagedQuestion

    # 1. Quality gate catches truncated option and missing qno
    bad_opts = [
        {"key": "A", "text_en": "Sorghum, Millet, Ragi", "text_hi": "ज्वार, बाजरा, रागी"},
        {"key": "B", "text_en": "Pulse, Oats,", "text_hi": ""},
        {"key": "C", "text_en": "Wheat", "text_hi": "गेहूँ"},
        {"key": "D", "text_en": "Rice", "text_hi": "चावल"},
    ]
    score, flags = evaluate_question_quality(
        question_number=None,
        question_en="Which of the following cereal group is included in",
        question_hi="निम्नलिखित में से कौन सा अनाज समूह शामिल है?",
        options=bad_opts,
    )
    codes = {f["code"] for f in flags}
    assert score < 0.5
    assert "MISSING_QNO" in codes
    assert "TRUNCATED_STEM_EN" in codes
    assert "TRUNCATED_OPTION_EN_B" in codes
    assert "EMPTY_OPTION_HI_B" in codes

    # 2. Stage -> Human Edit & Approve -> Promote to final `questions` table
    db = mem_db
    with db.session_scope() as s:
        db.upsert_paper(s, id="p_hitl", exam_name="UPPCS", paper_name="GS1", year=2025)
        db.replace_chunks(
            s,
            "p_hitl",
            [{"chunk_index": 0, "page_start": 2, "page_end": 3, "text": "### PAGE 2\n8. Cereal?", "extraction_method": "OCR"}],
        )
    with db.session_scope() as s:
        chunk = s.query(RawChunk).filter_by(paper_id="p_hitl").one()
        staged_cnt, flagged_cnt = stage_mcqs(
            s,
            chunk,
            [
                ParsedMCQ.model_validate(
                    _mcq(
                        question_number=None,
                        question_en="Which of the following cereal group is included in",
                        question_hi="निम्नलिखित में से कौन सा अनाज समूह शामिल है?",
                        options=bad_opts,
                    )
                )
            ],
        )
        assert staged_cnt == 1 and flagged_cnt == 1
        assert s.query(Question).count() == 0  # Quarantine: not in final questions yet!

        sq = s.query(StagedQuestion).one()
        assert sq.review_status == "FLAGGED"
        # Simulate Human Verification edit & approval
        sq.question_number = 8
        sq.question_en = "Which of the following cereal group is included in coarse grains?"
        fixed_opts = list(bad_opts)
        fixed_opts[1] = {"key": "B", "text_en": "Pulse, Oats, Barley", "text_hi": "दाल, जई, जौ"}
        sq.options_json = json.dumps(fixed_opts, ensure_ascii=False)
        sq.review_status = "APPROVED"

        res = promote_staged_questions(s)
        assert res["inserted"] == 1
        final_q = s.query(Question).one()
        assert final_q.status == "VERIFIED"
        assert final_q.question_number == 8
        assert "coarse grains" in final_q.question_en
        assert sq.promoted_question_id == final_q.id
