import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, and, inArray, sql, asc, desc } from "drizzle-orm";
import { createDb, resolveDatabaseUrl } from "../db/client";
import * as schema from "../db/schema";
import { resolveRequestIdentity } from "./auth";
import { normalizeLang, pickArtifactContent, pickOptions, pickText, type LangCode } from "./projector";
import {
  computeHmacSha256Hex,
  createRazorpayOrder,
  createSandboxPaymentProof,
  timingSafeEqualHex,
  verifyRazorpayPaymentSignature,
} from "./razorpay";

export interface WorkerBindings {
  DATABASE_URL?: string;
  DATABASE_URL_UNPOOLED?: string;
  NEON_BRANCH?: string;
  FIREBASE_PROJECT_ID?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
}

type Variables = {
  userId: string;
  userLang: LangCode;
};

const app = new Hono<{ Bindings: WorkerBindings; Variables: Variables }>();

app.use("/api/*", cors());

// Helper: Ensure user row + baseline topic mastery & default journey exist
async function ensureUserRecord(
  db: ReturnType<typeof createDb>,
  req: Request,
  firebaseProjectId: string
) {
  const identity = await resolveRequestIdentity(req, firebaseProjectId);
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, identity.userId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  const newUser: typeof schema.users.$inferInsert = {
    id: identity.userId,
    firebaseUid: identity.firebaseUid,
    email: identity.email,
    displayName: identity.displayName,
    preferredLanguage: "EN",
    activeExamId: "uppcs-prelims",
    dailyGoalMins: 45,
    streakDays: 14,
    onboardingCompleted: false,
    planTier: "FREE",
    scratchpadNotes: {
      "cs-panchayati-raj":
        "Ashok Mehta (1977) = 2-tier + OPEN political party contest. Balwant Rai (1957) = 3-tier party-less.",
    },
  };

  await db.insert(schema.users).values(newUser).onConflictDoNothing();

  // Enroll default two UPPSC journeys (UPPCS Prelims + RO/ARO) so student immediately sees multi-journey switching
  await db
    .insert(schema.userExamJourneys)
    .values([
      {
        id: `${identity.userId}__uppcs-prelims`,
        userId: identity.userId,
        examId: "uppcs-prelims",
        isPrimary: true,
        readinessScore: 68,
        predictedScore: 94.8,
        syllabusCoveredPct: 66,
        testsCompleted: 2,
        questionsPracticed: 180,
        accuracyPct: 71.2,
        guess5050NetGain: 4.2,
      },
      {
        id: `${identity.userId}__uppsc-ro-aro`,
        userId: identity.userId,
        examId: "uppsc-ro-aro",
        isPrimary: false,
        readinessScore: 81,
        predictedScore: 136.2,
        syllabusCoveredPct: 74,
        testsCompleted: 1,
        questionsPracticed: 140,
        accuracyPct: 78.5,
        guess5050NetGain: 5.3,
      },
    ])
    .onConflictDoNothing();

  // Seed realistic baseline topic mastery across L3 topics so Global Cross-Exam Matrix & Subject Bars work out-of-the-box
  const baselineMastery: Array<[string, number, number, number]> = [
    ["top-polity-panchayat", 88, 28, 25],
    ["top-polity-ulb", 62, 16, 10],
    ["top-polity-pesa", 36, 11, 4],
    ["top-polity-const-bodies", 84, 34, 29],
    ["top-hist-modern", 76, 42, 32],
    ["top-up-special-gk", 74, 30, 22],
    ["top-sci-bio-agri", 71, 24, 17],
    ["top-env-biodiversity", 61, 22, 13],
    ["top-geo-rivers", 58, 26, 15],
    ["top-econ-fiscal", 41, 22, 9],
    ["top-ca-schemes", 72, 25, 18],
  ];

  await db
    .insert(schema.userTopicMastery)
    .values(
      baselineMastery.map(([topicId, score, attempts, correct]) => ({
        id: `${identity.userId}__${topicId}`,
        userId: identity.userId,
        topicId,
        masteryScore: score,
        attemptsCount: attempts,
        correctCount: correct,
        wrongCount: attempts - correct,
      }))
    )
    .onConflictDoNothing();

  // Seed starter due SRS cards (only global curated cards, never another user's private cards)
  const allCards = await db
    .select({ id: schema.flashcards.id })
    .from(schema.flashcards)
    .where(sql`${schema.flashcards.createdByUserId} IS NULL`);
  if (allCards.length > 0) {
    await db
      .insert(schema.userItemSrs)
      .values(
        allCards.map((fc, idx) => ({
          id: `${identity.userId}__${fc.id}`,
          userId: identity.userId,
          flashcardId: fc.id,
          originType: idx < 2 ? "TEST_MISTAKE" : "TOPIC_DECK",
          originLabelEn:
            idx < 2
              ? "Derived from Past Test Mistake (UPPCS Prelims 2024 - GS Paper I)"
              : "High-Yield Syllabus Deck",
          originLabelHi:
            idx < 2
              ? "पिछली परीक्षा त्रुटि से निर्मित (यूपीपीसीएस प्रा. 2024 - सामान्य अध्ययन-I)"
              : "उच्च-उपयोगी पाठ्यक्रम डेक",
          intervalDays: 0,
          repetitions: 0,
          nextDueAt: new Date(Date.now() - 60_000),
        }))
      )
      .onConflictDoNothing();
  }

  const created = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, identity.userId))
    .limit(1);
  return created[0];
}

// Helper: Recalculate cross-exam readiness across all exams from unified userTopicMastery
async function computeAllExamReadiness(
  db: ReturnType<typeof createDb>,
  userId: string,
  lang: LangCode
) {
  const [allExams, allMaps, userMasteryRows, enrolledRows] = await Promise.all([
    db.select().from(schema.exams).where(eq(schema.exams.isActive, true)),
    db.select().from(schema.examSyllabusMap),
    db.select().from(schema.userTopicMastery).where(eq(schema.userTopicMastery.userId, userId)),
    db.select().from(schema.userExamJourneys).where(eq(schema.userExamJourneys.userId, userId)),
  ]);

  const masteryMap = new Map(userMasteryRows.map((m) => [m.topicId, m.masteryScore]));
  const enrolledMap = new Map(enrolledRows.map((j) => [j.examId, j]));

  return allExams
    .map((exam) => {
      const maps = allMaps.filter((m) => m.examId === exam.id);
      let weightedSum = 0;
      let totalWeight = 0;
      for (const m of maps) {
        const score = masteryMap.get(m.topicId) ?? 50;
        weightedSum += score * m.expectedWeightPct;
        totalWeight += m.expectedWeightPct;
      }
      const readiness = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 55;
      const predictedScore =
        Math.round(exam.maxMarks * (0.32 + (readiness / 100) * 0.42) * 10) / 10;
      const cutoffMargin = Math.round((predictedScore - exam.historicalCutoff) * 10) / 10;
      const enrolled = enrolledMap.get(exam.id);

      const statusTier =
        readiness >= 75 ? "STRONGHOLD" : readiness >= 62 ? "DEVELOPING" : "VULNERABLE";

      return {
        examId: exam.id,
        slug: exam.slug,
        name: pickText(lang, exam.nameEn, exam.nameHi),
        shortName: pickText(lang, exam.shortNameEn, exam.shortNameHi),
        description: pickText(lang, exam.descriptionEn, exam.descriptionHi),
        totalQuestions: exam.totalQuestions,
        maxMarks: exam.maxMarks,
        durationMins: exam.durationMins,
        positiveMarks: exam.positiveMarks,
        negativeMarks: Math.round(exam.positiveMarks * exam.negativeMarkingRatio * 100) / 100,
        historicalCutoff: exam.historicalCutoff,
        targetCycleLabel: exam.targetCycleLabel,
        daysRemaining: exam.daysRemaining,
        isEnrolled: Boolean(enrolled),
        isPrimary: Boolean(enrolled?.isPrimary),
        readinessScore: Math.round(readiness),
        predictedScore,
        cutoffMargin,
        statusTier,
        testsCompleted: enrolled?.testsCompleted ?? 0,
        questionsPracticed: enrolled?.questionsPracticed ?? 0,
        guess5050NetGain: enrolled?.guess5050NetGain ?? 0,
      };
    })
    .sort((a, b) => b.readinessScore - a.readinessScore);
}

