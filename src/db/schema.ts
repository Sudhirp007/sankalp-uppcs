import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export interface LocalizedOption {
  key: "A" | "B" | "C" | "D";
  text: string;
}

export interface CheatSheetContent {
  summary: string;
  matrixTitle?: string;
  matrixHeaders?: string[];
  matrixRows?: string[][];
  keyArticles?: Array<{ badge: string; title: string; detail: string; tag?: string }>;
  chronologyLock?: { title: string; chain: string; rule: string };
}

// 1. Canonical Exams (UPPCS Prelims, RO/ARO, ACF/RFO, GIC Lecturer, BEO)
export const exams = pgTable("exams", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameHi: text("name_hi").notNull(),
  shortNameEn: text("short_name_en").notNull(),
  shortNameHi: text("short_name_hi").notNull(),
  conductingBody: text("conducting_body").notNull().default("UPPSC"),
  descriptionEn: text("description_en").notNull(),
  descriptionHi: text("description_hi").notNull(),
  totalQuestions: integer("total_questions").notNull().default(150),
  maxMarks: doublePrecision("max_marks").notNull().default(200),
  durationMins: integer("duration_mins").notNull().default(120),
  positiveMarks: doublePrecision("positive_marks").notNull().default(1.3333),
  negativeMarkingRatio: doublePrecision("negative_marking_ratio").notNull().default(0.3333),
  historicalCutoff: doublePrecision("historical_cutoff").notNull().default(88.4),
  targetCycleLabel: text("target_cycle_label").notNull().default("2026 Cycle"),
  daysRemaining: integer("days_remaining").notNull().default(182),
  isActive: boolean("is_active").notNull().default(true),
});

// 2. 3-Tier Canonical Syllabus Hierarchy (Subject -> Theme -> Micro-Topic)
export const syllabusTopics = pgTable(
  "syllabus_topics",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    parentId: text("parent_id"),
    level: integer("level").notNull().default(1), // 1 = Subject, 2 = Module, 3 = Micro-Topic
    subjectKey: text("subject_key").notNull(),
    nameEn: text("name_en").notNull(),
    nameHi: text("name_hi").notNull(),
    descriptionEn: text("description_en"),
    descriptionHi: text("description_hi"),
    isHighYield: boolean("is_high_yield").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("idx_syllabus_parent").on(t.parentId), index("idx_syllabus_subject").on(t.subjectKey)]
);

// 3. Per-Exam Syllabus Weightage Map (Powers Cross-Exam Readiness Matrix)
export const examSyllabusMap = pgTable(
  "exam_syllabus_map",
  {
    id: text("id").primaryKey(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => syllabusTopics.id, { onDelete: "cascade" }),
    expectedWeightPct: doublePrecision("expected_weight_pct").notNull().default(10),
    priorityTier: text("priority_tier").notNull().default("CORE"), // HIGH_YIELD | CORE | PERIPHERAL
  },
  (t) => [uniqueIndex("uq_exam_topic_map").on(t.examId, t.topicId)]
);

