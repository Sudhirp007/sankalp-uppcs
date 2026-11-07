import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { loadNodeNeonDatabaseUrl } from "../src/db/node-env";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

async function main() {
  const directUrl =
    process.env.DATABASE_URL_UNPOOLED || loadNodeNeonDatabaseUrl();
  if (!directUrl) {
    throw new Error("Missing DATABASE_URL_UNPOOLED / DATABASE_URL in .env.local");
  }

  console.log("[migrate] Connecting to Neon direct endpoint for DDL migration...");
  const sql = neon(directUrl);

  // Enable pgvector on Neon Lakebase Postgres
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  console.log("[migrate] Enabled extension: vector");

  const ddlStatements = [
    `CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name_en TEXT NOT NULL,
      name_hi TEXT NOT NULL,
      short_name_en TEXT NOT NULL,
      short_name_hi TEXT NOT NULL,
      conducting_body TEXT NOT NULL DEFAULT 'UPPSC',
      description_en TEXT NOT NULL,
      description_hi TEXT NOT NULL,
      total_questions INTEGER NOT NULL DEFAULT 150,
      max_marks DOUBLE PRECISION NOT NULL DEFAULT 200,
      duration_mins INTEGER NOT NULL DEFAULT 120,
      positive_marks DOUBLE PRECISION NOT NULL DEFAULT 1.3333,
      negative_marking_ratio DOUBLE PRECISION NOT NULL DEFAULT 0.3333,
      historical_cutoff DOUBLE PRECISION NOT NULL DEFAULT 88.4,
      target_cycle_label TEXT NOT NULL DEFAULT '2026 Cycle',
      days_remaining INTEGER NOT NULL DEFAULT 182,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )`,
    `CREATE TABLE IF NOT EXISTS syllabus_topics (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      parent_id TEXT,
      level INTEGER NOT NULL DEFAULT 1,
      subject_key TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_hi TEXT NOT NULL,
      description_en TEXT,
      description_hi TEXT,
      is_high_yield BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_syllabus_parent ON syllabus_topics(parent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_syllabus_subject ON syllabus_topics(subject_key)`,
    `CREATE TABLE IF NOT EXISTS exam_syllabus_map (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL REFERENCES syllabus_topics(id) ON DELETE CASCADE,
      expected_weight_pct DOUBLE PRECISION NOT NULL DEFAULT 10,
      priority_tier TEXT NOT NULL DEFAULT 'CORE',
      CONSTRAINT uq_exam_topic_map UNIQUE (exam_id, topic_id)
    )`,
    `CREATE TABLE IF NOT EXISTS exam_papers (
      id TEXT PRIMARY KEY,
      exam_id TEXT REFERENCES exams(id) ON DELETE SET NULL,
      exam_name TEXT NOT NULL,
      paper_name_en TEXT NOT NULL,
      paper_name_hi TEXT NOT NULL,
      paper_code TEXT,
      stage TEXT DEFAULT 'PRELIMS',
      year INTEGER,
      series TEXT,
      paper_type TEXT NOT NULL DEFAULT 'OFFICIAL_PYQ',
      has_official_key BOOLEAN NOT NULL DEFAULT FALSE,
      total_questions INTEGER NOT NULL DEFAULT 150,
      max_marks DOUBLE PRECISION NOT NULL DEFAULT 200,
      duration_mins INTEGER NOT NULL DEFAULT 120,
      is_premium BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_papers_exam_year ON exam_papers(exam_id, year)`,
    `CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      paper_id TEXT REFERENCES exam_papers(id) ON DELETE SET NULL,
      topic_id TEXT REFERENCES syllabus_topics(id) ON DELETE SET NULL,
      question_number INTEGER,
      subject TEXT NOT NULL DEFAULT 'General Studies',
      topic_raw TEXT,
      difficulty TEXT NOT NULL DEFAULT 'MEDIUM',
      question_origin TEXT NOT NULL DEFAULT 'PYQ',
      question_format TEXT NOT NULL DEFAULT 'SINGLE_CHOICE',
      language_coverage TEXT NOT NULL DEFAULT 'BILINGUAL',
      question_en TEXT NOT NULL,
      question_hi TEXT,
      options_en JSONB NOT NULL,
      options_hi JSONB,
      correct_option TEXT NOT NULL,
      explanation_en TEXT,
      explanation_hi TEXT,
      golden_rule_en TEXT,
      golden_rule_hi TEXT,
      source_key_type TEXT NOT NULL DEFAULT 'LLM_INFERRED',
      confidence_score DOUBLE PRECISION NOT NULL DEFAULT 1.0,
      content_hash TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'VERIFIED',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_q_topic ON questions(topic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_q_paper ON questions(paper_id, question_number)`,
    `CREATE INDEX IF NOT EXISTS idx_q_subject ON questions(subject)`,
    `CREATE INDEX IF NOT EXISTS idx_q_origin ON questions(question_origin)`,
    `CREATE TABLE IF NOT EXISTS question_variants (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      paper_id TEXT REFERENCES exam_papers(id) ON DELETE CASCADE,
      paper_label_en TEXT NOT NULL,
      paper_label_hi TEXT NOT NULL,
      question_number INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_variants_question ON question_variants(question_id)`,
    `CREATE TABLE IF NOT EXISTS dispute_logs (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      disputed_sources TEXT,
      committee_notes_en TEXT,
      committee_notes_hi TEXT,
      status_flag TEXT NOT NULL DEFAULT 'VERIFIED',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS question_embeddings (
      question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
      model_name TEXT NOT NULL DEFAULT 'gemini-embedding-001',
      dimensions INTEGER NOT NULL DEFAULT 768,
      embedding vector(768),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS learning_artifacts (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES syllabus_topics(id) ON DELETE CASCADE,
      artifact_type TEXT NOT NULL DEFAULT 'CHEAT_SHEET',
      title_en TEXT NOT NULL,
      title_hi TEXT NOT NULL,
      est_read_mins INTEGER NOT NULL DEFAULT 3,
      pyq_coverage_count INTEGER NOT NULL DEFAULT 12,
      canonical_source_en TEXT NOT NULL DEFAULT 'Laxmikanth & Official Bare Act',
      canonical_source_hi TEXT NOT NULL DEFAULT 'लक्ष्मीकांत एवं आधिकारिक संविधान बेयर एक्ट',
      content_en JSONB NOT NULL,
      content_hi JSONB NOT NULL,
      covered_question_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_premium BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_artifacts_topic ON learning_artifacts(topic_id)`,
    `CREATE TABLE IF NOT EXISTS flashcards (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES syllabus_topics(id) ON DELETE CASCADE,
      source_question_id TEXT REFERENCES questions(id) ON DELETE SET NULL,
      deck_category TEXT NOT NULL DEFAULT 'ARTICLES',
      card_type_label_en TEXT NOT NULL DEFAULT 'Constitutional Article & Concept Recall',
      card_type_label_hi TEXT NOT NULL DEFAULT 'संवैधानिक अनुच्छेद एवं अवधारणा स्मरण',
      front_en TEXT NOT NULL,
      front_hi TEXT NOT NULL,
      back_en TEXT NOT NULL,
      back_hi TEXT NOT NULL,
      trap_warning_en TEXT,
      trap_warning_hi TEXT,
      mnemonic_en TEXT,
      mnemonic_hi TEXT,
      asked_in_label_en TEXT,
      asked_in_label_hi TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_flashcards_topic ON flashcards(topic_id)`,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      firebase_uid TEXT UNIQUE,
      email TEXT,
      display_name TEXT NOT NULL DEFAULT 'UPPSC Aspirant',
      preferred_language TEXT NOT NULL DEFAULT 'EN',
      active_exam_id TEXT REFERENCES exams(id) ON DELETE SET NULL,
      daily_goal_mins INTEGER NOT NULL DEFAULT 45,
      streak_days INTEGER NOT NULL DEFAULT 1,
      onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
      plan_tier TEXT NOT NULL DEFAULT 'FREE',
      pro_expires_at TIMESTAMP,
      scratchpad_notes JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS user_exam_journeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      readiness_score DOUBLE PRECISION NOT NULL DEFAULT 52,
      predicted_score DOUBLE PRECISION NOT NULL DEFAULT 82,
      syllabus_covered_pct DOUBLE PRECISION NOT NULL DEFAULT 18,
      tests_completed INTEGER NOT NULL DEFAULT 0,
      questions_practiced INTEGER NOT NULL DEFAULT 0,
      accuracy_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
      guess_50_50_net_gain DOUBLE PRECISION NOT NULL DEFAULT 0,
      enrolled_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_active_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_user_exam_journey UNIQUE (user_id, exam_id)
    )`,
    `CREATE TABLE IF NOT EXISTS user_topic_mastery (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL REFERENCES syllabus_topics(id) ON DELETE CASCADE,
      mastery_score DOUBLE PRECISION NOT NULL DEFAULT 50,
      attempts_count INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL DEFAULT 0,
      last_practiced_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_user_topic_mastery UNIQUE (user_id, topic_id)
    )`,
    `CREATE TABLE IF NOT EXISTS test_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      paper_id TEXT REFERENCES exam_papers(id) ON DELETE SET NULL,
      session_type TEXT NOT NULL DEFAULT 'TOPIC_DRILL',
      mode TEXT NOT NULL DEFAULT 'EXAM',
      title_en TEXT NOT NULL,
      title_hi TEXT NOT NULL,
      language_locked TEXT NOT NULL DEFAULT 'EN',
      status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
      duration_sec INTEGER NOT NULL DEFAULT 1800,
      elapsed_sec INTEGER NOT NULL DEFAULT 0,
      total_questions INTEGER NOT NULL DEFAULT 20,
      correct_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      canceled_count INTEGER NOT NULL DEFAULT 0,
      gross_marks DOUBLE PRECISION NOT NULL DEFAULT 0,
      negative_marks DOUBLE PRECISION NOT NULL DEFAULT 0,
      net_marks DOUBLE PRECISION NOT NULL DEFAULT 0,
      max_marks DOUBLE PRECISION NOT NULL DEFAULT 26.66,
      guess_50_50_net_gain DOUBLE PRECISION NOT NULL DEFAULT 0,
      wild_guess_net_gain DOUBLE PRECISION NOT NULL DEFAULT 0,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_user_exam ON test_sessions(user_id, exam_id)`,
    `CREATE TABLE IF NOT EXISTS test_attempt_items (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      display_order INTEGER NOT NULL,
      selected_option TEXT,
      eliminated_options JSONB NOT NULL DEFAULT '[]'::jsonb,
      confidence_tag TEXT NOT NULL DEFAULT 'SURE',
      is_marked_review BOOLEAN NOT NULL DEFAULT FALSE,
      time_spent_sec INTEGER NOT NULL DEFAULT 0,
      is_correct BOOLEAN,
      marks_awarded DOUBLE PRECISION NOT NULL DEFAULT 0,
      CONSTRAINT uq_session_question UNIQUE (session_id, question_id)
    )`,
    `CREATE TABLE IF NOT EXISTS user_item_srs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      flashcard_id TEXT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
      source_question_id TEXT REFERENCES questions(id) ON DELETE SET NULL,
      origin_type TEXT NOT NULL DEFAULT 'TOPIC_DECK',
      origin_label_en TEXT,
      origin_label_hi TEXT,
      stability DOUBLE PRECISION NOT NULL DEFAULT 2.5,
      difficulty_factor DOUBLE PRECISION NOT NULL DEFAULT 2.5,
      interval_days DOUBLE PRECISION NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      last_rating INTEGER,
      next_due_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_reviewed_at TIMESTAMP,
      CONSTRAINT uq_user_flashcard_srs UNIQUE (user_id, flashcard_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_srs_user_due ON user_item_srs(user_id, next_due_at)`,
    `CREATE TABLE IF NOT EXISTS subscription_plans (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name_en TEXT NOT NULL,
      name_hi TEXT NOT NULL,
      badge_en TEXT NOT NULL,
      badge_hi TEXT NOT NULL,
      amount_paise INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      validity_days INTEGER NOT NULL DEFAULT 365,
      features_en JSONB NOT NULL,
      features_hi JSONB NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )`,
    `CREATE TABLE IF NOT EXISTS payment_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
      razorpay_order_id TEXT NOT NULL UNIQUE,
      razorpay_payment_id TEXT,
      razorpay_signature TEXT,
      amount_paise INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'CREATED',
      is_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      verified_at TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_orders_user ON payment_orders(user_id)`,
  ];

  for (const stmt of ddlStatements) {
    await sql.query(stmt);
  }

  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;
  console.log(`[migrate] Schema verified (${tables.length} public tables):`, tables.map((r) => r.table_name).join(", "));
}

main().catch((err) => {
  console.error("[migrate] Fatal error:", err);
  process.exit(1);
});