// ---------------------------------------------------------------------------
// 1. Live Service Health Endpoint (Proves Neon + Firebase + Razorpay Wiring)
// ---------------------------------------------------------------------------
app.get("/api/v1/health", async (c) => {
  const dbUrl = resolveDatabaseUrl(c.env?.DATABASE_URL);
  const db = createDb(dbUrl);

  const stats = await db.execute(sql`
    SELECT
      current_database() AS db_name,
      (SELECT COUNT(*)::int FROM exams) AS exams_count,
      (SELECT COUNT(*)::int FROM syllabus_topics) AS topics_count,
      (SELECT COUNT(*)::int FROM questions) AS questions_count,
      (SELECT COUNT(*)::int FROM learning_artifacts) AS artifacts_count,
      (SELECT COUNT(*)::int FROM flashcards) AS flashcards_count,
      (SELECT COUNT(*)::int FROM subscription_plans) AS plans_count,
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS pgvector_enabled
  `);

  const row = stats.rows[0] as Record<string, unknown>;
  const hasLiveRazorpay = Boolean(
    c.env?.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID
  );

  return c.json({
    ok: true,
    service: "sankalp-uppcs-edge-api",
    neon: {
      connected: true,
      branch: c.env?.NEON_BRANCH || process.env.NEON_BRANCH || "production",
      database: row.db_name,
      pgvectorEnabled: row.pgvector_enabled,
      counts: {
        exams: row.exams_count,
        topics: row.topics_count,
        questions: row.questions_count,
        learningArtifacts: row.artifacts_count,
        flashcards: row.flashcards_count,
        subscriptionPlans: row.plans_count,
      },
    },
    firebase: {
      projectId: c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app",
      statelessJwksVerification: true,
    },
    razorpay: {
      configuredMode: hasLiveRazorpay ? "LIVE_OR_TEST_KEYS" : "SANDBOX_SIMULATION_READY",
      hmacWebCryptoReady: true,
    },
  });
});

// ---------------------------------------------------------------------------
// 2. Bootstrap & User Profile Preferences (Strict Single-Language + Multi-Exam)
// ---------------------------------------------------------------------------
app.get("/api/v1/bootstrap", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const lang = normalizeLang(user.preferredLanguage);

  const [examPortfolio, dueSrsRows] = await Promise.all([
    computeAllExamReadiness(db, user.id, lang),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.userItemSrs)
      .where(
        and(
          eq(schema.userItemSrs.userId, user.id),
          sql`${schema.userItemSrs.nextDueAt} <= NOW()`
        )
      ),
  ]);

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      preferredLanguage: lang,
      activeExamId: user.activeExamId || "uppcs-prelims",
      dailyGoalMins: user.dailyGoalMins,
      streakDays: user.streakDays,
      onboardingCompleted: user.onboardingCompleted,
      planTier: user.planTier,
      proExpiresAt: user.proExpiresAt,
      scratchpadNotes: user.scratchpadNotes || {},
    },
    exams: examPortfolio,
    dueFlashcardsCount: dueSrsRows[0]?.count ?? 0,
  });
});

app.patch("/api/v1/me/preferences", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const body = await c.req.json<{
    preferredLanguage?: string;
    activeExamId?: string;
    enrolledExamIds?: string[];
    dailyGoalMins?: number;
    displayName?: string;
    onboardingCompleted?: boolean;
  }>();

  const nextLang = body.preferredLanguage ? normalizeLang(body.preferredLanguage) : normalizeLang(user.preferredLanguage);
  const nextActiveExam = body.activeExamId || user.activeExamId || "uppcs-prelims";

  await db
    .update(schema.users)
    .set({
      preferredLanguage: nextLang,
      activeExamId: nextActiveExam,
      dailyGoalMins: body.dailyGoalMins ?? user.dailyGoalMins,
      displayName: body.displayName?.trim() || user.displayName,
      onboardingCompleted: body.onboardingCompleted ?? true,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, user.id));

  if (Array.isArray(body.enrolledExamIds) && body.enrolledExamIds.length > 0) {
    for (const examId of body.enrolledExamIds) {
      await db
        .insert(schema.userExamJourneys)
        .values({
          id: `${user.id}__${examId}`,
          userId: user.id,
          examId,
          isPrimary: examId === nextActiveExam,
          readinessScore: 60,
          predictedScore: 90,
          syllabusCoveredPct: 35,
        })
        .onConflictDoUpdate({
          target: [schema.userExamJourneys.userId, schema.userExamJourneys.examId],
          set: { isPrimary: examId === nextActiveExam, lastActiveAt: new Date() },
        });
    }
  }

  return c.json({ ok: true, preferredLanguage: nextLang, activeExamId: nextActiveExam });
});

app.patch("/api/v1/me/scratchpad", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const body = await c.req.json<{ artifactId: string; note: string }>();

  const merged = { ...(user.scratchpadNotes || {}), [body.artifactId]: body.note };
  await db
    .update(schema.users)
    .set({ scratchpadNotes: merged, updatedAt: new Date() })
    .where(eq(schema.users.id, user.id));

  return c.json({ ok: true, scratchpadNotes: merged });
});

// ---------------------------------------------------------------------------
// 3. Per-Exam Learning Journey Dashboard (Screen 2)
// ---------------------------------------------------------------------------
app.get("/api/v1/journeys/:examId/dashboard", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const lang = normalizeLang(user.preferredLanguage);
  const examId = c.req.param("examId") || user.activeExamId || "uppcs-prelims";

  const [portfolio, topics, maps, masteryRows, papers, artifacts, recentSessions] = await Promise.all([
    computeAllExamReadiness(db, user.id, lang),
    db.select().from(schema.syllabusTopics),
    db.select().from(schema.examSyllabusMap).where(eq(schema.examSyllabusMap.examId, examId)),
    db.select().from(schema.userTopicMastery).where(eq(schema.userTopicMastery.userId, user.id)),
    db.select().from(schema.examPapers).orderBy(desc(schema.examPapers.year)).limit(12),
    db.select().from(schema.learningArtifacts),
    db
      .select()
      .from(schema.testSessions)
      .where(and(eq(schema.testSessions.userId, user.id), eq(schema.testSessions.examId, examId)))
      .orderBy(desc(schema.testSessions.startedAt))
      .limit(5),
  ]);

  const activeExam = portfolio.find((e) => e.examId === examId) || portfolio[0];
  const masteryMap = new Map(masteryRows.map((m) => [m.topicId, m]));
  const artifactByTopic = new Map(artifacts.map((a) => [a.topicId, a.id]));

  // Aggregate Exam-Weighted Subject Mastery (L1 Domains)
  const l1Domains = topics.filter((t) => t.level === 1).sort((a, b) => a.sortOrder - b.sortOrder);
  const l3Topics = topics.filter((t) => t.level === 3);
  const weightByTopic = new Map(maps.map((m) => [m.topicId, m.expectedWeightPct]));

  const subjectMastery = l1Domains
    .map((dom) => {
      const childL3 = l3Topics.filter((t) => t.subjectKey === dom.subjectKey);
      let wSum = 0;
      let wTotal = 0;
      let practicedCount = 0;
      for (const ct of childL3) {
        const w = weightByTopic.get(ct.id) ?? 4;
        const m = masteryMap.get(ct.id);
        wSum += (m?.masteryScore ?? 50) * w;
        wTotal += w;
        practicedCount += m?.attemptsCount ?? 0;
      }
      const pct = wTotal > 0 ? Math.round(wSum / wTotal) : 50;
      return {
        domainId: dom.id,
        name: pickText(lang, dom.nameEn, dom.nameHi),
        weightPct: Math.round(wTotal),
        masteryPct: pct,
        practicedCount,
        status: pct >= 75 ? "MASTERED" : pct >= 58 ? "DEVELOPING" : "WEAK",
      };
    })
    .filter((d) => d.weightPct > 0)
    .sort((a, b) => b.weightPct - a.weightPct);

  // Critical Gap Alerts (lowest mastery high-yield L3 micro-topics)
  const gapAlerts = l3Topics
    .map((t) => {
      const m = masteryMap.get(t.id);
      const score = Math.round(m?.masteryScore ?? 48);
      return {
        topicId: t.id,
        name: pickText(lang, t.nameEn, t.nameHi),
        subject: t.subjectKey,
        accuracyPct: score,
        weightPct: weightByTopic.get(t.id) ?? 5,
        artifactId: artifactByTopic.get(t.id) || "cs-panchayati-raj",
      };
    })
    .sort((a, b) => a.accuracyPct - b.accuracyPct)
    .slice(0, 3);

  const examPapersList = papers.slice(0, 6).map((p) => ({
    id: p.id,
    title: pickText(lang, p.paperNameEn, p.paperNameHi),
    year: p.year,
    paperType: p.paperType,
    totalQuestions: p.totalQuestions,
    maxMarks: p.maxMarks,
    durationMins: p.durationMins,
    hasOfficialKey: p.hasOfficialKey,
  }));

  return c.json({
    exam: activeExam,
    subjectMastery,
    gapAlerts,
    papers: examPapersList,
    recentSessions: recentSessions.map((s) => ({
      id: s.id,
      title: pickText(lang, s.titleEn, s.titleHi),
      status: s.status,
      netMarks: Math.round(s.netMarks * 100) / 100,
      maxMarks: s.maxMarks,
      correctCount: s.correctCount,
      wrongCount: s.wrongCount,
      startedAt: s.startedAt,
    })),
  });
});

