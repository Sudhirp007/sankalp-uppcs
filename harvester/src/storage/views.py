"""SQL Views for DBeaver Data Exploration and Exam Test Engine."""
from __future__ import annotations

import logging
from sqlalchemy import text
from src.storage import database as db

log = logging.getLogger(__name__)

VIEW_STATEMENTS = [
    # 1. Flattened questions view for easy DBeaver data grid inspection
    """
    CREATE VIEW IF NOT EXISTS v_questions_flat AS
    SELECT 
        q.id AS question_id,
        p.id AS paper_id,
        p.exam_name,
        p.paper_name,
        p.year,
        p.stage,
        q.question_number,
        q.subject,
        q.topic,
        q.difficulty,
        q.language,
        q.question_en,
        q.question_hi,
        json_extract(q.options_json, '$[0].text_en') AS option_a_en,
        json_extract(q.options_json, '$[0].text_hi') AS option_a_hi,
        json_extract(q.options_json, '$[1].text_en') AS option_b_en,
        json_extract(q.options_json, '$[1].text_hi') AS option_b_hi,
        json_extract(q.options_json, '$[2].text_en') AS option_c_en,
        json_extract(q.options_json, '$[2].text_hi') AS option_c_hi,
        json_extract(q.options_json, '$[3].text_en') AS option_d_en,
        json_extract(q.options_json, '$[3].text_hi') AS option_d_hi,
        q.correct_option,
        q.explanation_en,
        q.explanation_hi,
        q.source_key_type,
        q.confidence_score,
        q.status,
        q.answer_source,
        q.created_at
    FROM questions q
    LEFT JOIN exam_papers p ON q.paper_id = p.id;
    """,
    # 2. Subject and micro-topic analytics view
    """
    CREATE VIEW IF NOT EXISTS v_subject_topic_analytics AS
    SELECT 
        COALESCE(subject, 'Unassigned') AS subject,
        COALESCE(topic, 'General') AS topic,
        COUNT(*) AS total_questions,
        SUM(CASE WHEN difficulty = 'EASY' THEN 1 ELSE 0 END) AS easy_count,
        SUM(CASE WHEN difficulty = 'MEDIUM' THEN 1 ELSE 0 END) AS medium_count,
        SUM(CASE WHEN difficulty = 'HARD' THEN 1 ELSE 0 END) AS hard_count,
        ROUND(AVG(confidence_score), 2) AS avg_confidence,
        SUM(CASE WHEN status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified_count
    FROM questions
    GROUP BY subject, topic
    ORDER BY total_questions DESC;
    """,
    # 3. High-level paper inventory summary
    """
    CREATE VIEW IF NOT EXISTS v_paper_summary AS
    SELECT 
        p.id AS paper_id,
        p.exam_name,
        p.paper_name,
        p.year,
        p.stage,
        p.document_type,
        COUNT(q.id) AS total_questions,
        COUNT(DISTINCT q.subject) AS distinct_subjects,
        SUM(CASE WHEN q.difficulty = 'EASY' THEN 1 ELSE 0 END) AS easy_count,
        SUM(CASE WHEN q.difficulty = 'MEDIUM' THEN 1 ELSE 0 END) AS medium_count,
        SUM(CASE WHEN q.difficulty = 'HARD' THEN 1 ELSE 0 END) AS hard_count
    FROM exam_papers p
    LEFT JOIN questions q ON p.id = q.paper_id
    GROUP BY p.id;
    """,
    # 4. Production-ready test engine view
    """
    CREATE VIEW IF NOT EXISTS v_exam_test_engine AS
    SELECT 
        q.id,
        q.paper_id,
        q.question_number,
        q.subject,
        q.topic,
        q.difficulty,
        q.question_en,
        q.question_hi,
        q.options_json,
        q.correct_option,
        q.explanation_en,
        q.explanation_hi
    FROM questions q
    WHERE q.status IN ('VERIFIED', 'PENDING');
    """,
    # 5. Staged Human Verification review queue view
    """
    CREATE VIEW IF NOT EXISTS v_staged_review_queue AS
    SELECT
        sq.id AS staged_id,
        sq.review_status,
        sq.quality_score,
        sq.quality_flags_json,
        sq.paper_id,
        p.exam_name,
        p.paper_name,
        p.year,
        sq.page_number,
        sq.question_number,
        sq.subject,
        sq.topic,
        sq.difficulty,
        sq.question_en,
        sq.question_hi,
        json_extract(sq.options_json, '$[0].text_en') AS option_a_en,
        json_extract(sq.options_json, '$[0].text_hi') AS option_a_hi,
        json_extract(sq.options_json, '$[1].text_en') AS option_b_en,
        json_extract(sq.options_json, '$[1].text_hi') AS option_b_hi,
        json_extract(sq.options_json, '$[2].text_en') AS option_c_en,
        json_extract(sq.options_json, '$[2].text_hi') AS option_c_hi,
        json_extract(sq.options_json, '$[3].text_en') AS option_d_en,
        json_extract(sq.options_json, '$[3].text_hi') AS option_d_hi,
        sq.correct_option,
        sq.explanation_en,
        sq.explanation_hi,
        sq.promoted_question_id,
        sq.reviewed_at
    FROM staged_questions sq
    LEFT JOIN exam_papers p ON sq.paper_id = p.id
    ORDER BY
        CASE sq.review_status
            WHEN 'FLAGGED' THEN 0
            WHEN 'READY' THEN 1
            WHEN 'APPROVED' THEN 2
            ELSE 3
        END,
        sq.quality_score ASC,
        sq.paper_id,
        sq.question_number;
    """,
]


def install_views(db_url: str | None = None) -> list[str]:
    engine = db.get_engine(db_url)
    with engine.begin() as conn:
        for stmt in VIEW_STATEMENTS:
            conn.execute(text(stmt))
        rows = conn.execute(text("SELECT name FROM sqlite_master WHERE type='view'")).fetchall()
        view_names = [r[0] for r in rows]
    log.info("Installed SQLite views: %s", view_names)
    return view_names


if __name__ == "__main__":
    views = install_views()
    print("Successfully installed views:")
    for v in views:
        print("  -", v)