// 4. Exam Papers & Simulated Mocks
export const examPapers = pgTable(
  "exam_papers",
  {
    id: text("id").primaryKey(),
    examId: text("exam_id").references(() => exams.id, { onDelete: "set null" }),
    examName: text("exam_name").notNull(),
    paperNameEn: text("paper_name_en").notNull(),
    paperNameHi: text("paper_name_hi").notNull(),
    paperCode: text("paper_code"),
    stage: text("stage").default("PRELIMS"),
    year: integer("year"),
    series: text("series"),
    paperType: text("paper_type").notNull().default("OFFICIAL_PYQ"), // OFFICIAL_PYQ | CONCEPT_MOCK | SECTIONAL
    hasOfficialKey: boolean("has_official_key").notNull().default(false),
    totalQuestions: integer("total_questions").notNull().default(150),
    maxMarks: doublePrecision("max_marks").notNull().default(200),
    durationMins: integer("duration_mins").notNull().default(120),
    isPremium: boolean("is_premium").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_papers_exam_year").on(t.examId, t.year)]
);

// 5. Bilingual Single-Source-of-Truth Question Bank (Projected Strictly Single-Language at API Boundary)
export const questions = pgTable(
  "questions",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id").references(() => examPapers.id, { onDelete: "set null" }),
    topicId: text("topic_id").references(() => syllabusTopics.id, { onDelete: "set null" }),
    questionNumber: integer("question_number"),
    subject: text("subject").notNull().default("General Studies"),
    topicRaw: text("topic_raw"),
    difficulty: text("difficulty").notNull().default("MEDIUM"), // EASY | MEDIUM | HARD
    questionOrigin: text("question_origin").notNull().default("PYQ"), // PYQ | CONCEPT_BUILDER | NCERT_DRILL | MOCK | CURRENT_AFFAIRS
    questionFormat: text("question_format").notNull().default("SINGLE_CHOICE"), // SINGLE_CHOICE | MULTI_STATEMENT | ASSERTION_REASON | MATCH_LIST | CHRONOLOGY
    languageCoverage: text("language_coverage").notNull().default("BILINGUAL"), // BILINGUAL | EN | HI
    questionEn: text("question_en").notNull(),
    questionHi: text("question_hi"),
    optionsEn: jsonb("options_en").$type<LocalizedOption[]>().notNull(),
    optionsHi: jsonb("options_hi").$type<LocalizedOption[]>(),
    correctOption: text("correct_option").notNull(), // A | B | C | D | X (deleted/bonus)
    explanationEn: text("explanation_en"),
    explanationHi: text("explanation_hi"),
    goldenRuleEn: text("golden_rule_en"),
    goldenRuleHi: text("golden_rule_hi"),
    sourceKeyType: text("source_key_type").notNull().default("LLM_INFERRED"),
    confidenceScore: doublePrecision("confidence_score").notNull().default(1.0),
    contentHash: text("content_hash").unique(),
    status: text("status").notNull().default("VERIFIED"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_q_topic").on(t.topicId),
    index("idx_q_paper").on(t.paperId, t.questionNumber),
    index("idx_q_subject").on(t.subject),
    index("idx_q_origin").on(t.questionOrigin),
  ]
);

// 6. Cross-Exam Repeated PYQ Lineage
export const questionVariants = pgTable(
  "question_variants",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    paperId: text("paper_id").references(() => examPapers.id, { onDelete: "cascade" }),
    paperLabelEn: text("paper_label_en").notNull(),
    paperLabelHi: text("paper_label_hi").notNull(),
    questionNumber: integer("question_number"),
  },
  (t) => [index("idx_variants_question").on(t.questionId)]
);