// ---------------------------------------------------------------------------
// 4. Global Cross-Exam Expertise & Readiness Portfolio (Screen 3)
// ---------------------------------------------------------------------------
app.get("/api/v1/expertise/global", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const lang = normalizeLang(user.preferredLanguage);

  const [portfolio, topics, masteryRows, formatCounts] = await Promise.all([
    computeAllExamReadiness(db, user.id, lang),
    db.select().from(schema.syllabusTopics),
    db.select().from(schema.userTopicMastery).where(eq(schema.userTopicMastery.userId, user.id)),
    db.execute(sql`
      SELECT question_format, COUNT(*)::int AS total_available
      FROM questions
      GROUP BY question_format
    `),
  ]);

  const masteryMap = new Map(masteryRows.map((m) => [m.topicId, m]));
  const availByFmt = new Map(
    (formatCounts.rows as Array<{ question_format: string; total_available: number }>).map((r) => [
      r.question_format,
      r.total_available,
    ])
  );

  const formatDiagnostics = [
    {
      format: "SINGLE_CHOICE",
      label: lang === "HI" ? "प्रत्यक्ष एकल-विकल्प तथ्यात्मक प्रश्न" : "Direct Single-Choice Factual",
      accuracyPct: 84,
      avgTimeSec: 21,
      availableQuestions: availByFmt.get("SINGLE_CHOICE") ?? 250,
      badge: lang === "HI" ? "तीव्र एवं सटीक" : "FAST & PRECISE",
      tone: "EMERALD",
    },
    {
      format: "CHRONOLOGY",
      label: lang === "HI" ? "कालक्रमानुसार व्यवस्था (तिथियां एवं संधियां)" : "Chronological Ordering (Dates & Treaties)",
      accuracyPct: 72,
      avgTimeSec: 38,
      availableQuestions: availByFmt.get("CHRONOLOGY") ?? 45,
      badge: lang === "HI" ? "स्थिर" : "STABLE",
      tone: "EMERALD",
    },
    {
      format: "MATCH_LIST",
      label: lang === "HI" ? "सूची-I का सूची-II से सुमेलन" : "Match List-I with List-II (Matrix)",
      accuracyPct: 68,
      avgTimeSec: 58,
      availableQuestions: availByFmt.get("MATCH_LIST") ?? 95,
      badge: lang === "HI" ? "गति सुधार आवश्यक" : "PACING WATCH",
      tone: "AMBER",
    },
    {
      format: "MULTI_STATEMENT",
      label: lang === "HI" ? "बहु-कथन विश्लेषण ('केवल 1 और 2')" : "Multi-Statement Analysis ('1 and 2 only')",
      accuracyPct: 61,
      avgTimeSec: 52,
      availableQuestions: availByFmt.get("MULTI_STATEMENT") ?? 180,
      badge: lang === "HI" ? "50-50 निष्कासन उपयोगी" : "USE 50-50 STRIKETHROUGH",
      tone: "AMBER",
    },
    {
      format: "ASSERTION_REASON",
      label: lang === "HI" ? "कथन (A) एवं कारण (R) विश्लेषण" : "Assertion (A) & Reason (R)",
      accuracyPct: 46,
      avgTimeSec: 56,
      availableQuestions: availByFmt.get("ASSERTION_REASON") ?? 60,
      badge: lang === "HI" ? "नकारात्मक अंकन जोखिम" : "HIGH NEGATIVE DRAG",
      tone: "ROSE",
    },
  ];

  const l1Domains = topics.filter((t) => t.level === 1).sort((a, b) => a.sortOrder - b.sortOrder);
  const l3Topics = topics.filter((t) => t.level === 3);

  const unifiedSubjectElo = l1Domains.map((dom) => {
    const children = l3Topics.filter((t) => t.subjectKey === dom.subjectKey);
    const avg =
      children.length > 0
        ? Math.round(
            children.reduce((acc, c) => acc + (masteryMap.get(c.id)?.masteryScore ?? 55), 0) /
              children.length
          )
        : 60;
    const attempts = children.reduce((acc, c) => acc + (masteryMap.get(c.id)?.attemptsCount ?? 0), 0);
    return {
      domainId: dom.id,
      name: pickText(lang, dom.nameEn, dom.nameHi),
      eloScore: avg,
      attempts,
      retentionPct: Math.min(96, Math.max(48, avg + 6)),
    };
  });

  const overallElo =
    Math.round(
      (unifiedSubjectElo.reduce((acc, s) => acc + s.eloScore, 0) /
        Math.max(1, unifiedSubjectElo.length)) *
        10
    ) / 10;

  return c.json({
    overallPortfolioElo: overallElo,
    examRanking: portfolio,
    formatDiagnostics,
    unifiedSubjectElo,
  });
});

// ---------------------------------------------------------------------------
// 5. 3-Tier Syllabus Explorer & Custom Practice Configurator (Screen 4)
// ---------------------------------------------------------------------------
app.get("/api/v1/syllabus/:examId/tree", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const lang = normalizeLang(user.preferredLanguage);
  const examId = c.req.param("examId") || "uppcs-prelims";

  const [topics, maps, masteryRows, qCounts, artifacts, cardCounts] = await Promise.all([
    db.select().from(schema.syllabusTopics).orderBy(asc(schema.syllabusTopics.sortOrder)),
    db.select().from(schema.examSyllabusMap).where(eq(schema.examSyllabusMap.examId, examId)),
    db.select().from(schema.userTopicMastery).where(eq(schema.userTopicMastery.userId, user.id)),
    db.execute(sql`
      SELECT topic_id, question_origin, COUNT(*)::int AS cnt
      FROM questions
      WHERE topic_id IS NOT NULL
      GROUP BY topic_id, question_origin
    `),
    db.select().from(schema.learningArtifacts),
    db.execute(sql`
      SELECT topic_id, COUNT(*)::int AS cnt
      FROM flashcards
      GROUP BY topic_id
    `),
  ]);

  const weightMap = new Map(maps.map((m) => [m.topicId, m]));
  const masteryMap = new Map(masteryRows.map((m) => [m.topicId, m]));
  const artifactMap = new Map(artifacts.map((a) => [a.topicId, a]));
  const flashcardCountMap = new Map(
    (cardCounts.rows as Array<{ topic_id: string; cnt: number }>).map((r) => [r.topic_id, r.cnt])
  );

  const countByTopic = new Map<string, { total: number; pyq: number; concept: number; ncert: number }>();
  for (const row of qCounts.rows as Array<{ topic_id: string; question_origin: string; cnt: number }>) {
    const cur = countByTopic.get(row.topic_id) || { total: 0, pyq: 0, concept: 0, ncert: 0 };
    cur.total += row.cnt;
    if (row.question_origin === "PYQ") cur.pyq += row.cnt;
    else if (row.question_origin === "NCERT_DRILL") cur.ncert += row.cnt;
    else cur.concept += row.cnt;
    countByTopic.set(row.topic_id, cur);
  }

  const l1 = topics.filter((t) => t.level === 1);
  const l2 = topics.filter((t) => t.level === 2);
  const l3 = topics.filter((t) => t.level === 3);

  const tree = l1.map((dom) => {
    const modules = l2
      .filter((m) => m.parentId === dom.id)
      .map((mod) => {
        const microTopics = l3
          .filter((mt) => mt.parentId === mod.id)
          .map((mt) => {
            const counts = countByTopic.get(mt.id) || { total: 0, pyq: 0, concept: 0, ncert: 0 };
            const mRow = masteryMap.get(mt.id);
            const art = artifactMap.get(mt.id);
            const wRow = weightMap.get(mt.id);
            return {
              id: mt.id,
              name: pickText(lang, mt.nameEn, mt.nameHi),
              description: pickText(lang, mt.descriptionEn, mt.descriptionHi),
              isHighYield: mt.isHighYield,
              priorityTier: wRow?.priorityTier || "CORE",
              weightPct: wRow?.expectedWeightPct ?? 5,
              masteryScore: Math.round(mRow?.masteryScore ?? 50),
              questionCounts: counts,
              artifact: art
                ? {
                    id: art.id,
                    type: art.artifactType,
                    title: pickText(lang, art.titleEn, art.titleHi),
                    pyqCoverageCount: art.pyqCoverageCount,
                  }
                : null,
              flashcardsCount: flashcardCountMap.get(mt.id) ?? 0,
            };
          });

        const modMastery =
          microTopics.length > 0
            ? Math.round(
                microTopics.reduce((s, x) => s + x.masteryScore, 0) / microTopics.length
              )
            : 60;

        return {
          id: mod.id,
          name: pickText(lang, mod.nameEn, mod.nameHi),
          masteryScore: modMastery,
          microTopics,
        };
      });

    const allMicro = modules.flatMap((m) => m.microTopics);
    const domMastery =
      allMicro.length > 0
        ? Math.round(allMicro.reduce((s, x) => s + x.masteryScore, 0) / allMicro.length)
        : 60;
    const domWeight = Math.round(allMicro.reduce((s, x) => s + x.weightPct, 0));
    const domQuestions = allMicro.reduce((s, x) => s + x.questionCounts.total, 0);

    return {
      id: dom.id,
      name: pickText(lang, dom.nameEn, dom.nameHi),
      description: pickText(lang, dom.descriptionEn, dom.descriptionHi),
      weightPct: domWeight,
      masteryScore: domMastery,
      totalQuestions: domQuestions,
      modules,
    };
  });

  return c.json({ examId, language: lang, tree });
});