// 7. Commission Key Dispute Audit Logs
export const disputeLogs = pgTable("dispute_logs", {
  id: text("id").primaryKey(),
  questionId: text("question_id")
    .notNull()
    .references(() => questions.id, { onDelete: "cascade" }),
  disputedSources: text("disputed_sources"),
  committeeNotesEn: text("committee_notes_en"),
  committeeNotesHi: text("committee_notes_hi"),
  statusFlag: text("status_flag").notNull().default("VERIFIED"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 8. Question Embeddings Metadata (Paired with pgvector extension)
export const questionEmbeddings = pgTable("question_embeddings", {
  questionId: text("question_id")
    .primaryKey()
    .references(() => questions.id, { onDelete: "cascade" }),
  modelName: text("model_name").notNull().default("gemini-embedding-001"),
  dimensions: integer("dimensions").notNull().default(768),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 9. Topic Learning Studio Artifacts (High-Yield Cheat Sheets, Comparison Tables, Notes)
export const learningArtifacts = pgTable(
  "learning_artifacts",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => syllabusTopics.id, { onDelete: "cascade" }),
    artifactType: text("artifact_type").notNull().default("CHEAT_SHEET"), // CHEAT_SHEET | COMPARISON_TABLE | CONCEPT_NOTE
    titleEn: text("title_en").notNull(),
    titleHi: text("title_hi").notNull(),
    estReadMins: integer("est_read_mins").notNull().default(3),
    pyqCoverageCount: integer("pyq_coverage_count").notNull().default(12),
    canonicalSourceEn: text("canonical_source_en").notNull().default("Laxmikanth & Official Bare Act"),
    canonicalSourceHi: text("canonical_source_hi").notNull().default("लक्ष्मीकांत एवं आधिकारिक संविधान बेयर एक्ट"),
    contentEn: jsonb("content_en").$type<CheatSheetContent>().notNull(),
    contentHi: jsonb("content_hi").$type<CheatSheetContent>().notNull(),
    coveredQuestionIds: jsonb("covered_question_ids").$type<string[]>().notNull().default([]),
    isPremium: boolean("is_premium").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_artifacts_topic").on(t.topicId)]
);

// 10. Active-Recall Flashcards (Bilingual Source, Projected Strictly Single-Language)
export const flashcards = pgTable(
  "flashcards",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => syllabusTopics.id, { onDelete: "cascade" }),
    sourceQuestionId: text("source_question_id").references(() => questions.id, { onDelete: "set null" }),
    deckCategory: text("deck_category").notNull().default("ARTICLES"),
    cardTypeLabelEn: text("card_type_label_en").notNull().default("Constitutional Article & Concept Recall"),
    cardTypeLabelHi: text("card_type_label_hi").notNull().default("संवैधानिक अनुच्छेद एवं अवधारणा स्मरण"),
    frontEn: text("front_en").notNull(),
    frontHi: text("front_hi").notNull(),
    backEn: text("back_en").notNull(),
    backHi: text("back_hi").notNull(),
    trapWarningEn: text("trap_warning_en"),
    trapWarningHi: text("trap_warning_hi"),
    mnemonicEn: text("mnemonic_en"),
    mnemonicHi: text("mnemonic_hi"),
    askedInLabelEn: text("asked_in_label_en"),
    askedInLabelHi: text("asked_in_label_hi"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_flashcards_topic").on(t.topicId)]
);

// 11. Users (Profile Language Preference + Active Exam Context + Subscription Tier)
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").unique(),
  email: text("email"),
  displayName: text("display_name").notNull().default("UPPSC Aspirant"),
  preferredLanguage: text("preferred_language").notNull().default("EN"), // STRICT: 'EN' | 'HI'
  activeExamId: text("active_exam_id").references(() => exams.id, { onDelete: "set null" }),
  dailyGoalMins: integer("daily_goal_mins").notNull().default(45),
  streakDays: integer("streak_days").notNull().default(1),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  planTier: text("plan_tier").notNull().default("FREE"), // FREE | PRO_PASS
  proExpiresAt: timestamp("pro_expires_at"),
  scratchpadNotes: jsonb("scratchpad_notes").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 12. Isolated Per-Exam Learning Journeys
export const userExamJourneys = pgTable(
  "user_exam_journeys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    readinessScore: doublePrecision("readiness_score").notNull().default(52),
    predictedScore: doublePrecision("predicted_score").notNull().default(82),
    syllabusCoveredPct: doublePrecision("syllabus_covered_pct").notNull().default(18),
    testsCompleted: integer("tests_completed").notNull().default(0),
    questionsPracticed: integer("questions_practiced").notNull().default(0),
    accuracyPct: doublePrecision("accuracy_pct").notNull().default(0),
    guess5050NetGain: doublePrecision("guess_50_50_net_gain").notNull().default(0),
    enrolledAt: timestamp("enrolled_at").defaultNow().notNull(),
    lastActiveAt: timestamp("last_active_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_user_exam_journey").on(t.userId, t.examId)]
);

// 13. Unified Global Cross-Exam Topic Mastery (Feeds All UPPSC Exam Readiness Calculations)
export const userTopicMastery = pgTable(
  "user_topic_mastery",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => syllabusTopics.id, { onDelete: "cascade" }),
    masteryScore: doublePrecision("mastery_score").notNull().default(50),
    attemptsCount: integer("attempts_count").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    wrongCount: integer("wrong_count").notNull().default(0),
    lastPracticedAt: timestamp("last_practiced_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_user_topic_mastery").on(t.userId, t.topicId)]
);

// 14. Test & Practice Sessions
export const testSessions = pgTable(
  "test_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    paperId: text("paper_id").references(() => examPapers.id, { onDelete: "set null" }),
    sessionType: text("session_type").notNull().default("TOPIC_DRILL"), // FULL_PAPER | TOPIC_DRILL | ADAPTIVE_SMART_DRILL
    mode: text("mode").notNull().default("EXAM"), // EXAM | TUTOR
    titleEn: text("title_en").notNull(),
    titleHi: text("title_hi").notNull(),
    languageLocked: text("language_locked").notNull().default("EN"),
    status: text("status").notNull().default("IN_PROGRESS"), // IN_PROGRESS | SUBMITTED
    durationSec: integer("duration_sec").notNull().default(1800),
    elapsedSec: integer("elapsed_sec").notNull().default(0),
    totalQuestions: integer("total_questions").notNull().default(20),
    correctCount: integer("correct_count").notNull().default(0),
    wrongCount: integer("wrong_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    canceledCount: integer("canceled_count").notNull().default(0),
    grossMarks: doublePrecision("gross_marks").notNull().default(0),
    negativeMarks: doublePrecision("negative_marks").notNull().default(0),
    netMarks: doublePrecision("net_marks").notNull().default(0),
    maxMarks: doublePrecision("max_marks").notNull().default(26.66),
    guess5050NetGain: doublePrecision("guess_50_50_net_gain").notNull().default(0),
    wildGuessNetGain: doublePrecision("wild_guess_net_gain").notNull().default(0),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    submittedAt: timestamp("submitted_at"),
  },
  (t) => [index("idx_sessions_user_exam").on(t.userId, t.examId)]
);

// 15. Per-Question Attempt Telemetry (50-50 Strikethroughs, Confidence Tag, Time Spent)
export const testAttemptItems = pgTable(
  "test_attempt_items",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => testSessions.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull(),
    selectedOption: text("selected_option"), // A | B | C | D | null
    eliminatedOptions: jsonb("eliminated_options").$type<string[]>().notNull().default([]),
    confidenceTag: text("confidence_tag").notNull().default("SURE"), // SURE | GUESS_50_50 | WILD_GUESS
    isMarkedReview: boolean("is_marked_review").notNull().default(false),
    timeSpentSec: integer("time_spent_sec").notNull().default(0),
    isCorrect: boolean("is_correct"),
    marksAwarded: doublePrecision("marks_awarded").notNull().default(0),
  },
  (t) => [uniqueIndex("uq_session_question").on(t.sessionId, t.questionId)]
);