// ---------------------------------------------------------------------------
// 6. Test Cockpit Session Creation, Fetch & Commission Grading (Screens 5, 6, 9)
// ---------------------------------------------------------------------------
app.post("/api/v1/test-sessions", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const lang = normalizeLang(user.preferredLanguage);

  const body = await c.req.json<{
    examId?: string;
    paperId?: string;
    sessionType?: "FULL_PAPER" | "TOPIC_DRILL" | "ADAPTIVE_SMART_DRILL";
    mode?: "EXAM" | "TUTOR";
    topicIds?: string[];
    origins?: string[];
    questionFormat?: string;
    limit?: number;
  }>();

  const examId = body.examId || user.activeExamId || "uppcs-prelims";
  const [exam] = await db.select().from(schema.exams).where(eq(schema.exams.id, examId)).limit(1);
  const targetExam = exam || (await db.select().from(schema.exams).limit(1))[0];

  const desiredCount = Math.min(150, Math.max(5, body.limit || (body.sessionType === "FULL_PAPER" ? 30 : 15)));

  // Push filters directly to Neon Postgres so large subject banks (1,200+ Indian Economy Qs) are 100% reachable
  const whereClauses = [];
  if (body.paperId) {
    whereClauses.push(eq(schema.questions.paperId, body.paperId));
  }
  if (Array.isArray(body.topicIds) && body.topicIds.length > 0) {
    whereClauses.push(inArray(schema.questions.topicId, body.topicIds));
  }
  if (Array.isArray(body.origins) && body.origins.length > 0) {
    whereClauses.push(inArray(schema.questions.questionOrigin, body.origins));
  }
  if (body.questionFormat && body.questionFormat !== "ALL") {
    whereClauses.push(eq(schema.questions.questionFormat, body.questionFormat));
  }

  const orderExpr =
    lang === "HI"
      ? sql`CASE WHEN ${schema.questions.questionHi} IS NOT NULL THEN 0 ELSE 1 END, RANDOM()`
      : sql`CASE WHEN ${schema.questions.goldenRuleEn} IS NOT NULL THEN 0 ELSE 1 END, RANDOM()`;

  let selected = await db
    .select()
    .from(schema.questions)
    .where(whereClauses.length > 0 ? and(...whereClauses) : undefined)
    .orderBy(orderExpr)
    .limit(desiredCount);

  // Graceful fallback if an overly narrow origin+topic combination had 0 rows
  if (selected.length === 0 && Array.isArray(body.topicIds) && body.topicIds.length > 0) {
    selected = await db
      .select()
      .from(schema.questions)
      .where(inArray(schema.questions.topicId, body.topicIds))
      .orderBy(orderExpr)
      .limit(desiredCount);
  }
  if (selected.length === 0) {
    selected = await db.select().from(schema.questions).orderBy(orderExpr).limit(desiredCount);
  }
  if (selected.length === 0) {
    return c.json({ error: "No questions available for selected filters" }, 400);
  }

  const sessionId = `ses_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const sessionType = body.sessionType || "ADAPTIVE_SMART_DRILL";
  const mode = body.mode || "EXAM";
  const durationSec = selected.length * 72; // 1.2 min per question realistic UPPSC pace

  const titleEn =
    sessionType === "FULL_PAPER"
      ? `${targetExam.shortNameEn} — Official Simulated Paper`
      : sessionType === "ADAPTIVE_SMART_DRILL"
        ? `${targetExam.shortNameEn} — 15-Min Adaptive Smart Drill`
        : `${targetExam.shortNameEn} — Targeted Syllabus Practice`;

  const titleHi =
    sessionType === "FULL_PAPER"
      ? `${targetExam.shortNameHi} — आधिकारिक प्रश्नपत्र अभ्यास`
      : sessionType === "ADAPTIVE_SMART_DRILL"
        ? `${targetExam.shortNameHi} — 15-मिनट अनुकूली स्मार्ट ड्रिल`
        : `${targetExam.shortNameHi} — लक्षित पाठ्यक्रम अभ्यास`;

  await db.insert(schema.testSessions).values({
    id: sessionId,
    userId: user.id,
    examId: targetExam.id,
    paperId: body.paperId || null,
    sessionType,
    mode,
    titleEn,
    titleHi,
    languageLocked: lang,
    status: "IN_PROGRESS",
    durationSec,
    totalQuestions: selected.length,
    maxMarks: Math.round(selected.length * targetExam.positiveMarks * 100) / 100,
  });

  await db.insert(schema.testAttemptItems).values(
    selected.map((q, idx) => ({
      id: `${sessionId}__${idx + 1}`,
      sessionId,
      questionId: q.id,
      displayOrder: idx + 1,
    }))
  );

  return c.json({ sessionId, totalQuestions: selected.length, language: lang });
});

app.get("/api/v1/test-sessions/:id", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const sessionId = c.req.param("id");

  const [session] = await db
    .select()
    .from(schema.testSessions)
    .where(and(eq(schema.testSessions.id, sessionId), eq(schema.testSessions.userId, user.id)))
    .limit(1);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  // Respect user's live profile language so switching EN <-> HI renders purely in chosen language
  const lang = normalizeLang(user.preferredLanguage);

  const [exam] = await db.select().from(schema.exams).where(eq(schema.exams.id, session.examId)).limit(1);
  const attemptRows = await db
    .select()
    .from(schema.testAttemptItems)
    .where(eq(schema.testAttemptItems.sessionId, sessionId))
    .orderBy(asc(schema.testAttemptItems.displayOrder));

  const qIds = attemptRows.map((a) => a.questionId);
  const [qRows, variants, artifacts] = await Promise.all([
    db.select().from(schema.questions).where(inArray(schema.questions.id, qIds)),
    db.select().from(schema.questionVariants).where(inArray(schema.questionVariants.questionId, qIds)),
    db.select().from(schema.learningArtifacts),
  ]);

  const qMap = new Map(qRows.map((q) => [q.id, q]));
  const artifactByTopic = new Map(artifacts.map((a) => [a.topicId, a.id]));
  const variantsByQ = new Map<string, string[]>();
  for (const v of variants) {
    const arr = variantsByQ.get(v.questionId) || [];
    arr.push(
      `${pickText(lang, v.paperLabelEn, v.paperLabelHi)}${v.questionNumber ? ` (Q.${v.questionNumber})` : ""}`
    );
    variantsByQ.set(v.questionId, arr);
  }

  const revealSolutions = session.status === "SUBMITTED" || session.mode === "TUTOR";

  const items = attemptRows.map((att) => {
    const q = qMap.get(att.questionId)!;
    const base = {
      attemptItemId: att.id,
      questionId: q.id,
      displayOrder: att.displayOrder,
      subject: q.subject,
      topicId: q.topicId,
      difficulty: q.difficulty,
      questionOrigin: q.questionOrigin,
      questionFormat: q.questionFormat,
      stem: pickText(lang, q.questionEn, q.questionHi),
      options: pickOptions(lang, q.optionsEn, q.optionsHi),
      selectedOption: att.selectedOption,
      eliminatedOptions: att.eliminatedOptions || [],
      confidenceTag: att.confidenceTag,
      isMarkedReview: att.isMarkedReview,
      timeSpentSec: att.timeSpentSec,
      linkedArtifactId: (q.topicId && artifactByTopic.get(q.topicId)) || "cs-panchayati-raj",
    };

    if (!revealSolutions) {
      return base;
    }

    return {
      ...base,
      correctOption: q.correctOption,
      isCorrect: att.isCorrect,
      marksAwarded: Math.round((att.marksAwarded || 0) * 100) / 100,
      explanation: pickText(lang, q.explanationEn, q.explanationHi),
      goldenRule: pickText(lang, q.goldenRuleEn, q.goldenRuleHi),
      sourceKeyType: q.sourceKeyType,
      confidenceScore: q.confidenceScore,
      repeatedIn: variantsByQ.get(q.id) || [],
    };
  });

  const posMarks = exam?.positiveMarks ?? 1.3333;
  const negMarks = Math.round(posMarks * (exam?.negativeMarkingRatio ?? 0.3333) * 100) / 100;

  return c.json({
    session: {
      id: session.id,
      examId: session.examId,
      title: pickText(lang, session.titleEn, session.titleHi),
      sessionType: session.sessionType,
      mode: session.mode,
      language: lang,
      status: session.status,
      durationSec: session.durationSec,
      elapsedSec: session.elapsedSec,
      totalQuestions: session.totalQuestions,
      positiveMarks: Math.round(posMarks * 100) / 100,
      negativePenalty: negMarks,
      correctCount: session.correctCount,
      wrongCount: session.wrongCount,
      skippedCount: session.skippedCount,
      canceledCount: session.canceledCount,
      grossMarks: Math.round(session.grossMarks * 100) / 100,
      negativeMarks: Math.round(session.negativeMarks * 100) / 100,
      netMarks: Math.round(session.netMarks * 100) / 100,
      maxMarks: Math.round(session.maxMarks * 100) / 100,
      guess5050NetGain: Math.round(session.guess5050NetGain * 100) / 100,
      wildGuessNetGain: Math.round(session.wildGuessNetGain * 100) / 100,
    },
    items,
  });
});

app.post("/api/v1/test-sessions/:id/submit", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const sessionId = c.req.param("id");

  const body = await c.req.json<{
    elapsedSec?: number;
    responses: Array<{
      questionId: string;
      selectedOption: string | null;
      eliminatedOptions?: string[];
      confidenceTag?: "SURE" | "GUESS_50_50" | "WILD_GUESS";
      isMarkedReview?: boolean;
      timeSpentSec?: number;
    }>;
  }>();

  const [session] = await db
    .select()
    .from(schema.testSessions)
    .where(and(eq(schema.testSessions.id, sessionId), eq(schema.testSessions.userId, user.id)))
    .limit(1);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const [exam] = await db.select().from(schema.exams).where(eq(schema.exams.id, session.examId)).limit(1);
  const attemptRows = await db
    .select()
    .from(schema.testAttemptItems)
    .where(eq(schema.testAttemptItems.sessionId, sessionId));

  const qIds = attemptRows.map((a) => a.questionId);
  const qRows = await db.select().from(schema.questions).where(inArray(schema.questions.id, qIds));
  const qMap = new Map(qRows.map((q) => [q.id, q]));
  const respMap = new Map((body.responses || []).map((r) => [r.questionId, r]));

  // Commission Grading Rule: Canceled ('X') questions redistribute positive marks pro-rata
  const canceledCount = qRows.filter((q) => q.correctOption === "X").length;
  const validCount = Math.max(1, qRows.length - canceledCount);
  const totalMaxMarks = qRows.length * (exam?.positiveMarks ?? 1.3333);
  const effectivePos = totalMaxMarks / validCount;
  const effectiveNeg = effectivePos * (exam?.negativeMarkingRatio ?? 0.3333);

  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;
  let grossMarks = 0;
  let negativeMarks = 0;
  let guess5050NetGain = 0;
  let wildGuessNetGain = 0;

  const topicDelta = new Map<string, { attempts: number; correct: number; deltaScore: number }>();
  const wrongQuestionIds: string[] = [];

  for (const att of attemptRows) {
    const q = qMap.get(att.questionId);
    if (!q) continue;
    const r = respMap.get(att.questionId);
    const sel = r?.selectedOption ? String(r.selectedOption).toUpperCase() : null;
    const conf = r?.confidenceTag || "SURE";
    const elim = Array.isArray(r?.eliminatedOptions) ? r!.eliminatedOptions : [];
    const spent = r?.timeSpentSec ?? 35;

    let isCorrect: boolean | null = null;
    let marksAwarded = 0;

    if (q.correctOption === "X") {
      isCorrect = null;
      marksAwarded = 0;
    } else if (!sel) {
      skippedCount++;
      isCorrect = null;
      marksAwarded = 0;
    } else if (sel === q.correctOption) {
      correctCount++;
      isCorrect = true;
      marksAwarded = effectivePos;
      grossMarks += effectivePos;
    } else {
      wrongCount++;
      isCorrect = false;
      marksAwarded = -effectiveNeg;
      negativeMarks += effectiveNeg;
      wrongQuestionIds.push(q.id);
    }

    if (sel && conf === "GUESS_50_50") {
      guess5050NetGain += marksAwarded;
    } else if (sel && conf === "WILD_GUESS") {
      wildGuessNetGain += marksAwarded;
    }

    if (sel && q.topicId) {
      const cur = topicDelta.get(q.topicId) || { attempts: 0, correct: 0, deltaScore: 0 };
      cur.attempts += 1;
      if (isCorrect) {
        cur.correct += 1;
        cur.deltaScore += q.difficulty === "HARD" ? 4.5 : 3.0;
      } else {
        cur.deltaScore -= q.difficulty === "EASY" ? 4.0 : 2.5;
      }
      topicDelta.set(q.topicId, cur);
    }

    await db
      .update(schema.testAttemptItems)
      .set({
        selectedOption: sel,
        eliminatedOptions: elim,
        confidenceTag: conf,
        isMarkedReview: Boolean(r?.isMarkedReview),
        timeSpentSec: spent,
        isCorrect,
        marksAwarded,
      })
      .where(eq(schema.testAttemptItems.id, att.id));
  }

  const netMarks = grossMarks - negativeMarks;

  await db
    .update(schema.testSessions)
    .set({
      status: "SUBMITTED",
      elapsedSec: body.elapsedSec ?? 600,
      correctCount,
      wrongCount,
      skippedCount,
      canceledCount,
      grossMarks,
      negativeMarks,
      netMarks,
      maxMarks: totalMaxMarks,
      guess5050NetGain,
      wildGuessNetGain,
      submittedAt: new Date(),
    })
    .where(eq(schema.testSessions.id, sessionId));

  // Update Unified Global Topic Mastery (automatically lifting/adjusting Cross-Exam Readiness!)
  for (const [topicId, d] of topicDelta.entries()) {
    const existing = await db
      .select()
      .from(schema.userTopicMastery)
      .where(
        and(eq(schema.userTopicMastery.userId, user.id), eq(schema.userTopicMastery.topicId, topicId))
      )
      .limit(1);

    if (existing.length > 0) {
      const nextScore = Math.min(98, Math.max(15, existing[0].masteryScore + d.deltaScore));
      await db
        .update(schema.userTopicMastery)
        .set({
          masteryScore: nextScore,
          attemptsCount: existing[0].attemptsCount + d.attempts,
          correctCount: existing[0].correctCount + d.correct,
          wrongCount: existing[0].wrongCount + (d.attempts - d.correct),
          lastPracticedAt: new Date(),
        })
        .where(eq(schema.userTopicMastery.id, existing[0].id));
    } else {
      await db.insert(schema.userTopicMastery).values({
        id: `${user.id}__${topicId}`,
        userId: user.id,
        topicId,
        masteryScore: Math.min(95, Math.max(20, 50 + d.deltaScore)),
        attemptsCount: d.attempts,
        correctCount: d.correct,
        wrongCount: d.attempts - d.correct,
      });
    }
  }

  // Update active journey counters
  const [journey] = await db
    .select()
    .from(schema.userExamJourneys)
    .where(
      and(eq(schema.userExamJourneys.userId, user.id), eq(schema.userExamJourneys.examId, session.examId))
    )
    .limit(1);

  if (journey) {
    await db
      .update(schema.userExamJourneys)
      .set({
        testsCompleted: journey.testsCompleted + 1,
        questionsPracticed: journey.questionsPracticed + correctCount + wrongCount,
        guess5050NetGain: Math.round((journey.guess5050NetGain + guess5050NetGain) * 100) / 100,
        lastActiveAt: new Date(),
      })
      .where(eq(schema.userExamJourneys.id, journey.id));
  }

  // Auto-enqueue linked flashcards for wrong questions into user's Test Mistake SRS Deck!
  if (wrongQuestionIds.length > 0) {
    const wrongTopics = Array.from(
      new Set(
        wrongQuestionIds
          .map((qid) => qMap.get(qid)?.topicId)
          .filter((tid): tid is string => Boolean(tid))
      )
    );
    if (wrongTopics.length > 0) {
      const linkedCards = await db
        .select()
        .from(schema.flashcards)
        .where(
          and(
            inArray(schema.flashcards.topicId, wrongTopics),
            sql`(${schema.flashcards.createdByUserId} IS NULL OR ${schema.flashcards.createdByUserId} = ${user.id})`
          )
        );

      for (const fc of linkedCards) {
        await db
          .insert(schema.userItemSrs)
          .values({
            id: `${user.id}__${fc.id}`,
            userId: user.id,
            flashcardId: fc.id,
            originType: "TEST_MISTAKE",
            originLabelEn: `Derived from Test Mistake (${session.titleEn})`,
            originLabelHi: `परीक्षा त्रुटि से निर्मित (${session.titleHi})`,
            intervalDays: 0,
            nextDueAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [schema.userItemSrs.userId, schema.userItemSrs.flashcardId],
            set: {
              originType: "TEST_MISTAKE",
              nextDueAt: new Date(),
            },
          });
      }
    }
  }

  return c.json({
    ok: true,
    sessionId,
    summary: {
      correctCount,
      wrongCount,
      skippedCount,
      canceledCount,
      grossMarks: Math.round(grossMarks * 100) / 100,
      negativeMarks: Math.round(negativeMarks * 100) / 100,
      netMarks: Math.round(netMarks * 100) / 100,
      maxMarks: Math.round(totalMaxMarks * 100) / 100,
      guess5050NetGain: Math.round(guess5050NetGain * 100) / 100,
      wildGuessNetGain: Math.round(wildGuessNetGain * 100) / 100,
    },
  });
});

// ---------------------------------------------------------------------------
// 7. Topic Learning Studio — Performance-Curated Cheat Sheets & Notes (Screen 7)
// ---------------------------------------------------------------------------
app.get("/api/v1/studio", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const lang = normalizeLang(user.preferredLanguage);

  const [artifacts, topics, masteryRows, cards] = await Promise.all([
    db.select().from(schema.learningArtifacts),
    db.select().from(schema.syllabusTopics),
    db.select().from(schema.userTopicMastery).where(eq(schema.userTopicMastery.userId, user.id)),
    db
      .select()
      .from(schema.flashcards)
      .where(
        sql`(${schema.flashcards.createdByUserId} IS NULL OR ${schema.flashcards.createdByUserId} = ${user.id})`
      ),
  ]);

  const topicMap = new Map(topics.map((t) => [t.id, t]));
  const masteryMap = new Map(masteryRows.map((m) => [m.topicId, m.masteryScore]));

  const sheets = artifacts
    .map((a) => {
      const t = topicMap.get(a.topicId);
      const linkedCardsCount = cards.filter((fc) => fc.topicId === a.topicId).length;
      const masteryPct = Math.round(masteryMap.get(a.topicId) ?? 55);
      const noteText = (user.scratchpadNotes || {})[a.id] || "";
      const hasPersonalNote = noteText.trim().length > 0;

      const curationTier =
        masteryPct < 60 ? "PRIORITY_GAP" : hasPersonalNote ? "PERSONAL_NOTE" : "STRONGHOLD";
      const curatedReason =
        masteryPct < 60
          ? lang === "HI"
            ? `प्राथमिक सुधार क्षेत्र • ${masteryPct}% दक्षता`
            : `Recommended Gap Fix • ${masteryPct}% Mastery`
          : hasPersonalNote
            ? lang === "HI"
              ? `आपके व्यक्तिगत नोट्स युक्त • ${masteryPct}%`
              : `Annotated with Your Notes • ${masteryPct}%`
            : lang === "HI"
              ? `मजबूत पकड़ रिवीजन • ${masteryPct}%`
              : `High-Retention Review • ${masteryPct}%`;

      return {
        id: a.id,
        topicId: a.topicId,
        topicName: t ? pickText(lang, t.nameEn, t.nameHi) : "",
        subjectKey: t?.subjectKey || "General Studies",
        artifactType: a.artifactType,
        title: pickText(lang, a.titleEn, a.titleHi),
        estReadMins: a.estReadMins,
        pyqCoverageCount: a.pyqCoverageCount,
        canonicalSource: pickText(lang, a.canonicalSourceEn, a.canonicalSourceHi),
        topicMasteryPct: masteryPct,
        curationTier,
        curatedReason,
        hasPersonalNote,
        linkedFlashcardsCount: linkedCardsCount,
        content: pickArtifactContent(lang, a.contentEn, a.contentHi),
        scratchpadNote: noteText,
      };
    })
    // Curate order dynamically by performance: weakest mastery first so high-yield gaps appear on top
    .sort((a, b) => a.topicMasteryPct - b.topicMasteryPct);

  return c.json({ language: lang, sheets });
});

// ---------------------------------------------------------------------------
// 8. Active-Recall Flashcards, Personal User Cards & Mistake SRS (Screen 8)
// ---------------------------------------------------------------------------
app.get("/api/v1/srs/due", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const lang = normalizeLang(user.preferredLanguage);
  const deckFilter = c.req.query("deck") || "ALL";

  const [srsRows, allCards, topics, masteryRows] = await Promise.all([
    db.select().from(schema.userItemSrs).where(eq(schema.userItemSrs.userId, user.id)),
    db
      .select()
      .from(schema.flashcards)
      .where(
        sql`(${schema.flashcards.createdByUserId} IS NULL OR ${schema.flashcards.createdByUserId} = ${user.id})`
      ),
    db.select().from(schema.syllabusTopics),
    db.select().from(schema.userTopicMastery).where(eq(schema.userTopicMastery.userId, user.id)),
  ]);

  const srsByCard = new Map(srsRows.map((s) => [s.flashcardId, s]));
  const topicMap = new Map(topics.map((t) => [t.id, t]));
  const masteryMap = new Map(masteryRows.map((m) => [m.topicId, m.masteryScore]));
  const now = Date.now();

  const mapped = allCards
    .map((fc) => {
      const srs = srsByCard.get(fc.id);
      const isPersonal = fc.createdByUserId === user.id;
      const isDue = !srs || new Date(srs.nextDueAt).getTime() <= now;
      const t = topicMap.get(fc.topicId);
      const topicMasteryPct = Math.round(masteryMap.get(fc.topicId) ?? 55);
      const originType = isPersonal
        ? "PERSONAL_CARD"
        : (srs?.originType as "TEST_MISTAKE" | "TOPIC_DECK") || "TOPIC_DECK";

      // Performance priority score (lower = shown earlier in session)
      const priorityRank =
        (isDue ? 0 : 100) +
        (originType === "TEST_MISTAKE" ? 0 : isPersonal ? 10 : topicMasteryPct < 60 ? 20 : 40) +
        topicMasteryPct * 0.1;

      return {
        flashcardId: fc.id,
        srsId: srs?.id || null,
        topicId: fc.topicId,
        topicBreadcrumb: t ? `${t.subjectKey} → ${pickText(lang, t.nameEn, t.nameHi)}` : "General Studies",
        topicMasteryPct,
        deckCategory: fc.deckCategory,
        isPersonal,
        originType,
        originLabel: isPersonal
          ? pickText(
              lang,
              srs?.originLabelEn || "Created by You (Personal Card)",
              srs?.originLabelHi || "आपके द्वारा निर्मित (व्यक्तिगत कार्ड)"
            )
          : pickText(
              lang,
              srs?.originLabelEn ||
                (topicMasteryPct < 60
                  ? `Curated for Weak Topic (${topicMasteryPct}% Mastery)`
                  : "High-Yield Syllabus Deck"),
              srs?.originLabelHi ||
                (topicMasteryPct < 60
                  ? `कमज़ोर विषय हेतु चयनित (${topicMasteryPct}% दक्षता)`
                  : "उच्च-उपयोगी पाठ्यक्रम डेक")
            ),
        cardTypeLabel: pickText(lang, fc.cardTypeLabelEn, fc.cardTypeLabelHi),
        front: pickText(lang, fc.frontEn, fc.frontHi),
        back: pickText(lang, fc.backEn, fc.backHi),
        trapWarning: pickText(lang, fc.trapWarningEn, fc.trapWarningHi),
        mnemonic: pickText(lang, fc.mnemonicEn, fc.mnemonicHi),
        askedInLabel: pickText(lang, fc.askedInLabelEn, fc.askedInLabelHi),
        isDue,
        intervalDays: srs?.intervalDays ?? 0,
        repetitions: srs?.repetitions ?? 0,
        priorityRank,
      };
    })
    .sort((a, b) => a.priorityRank - b.priorityRank);

  const filtered = mapped.filter((cItem) => {
    if (deckFilter === "MISTAKE_DECK") return cItem.originType === "TEST_MISTAKE";
    if (deckFilter === "MY_CARDS") return cItem.isPersonal;
    if (deckFilter !== "ALL") return cItem.deckCategory === deckFilter;
    return true;
  });

  return c.json({
    language: lang,
    dueCount: mapped.filter((x) => x.isDue).length,
    mistakeCount: mapped.filter((x) => x.originType === "TEST_MISTAKE").length,
    personalCount: mapped.filter((x) => x.isPersonal).length,
    cards: filtered,
  });
});

app.post("/api/v1/srs/cards", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);

  const body = await c.req.json<{
    topicId?: string | null;
    sourceQuestionId?: string | null;
    front: string;
    back: string;
    mnemonic?: string;
    trapWarning?: string;
    originContext?: string;
  }>();

  const front = (body.front || "").trim();
  const back = (body.back || "").trim();
  if (!front || !back) {
    return c.json({ error: "Both front prompt and back answer are required." }, 400);
  }

  let resolvedTopicId = body.topicId || "top-econ-fiscal";
  const [topicExists] = await db
    .select({ id: schema.syllabusTopics.id })
    .from(schema.syllabusTopics)
    .where(eq(schema.syllabusTopics.id, resolvedTopicId))
    .limit(1);
  if (!topicExists) {
    resolvedTopicId = "top-econ-fiscal";
  }

  const cardId = `fc_usr_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
  await db.insert(schema.flashcards).values({
    id: cardId,
    topicId: resolvedTopicId,
    createdByUserId: user.id,
    sourceQuestionId: body.sourceQuestionId || null,
    deckCategory: "MY_CARDS",
    cardTypeLabelEn: "Personal Active-Recall Card",
    cardTypeLabelHi: "व्यक्तिगत सक्रिय-स्मरण कार्ड",
    frontEn: front,
    frontHi: front,
    backEn: back,
    backHi: back,
    mnemonicEn: body.mnemonic?.trim() || null,
    mnemonicHi: body.mnemonic?.trim() || null,
    trapWarningEn: body.trapWarning?.trim() || null,
    trapWarningHi: body.trapWarning?.trim() || null,
    askedInLabelEn: body.originContext || "Personal Study Deck",
    askedInLabelHi: body.originContext || "व्यक्तिगत अध्ययन डेक",
  });

  await db
    .insert(schema.userItemSrs)
    .values({
      id: `${user.id}__${cardId}`,
      userId: user.id,
      flashcardId: cardId,
      sourceQuestionId: body.sourceQuestionId || null,
      originType: "PERSONAL_CARD",
      originLabelEn: body.originContext || "Created by You (Personal Card)",
      originLabelHi: body.originContext || "आपके द्वारा निर्मित (व्यक्तिगत कार्ड)",
      intervalDays: 0,
      repetitions: 0,
      nextDueAt: new Date(),
    })
    .onConflictDoNothing();

  return c.json({ ok: true, flashcardId: cardId });
});

app.delete("/api/v1/srs/cards/:id", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const cardId = c.req.param("id");

  await db
    .delete(schema.flashcards)
    .where(
      and(eq(schema.flashcards.id, cardId), eq(schema.flashcards.createdByUserId, user.id))
    );

  return c.json({ ok: true, deletedId: cardId });
});

app.post("/api/v1/srs/review", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const body = await c.req.json<{ flashcardId: string; rating: 1 | 2 | 3 | 4 }>();

  const rating = body.rating;
  const intervalMap: Record<number, number> = {
    1: 0.007, // ~10 mins
    2: 2, // 2 days
    3: 6, // 6 days
    4: 15, // 15 days
  };

  const existing = await db
    .select()
    .from(schema.userItemSrs)
    .where(
      and(
        eq(schema.userItemSrs.userId, user.id),
        eq(schema.userItemSrs.flashcardId, body.flashcardId)
      )
    )
    .limit(1);

  const prevReps = existing[0]?.repetitions ?? 0;
  const prevInterval = existing[0]?.intervalDays ?? 0;
  const nextInterval =
    rating === 1
      ? intervalMap[1]
      : prevReps > 0 && prevInterval >= 2
        ? Math.round(prevInterval * (rating === 4 ? 2.4 : rating === 3 ? 1.8 : 1.2) * 10) / 10
        : intervalMap[rating] || 6;

  const nextDueAt = new Date(Date.now() + nextInterval * 24 * 60 * 60 * 1000);

  await db
    .insert(schema.userItemSrs)
    .values({
      id: `${user.id}__${body.flashcardId}`,
      userId: user.id,
      flashcardId: body.flashcardId,
      intervalDays: nextInterval,
      repetitions: rating === 1 ? 0 : prevReps + 1,
      lapses: (existing[0]?.lapses ?? 0) + (rating === 1 ? 1 : 0),
      lastRating: rating,
      nextDueAt,
      lastReviewedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.userItemSrs.userId, schema.userItemSrs.flashcardId],
      set: {
        intervalDays: nextInterval,
        repetitions: rating === 1 ? 0 : prevReps + 1,
        lapses: (existing[0]?.lapses ?? 0) + (rating === 1 ? 1 : 0),
        lastRating: rating,
        nextDueAt,
        lastReviewedAt: new Date(),
      },
    });

  return c.json({ ok: true, flashcardId: body.flashcardId, nextIntervalDays: nextInterval, nextDueAt });
});