// 16. Spaced Repetition (FSRS / SM-2) State for Flashcards & Past Test Mistakes
export const userItemSrs = pgTable(
  "user_item_srs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    flashcardId: text("flashcard_id")
      .notNull()
      .references(() => flashcards.id, { onDelete: "cascade" }),
    sourceQuestionId: text("source_question_id").references(() => questions.id, { onDelete: "set null" }),
    originType: text("origin_type").notNull().default("TOPIC_DECK"), // TOPIC_DECK | TEST_MISTAKE
    originLabelEn: text("origin_label_en"),
    originLabelHi: text("origin_label_hi"),
    stability: doublePrecision("stability").notNull().default(2.5),
    difficultyFactor: doublePrecision("difficulty_factor").notNull().default(2.5),
    intervalDays: doublePrecision("interval_days").notNull().default(0),
    repetitions: integer("repetitions").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    lastRating: integer("last_rating"), // 1=Again, 2=Hard, 3=Good, 4=Easy
    nextDueAt: timestamp("next_due_at").defaultNow().notNull(),
    lastReviewedAt: timestamp("last_reviewed_at"),
  },
  (t) => [
    uniqueIndex("uq_user_flashcard_srs").on(t.userId, t.flashcardId),
    index("idx_srs_user_due").on(t.userId, t.nextDueAt),
  ]
);

// 17. Razorpay Subscription Plans
export const subscriptionPlans = pgTable("subscription_plans", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameHi: text("name_hi").notNull(),
  badgeEn: text("badge_en").notNull(),
  badgeHi: text("badge_hi").notNull(),
  amountPaise: integer("amount_paise").notNull(), // e.g., 49900 = ₹499
  currency: text("currency").notNull().default("INR"),
  validityDays: integer("validity_days").notNull().default(365),
  featuresEn: jsonb("features_en").$type<string[]>().notNull(),
  featuresHi: jsonb("features_hi").$type<string[]>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

// 18. Razorpay Payment Orders & HMAC Signature Verification Ledger
export const paymentOrders = pgTable(
  "payment_orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: "restrict" }),
    razorpayOrderId: text("razorpay_order_id").notNull().unique(),
    razorpayPaymentId: text("razorpay_payment_id"),
    razorpaySignature: text("razorpay_signature"),
    amountPaise: integer("amount_paise").notNull(),
    currency: text("currency").notNull().default("INR"),
    status: text("status").notNull().default("CREATED"), // CREATED | PAID | FAILED
    isSandbox: boolean("is_sandbox").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    verifiedAt: timestamp("verified_at"),
  },
  (t) => [index("idx_orders_user").on(t.userId)]
);