// ---------------------------------------------------------------------------
// 9. Razorpay Subscription Checkout & Signature Verification
// ---------------------------------------------------------------------------
app.get("/api/v1/billing/plans", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const lang = normalizeLang(user.preferredLanguage);

  const plans = await db
    .select()
    .from(schema.subscriptionPlans)
    .where(eq(schema.subscriptionPlans.isActive, true));

  return c.json({
    plans: plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: pickText(lang, p.nameEn, p.nameHi),
      badge: pickText(lang, p.badgeEn, p.badgeHi),
      amountPaise: p.amountPaise,
      amountInr: Math.round(p.amountPaise / 100),
      currency: p.currency,
      validityDays: p.validityDays,
      features: lang === "HI" ? p.featuresHi : p.featuresEn,
    })),
  });
});

app.post("/api/v1/billing/create-order", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const body = await c.req.json<{ planId: string }>();

  const [plan] = await db
    .select()
    .from(schema.subscriptionPlans)
    .where(eq(schema.subscriptionPlans.id, body.planId))
    .limit(1);

  if (!plan) {
    return c.json({ error: "Invalid subscription plan" }, 400);
  }

  const keyId = c.env?.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
  const keySecret = c.env?.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;

  const order = await createRazorpayOrder({
    amountPaise: plan.amountPaise,
    currency: plan.currency,
    receipt: `rcpt_${Date.now()}`,
    notes: { userId: user.id, planCode: plan.code },
    keyId,
    keySecret,
  });

  const internalId = `ord_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db.insert(schema.paymentOrders).values({
    id: internalId,
    userId: user.id,
    planId: plan.id,
    razorpayOrderId: order.razorpayOrderId,
    amountPaise: order.amountPaise,
    currency: order.currency,
    status: "CREATED",
    isSandbox: order.isSandbox,
  });

  // In Sandbox preview mode, include a verifiable test proof helper for 1-click UI/E2E verification
  const sandboxProof = order.isSandbox
    ? await createSandboxPaymentProof(order.razorpayOrderId)
    : undefined;

  return c.json({
    orderId: order.razorpayOrderId,
    amountPaise: order.amountPaise,
    currency: order.currency,
    keyId: order.keyId,
    isSandbox: order.isSandbox,
    planName: plan.nameEn,
    sandboxProof,
  });
});

app.post("/api/v1/billing/verify-payment", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const body = await c.req.json<{
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }>();

  const [orderRow] = await db
    .select()
    .from(schema.paymentOrders)
    .where(
      and(
        eq(schema.paymentOrders.razorpayOrderId, body.razorpayOrderId),
        eq(schema.paymentOrders.userId, user.id)
      )
    )
    .limit(1);

  if (!orderRow) {
    return c.json({ error: "Order not found" }, 404);
  }

  const keySecret = c.env?.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;
  const isValid = await verifyRazorpayPaymentSignature({
    razorpayOrderId: body.razorpayOrderId,
    razorpayPaymentId: body.razorpayPaymentId,
    razorpaySignature: body.razorpaySignature,
    keySecret,
    isSandbox: orderRow.isSandbox,
  });

  if (!isValid) {
    await db
      .update(schema.paymentOrders)
      .set({ status: "FAILED" })
      .where(eq(schema.paymentOrders.id, orderRow.id));
    return c.json({ error: "Invalid Razorpay payment signature" }, 400);
  }

  const [plan] = await db
    .select()
    .from(schema.subscriptionPlans)
    .where(eq(schema.subscriptionPlans.id, orderRow.planId))
    .limit(1);

  const proExpiresAt = new Date(Date.now() + (plan?.validityDays ?? 365) * 24 * 60 * 60 * 1000);

  await db
    .update(schema.paymentOrders)
    .set({
      razorpayPaymentId: body.razorpayPaymentId,
      razorpaySignature: body.razorpaySignature,
      status: "PAID",
      verifiedAt: new Date(),
    })
    .where(eq(schema.paymentOrders.id, orderRow.id));

  await db
    .update(schema.users)
    .set({
      planTier: "PRO_PASS",
      proExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, user.id));

  return c.json({
    ok: true,
    planTier: "PRO_PASS",
    proExpiresAt,
    razorpayOrderId: body.razorpayOrderId,
  });
});

// Server-to-Server Razorpay Webhook Handler (payment.captured / order.paid)
app.post("/api/v1/billing/webhook", async (c) => {
  const webhookSecret = c.env?.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return c.json({ error: "RAZORPAY_WEBHOOK_SECRET not configured" }, 400);
  }
  const signature = c.req.header("x-razorpay-signature") || "";
  const rawBody = await c.req.text();
  const expected = await computeHmacSha256Hex(rawBody, webhookSecret);
  if (!timingSafeEqualHex(expected, signature.trim().toLowerCase())) {
    return c.json({ error: "Invalid webhook signature" }, 400);
  }

  const event = JSON.parse(rawBody) as {
    event?: string;
    payload?: {
      payment?: { entity?: { id?: string; order_id?: string } };
      order?: { entity?: { id?: string } };
    };
  };

  const rzpOrderId =
    event.payload?.payment?.entity?.order_id || event.payload?.order?.entity?.id;
  const rzpPaymentId = event.payload?.payment?.entity?.id || "webhook_captured";

  if (rzpOrderId && (event.event === "payment.captured" || event.event === "order.paid")) {
    const db = createDb(c.env?.DATABASE_URL);
    const [orderRow] = await db
      .select()
      .from(schema.paymentOrders)
      .where(eq(schema.paymentOrders.razorpayOrderId, rzpOrderId))
      .limit(1);

    if (orderRow) {
      const [plan] = await db
        .select()
        .from(schema.subscriptionPlans)
        .where(eq(schema.subscriptionPlans.id, orderRow.planId))
        .limit(1);
      const proExpiresAt = new Date(Date.now() + (plan?.validityDays ?? 365) * 24 * 60 * 60 * 1000);

      await db
        .update(schema.paymentOrders)
        .set({ razorpayPaymentId: rzpPaymentId, status: "PAID", verifiedAt: new Date() })
        .where(eq(schema.paymentOrders.id, orderRow.id));

      await db
        .update(schema.users)
        .set({ planTier: "PRO_PASS", proExpiresAt, updatedAt: new Date() })
        .where(eq(schema.users.id, orderRow.userId));
    }
  }

  return c.json({ received: true });
});

// Fallback for non-API requests when served via Cloudflare Workers Static Assets
app.all("*", async (c) => {
  if (c.env?.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text("Sankalp UPPCS API Running. Build static assets with `npm run build`.", 200);
});

export default app;
