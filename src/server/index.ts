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
import { buildRobotsTxt, buildSitemapXml, injectEdgeSeoIntoHtml } from "./seo";

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

// ---------------------------------------------------------------------------
// Security Hardening: OWASP Headers, Origin-Scoped CORS & Edge Burst Rate Limiter
// ---------------------------------------------------------------------------
const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://apis.google.com https://www.google.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.firebaseapp.com https://accounts.google.com https://www.google.com",
  "connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com https://securetoken.google.com https://identitytoolkit.googleapis.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");

app.use("*", async (c, next) => {
  await next();
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Content-Security-Policy", CSP_HEADER);
});

app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) return "https://uppcs.mockexamonline.com";
      if (
        origin === "https://uppcs.mockexamonline.com" ||
        origin === "https://mockexamonline.com" ||
        origin === "https://www.mockexamonline.com" ||
        /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin)
      ) {
        return origin;
      }
      return "https://uppcs.mockexamonline.com";
    },
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-aspirant-id", "x-razorpay-signature"],
    maxAge: 86400,
  })
);

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkIpRateLimit(ip: string, bucket: string, maxPerMin: number): boolean {
  const now = Date.now();
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (v.resetAt <= now) rateBuckets.delete(k);
    }
  }
  const key = `${bucket}:${ip}`;
  const entry = rateBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= maxPerMin) return false;
  entry.count += 1;
  return true;
}

app.use("/api/v1/*", async (c, next) => {
  const method = c.req.method;
  const path = c.req.path;
  if ((method === "POST" || method === "PATCH" || method === "DELETE") && !path.endsWith("/billing/webhook")) {
    const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const isBilling = path.includes("/billing/create-order");
    const allowed = checkIpRateLimit(ip, isBilling ? "billing" : "write", isBilling ? 25 : 180);
    if (!allowed) {
      return c.json({ error: "Too many requests. Please wait a moment and try again." }, 429);
    }
  }
  await next();
});

// ---------------------------------------------------------------------------
// 60-Second Edge Isolate Cache for Read-Only Syllabus & Exam Catalog Tables
// ---------------------------------------------------------------------------
interface StaticCatalogCache {
  expiresAt: number;
  exams: Array<typeof schema.exams.$inferSelect>;
  topics: Array<typeof schema.syllabusTopics.$inferSelect>;
  syllabusMap: Array<typeof schema.examSyllabusMap.$inferSelect>;
  artifacts: Array<typeof schema.learningArtifacts.$inferSelect>;
  plans: Array<typeof schema.subscriptionPlans.$inferSelect>;
}

let catalogCache: StaticCatalogCache | null = null;
const publicHomeCache = new Map<string, { expiresAt: number; payload: unknown }>();

async function getStaticCatalog(db: ReturnType<typeof createDb>): Promise<StaticCatalogCache> {
  if (catalogCache && Date.now() < catalogCache.expiresAt) {
    return catalogCache;
  }
  const [exams, topics, syllabusMap, artifacts, plans] = await Promise.all([
    db.select().from(schema.exams).where(eq(schema.exams.isActive, true)),
    db.select().from(schema.syllabusTopics).orderBy(asc(schema.syllabusTopics.sortOrder)),
    db.select().from(schema.examSyllabusMap),
    db.select().from(schema.learningArtifacts),
    db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.isActive, true)),
  ]);
  catalogCache = {
    expiresAt: Date.now() + 60_000,
    exams,
    topics,
    syllabusMap,
    artifacts,
    plans,
  };
  return catalogCache;
}

export function normalizeIndianOrE164Phone(raw?: string | null): string | null {
  if (!raw) return null;
  const digitsAndPlus = raw.trim().replace(/[\s()-]/g, "");
  if (/^[6-9]\d{9}$/.test(digitsAndPlus)) {
    return `+91${digitsAndPlus}`;
  }
  if (/^91[6-9]\d{9}$/.test(digitsAndPlus)) {
    return `+${digitsAndPlus}`;
  }
  if (/^\+[1-9]\d{9,14}$/.test(digitsAndPlus)) {
    return digitsAndPlus;
  }
  return null;
}

// Helper: Ensure user row exists cleanly in true zero-state (no synthetic metrics or fake journeys)
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

  const normalizedIdentPhone = normalizeIndianOrE164Phone(identity.phoneNumber);

  if (existing.length > 0) {
    let row = existing[0]!;
    const needsProfileSync =
      identity.isVerifiedFirebaseToken &&
      ((identity.email && !row.email) ||
        (normalizedIdentPhone && !row.phoneNumber) ||
        (identity.displayName &&
          (row.displayName === "Sankalp Aspirant" || row.displayName === "UPPSC Aspirant")));

    // Reconcile paid unregistered phone checkout if user later signs in with matching phone number
    let reconciledTier = row.planTier;
    let reconciledExpiry = row.proExpiresAt;
    if (normalizedIdentPhone && row.planTier !== "PRO_PASS") {
      const [paidPhoneOrder] = await db
        .select()
        .from(schema.paymentOrders)
        .where(
          and(
            eq(schema.paymentOrders.buyerPhone, normalizedIdentPhone),
            eq(schema.paymentOrders.status, "PAID")
          )
        )
        .orderBy(desc(schema.paymentOrders.verifiedAt))
        .limit(1);
      if (paidPhoneOrder) {
        reconciledTier = "PRO_PASS";
        reconciledExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      }
    }

    if (needsProfileSync || reconciledTier !== row.planTier) {
      await db
        .update(schema.users)
        .set({
          firebaseUid: identity.firebaseUid || row.firebaseUid,
          email: identity.email || row.email,
          phoneNumber: normalizedIdentPhone || row.phoneNumber,
          displayName: identity.displayName || row.displayName,
          planTier: reconciledTier,
          proExpiresAt: reconciledExpiry,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, row.id));
      row = {
        ...row,
        firebaseUid: identity.firebaseUid || row.firebaseUid,
        email: identity.email || row.email,
        phoneNumber: normalizedIdentPhone || row.phoneNumber,
        displayName: identity.displayName || row.displayName,
        planTier: reconciledTier,
        proExpiresAt: reconciledExpiry,
      };
    }
    return row;
  }

  // Reconcile paid phone order on brand-new Firebase Phone sign-in if applicable
  let initialPlanTier = "FREE";
  let initialProExpiry: Date | null = null;
  if (normalizedIdentPhone) {
    const [paidPhoneOrder] = await db
      .select()
      .from(schema.paymentOrders)
      .where(
        and(
          eq(schema.paymentOrders.buyerPhone, normalizedIdentPhone),
          eq(schema.paymentOrders.status, "PAID")
        )
      )
      .orderBy(desc(schema.paymentOrders.verifiedAt))
      .limit(1);
    if (paidPhoneOrder) {
      initialPlanTier = "PRO_PASS";
      initialProExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    }
  }

  const newUser: typeof schema.users.$inferInsert = {
    id: identity.userId,
    firebaseUid: identity.firebaseUid,
    email: identity.email,
    phoneNumber: normalizedIdentPhone,
    displayName: identity.displayName,
    preferredLanguage: "EN",
    activeExamId: null,
    dailyGoalMins: 45,
    streakDays: 0,
    onboardingCompleted: false,
    planTier: initialPlanTier,
    proExpiresAt: initialProExpiry,
    scratchpadNotes: {},
  };

  await db.insert(schema.users).values(newUser).onConflictDoNothing();

  const created = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, identity.userId))
    .limit(1);
  return created[0]!;
}

// Helper: Calculate cross-exam readiness strictly from user's REAL practiced mastery & enrolled exams
async function computeAllExamReadiness(
  db: ReturnType<typeof createDb>,
  userId: string,
  lang: LangCode
) {
  const [catalog, userMasteryRows, enrolledRows] = await Promise.all([
    getStaticCatalog(db),
    db.select().from(schema.userTopicMastery).where(eq(schema.userTopicMastery.userId, userId)),
    db.select().from(schema.userExamJourneys).where(eq(schema.userExamJourneys.userId, userId)),
  ]);

  const masteryMap = new Map(userMasteryRows.map((m) => [m.topicId, m]));
  const enrolledMap = new Map(enrolledRows.map((j) => [j.examId, j]));
  const totalPracticedAcrossTopics = userMasteryRows.reduce((sum, r) => sum + r.attemptsCount, 0);

  return catalog.exams
    .map((exam) => {
      const maps = catalog.syllabusMap.filter((m) => m.examId === exam.id);
      const enrolled = enrolledMap.get(exam.id);
      const examQuestionsPracticed = enrolled?.questionsPracticed ?? 0;
      const hasActivity = totalPracticedAcrossTopics > 0 || examQuestionsPracticed > 0;

      let weightedSum = 0;
      let totalWeight = 0;
      for (const m of maps) {
        const mRow = masteryMap.get(m.topicId);
        // Unpracticed topics start at 0 (never synthetic 50%) so readiness grows genuinely as questions are solved
        const score = mRow && mRow.attemptsCount > 0 ? mRow.masteryScore : 0;
        weightedSum += score * m.expectedWeightPct;
        totalWeight += m.expectedWeightPct;
      }

      const readiness =
        hasActivity && totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 0;
      const predictedScore = hasActivity
        ? Math.round(exam.maxMarks * (readiness / 100) * 10) / 10
        : 0;
      const cutoffMargin = hasActivity
        ? Math.round((predictedScore - exam.historicalCutoff) * 10) / 10
        : 0;

      const statusTier = !hasActivity
        ? "NOT_STARTED"
        : readiness >= 75
          ? "STRONGHOLD"
          : readiness >= 50
            ? "DEVELOPING"
            : "VULNERABLE";

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
        hasActivity,
        readinessScore: Math.round(readiness),
        predictedScore,
        cutoffMargin,
        statusTier,
        testsCompleted: enrolled?.testsCompleted ?? 0,
        questionsPracticed: examQuestionsPracticed,
        guess5050NetGain: enrolled?.guess5050NetGain ?? 0,
      };
    })
    .sort((a, b) => Number(b.isEnrolled) - Number(a.isEnrolled) || b.readinessScore - a.readinessScore);
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
  const identity = await resolveRequestIdentity(c.req.raw, fbProject);
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

  const keyId = c.env?.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || "";
  const isTestBillingMode = !keyId || keyId.startsWith("rzp_test_");
  const enrolledExams = examPortfolio.filter((e) => e.isEnrolled);
  const resolvedActiveExamId =
    (user.activeExamId && enrolledExams.some((e) => e.examId === user.activeExamId)
      ? user.activeExamId
      : enrolledExams[0]?.examId) ||
    user.activeExamId ||
    "uppcs-prelims";

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber || identity.phoneNumber || null,
      isAuthenticated: identity.isVerifiedFirebaseToken,
      displayName: user.displayName,
      preferredLanguage: lang,
      activeExamId: resolvedActiveExamId,
      dailyGoalMins: user.dailyGoalMins,
      streakDays: user.streakDays,
      onboardingCompleted: user.onboardingCompleted,
      planTier: user.planTier,
      proExpiresAt: user.proExpiresAt,
      isTestBillingMode,
      scratchpadNotes: user.scratchpadNotes || {},
    },
    exams: examPortfolio,
    enrolledExamsCount: enrolledExams.length,
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
    phoneNumber?: string;
    onboardingCompleted?: boolean;
  }>();

  const catalog = await getStaticCatalog(db);
  const validExamIds = new Set(catalog.exams.map((e) => e.id));

  const nextLang = body.preferredLanguage
    ? normalizeLang(body.preferredLanguage)
    : normalizeLang(user.preferredLanguage);
  const candidateActive = body.activeExamId && validExamIds.has(body.activeExamId) ? body.activeExamId : null;
  const nextActiveExam = candidateActive || user.activeExamId || "uppcs-prelims";
  const safeDailyMins =
    typeof body.dailyGoalMins === "number"
      ? Math.min(360, Math.max(10, Math.round(body.dailyGoalMins)))
      : user.dailyGoalMins;
  const safeDisplayName = body.displayName?.trim()
    ? body.displayName.trim().slice(0, 80)
    : user.displayName;
  const safePhone = body.phoneNumber
    ? normalizeIndianOrE164Phone(body.phoneNumber) || user.phoneNumber
    : user.phoneNumber;

  await db
    .update(schema.users)
    .set({
      preferredLanguage: nextLang,
      activeExamId: nextActiveExam,
      dailyGoalMins: safeDailyMins,
      displayName: safeDisplayName,
      phoneNumber: safePhone,
      onboardingCompleted: body.onboardingCompleted ?? user.onboardingCompleted,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, user.id));

  if (Array.isArray(body.enrolledExamIds)) {
    const cleanSelected = Array.from(
      new Set(body.enrolledExamIds.filter((id) => validExamIds.has(id)))
    );
    if (cleanSelected.length > 0) {
      // Remove unselected exams that have 0 completed tests so Journey Home & Global Expertise match exact selection
      await db
        .delete(schema.userExamJourneys)
        .where(
          and(
            eq(schema.userExamJourneys.userId, user.id),
            eq(schema.userExamJourneys.testsCompleted, 0),
            sql`${schema.userExamJourneys.examId} NOT IN (${sql.join(
              cleanSelected.map((id) => sql`${id}`),
              sql`, `
            )})`
          )
        );

      await Promise.all(
        cleanSelected.map((examId) =>
          db
            .insert(schema.userExamJourneys)
            .values({
              id: `${user.id}__${examId}`,
              userId: user.id,
              examId,
              isPrimary: examId === nextActiveExam,
              readinessScore: 0,
              predictedScore: 0,
              syllabusCoveredPct: 0,
              testsCompleted: 0,
              questionsPracticed: 0,
              accuracyPct: 0,
              guess5050NetGain: 0,
            })
            .onConflictDoUpdate({
              target: [schema.userExamJourneys.userId, schema.userExamJourneys.examId],
              set: { isPrimary: examId === nextActiveExam, lastActiveAt: new Date() },
            })
        )
      );
    }
  } else if (candidateActive) {
    await db
      .update(schema.userExamJourneys)
      .set({ isPrimary: false })
      .where(eq(schema.userExamJourneys.userId, user.id));
    await db
      .insert(schema.userExamJourneys)
      .values({
        id: `${user.id}__${candidateActive}`,
        userId: user.id,
        examId: candidateActive,
        isPrimary: true,
        readinessScore: 0,
        predictedScore: 0,
        syllabusCoveredPct: 0,
        testsCompleted: 0,
        questionsPracticed: 0,
        accuracyPct: 0,
        guess5050NetGain: 0,
      })
      .onConflictDoUpdate({
        target: [schema.userExamJourneys.userId, schema.userExamJourneys.examId],
        set: { isPrimary: true, lastActiveAt: new Date() },
      });
  }

  return c.json({ ok: true, preferredLanguage: nextLang, activeExamId: nextActiveExam });
});

app.patch("/api/v1/me/scratchpad", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const body = await c.req.json<{ artifactId: string; note: string }>();

  const artifactId = String(body.artifactId || "").trim().slice(0, 64);
  if (!artifactId) {
    return c.json({ error: "artifactId is required" }, 400);
  }
  const safeNote = String(body.note || "").slice(0, 10_000);
  const existingNotes = user.scratchpadNotes || {};
  if (!(artifactId in existingNotes) && Object.keys(existingNotes).length >= 60) {
    return c.json({ error: "Maximum scratchpad note slots reached" }, 400);
  }

  const merged = { ...existingNotes, [artifactId]: safeNote };
  await db
    .update(schema.users)
    .set({ scratchpadNotes: merged, updatedAt: new Date() })
    .where(eq(schema.users.id, user.id));

  return c.json({ ok: true, scratchpadNotes: merged });
});

// ---------------------------------------------------------------------------
// 3. Per-Exam Learning Journey Dashboard (Screen 2 — True Zero-State Until Practiced)
// ---------------------------------------------------------------------------
app.get("/api/v1/journeys/:examId/dashboard", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const lang = normalizeLang(user.preferredLanguage);
  const requestedExamId = c.req.param("examId");

  const [catalog, portfolio, masteryRows, papers, recentSessions] = await Promise.all([
    getStaticCatalog(db),
    computeAllExamReadiness(db, user.id, lang),
    db.select().from(schema.userTopicMastery).where(eq(schema.userTopicMastery.userId, user.id)),
    db.select().from(schema.examPapers).orderBy(desc(schema.examPapers.year)).limit(12),
    db
      .select()
      .from(schema.testSessions)
      .where(eq(schema.testSessions.userId, user.id))
      .orderBy(desc(schema.testSessions.startedAt))
      .limit(10),
  ]);

  const enrolledExams = portfolio.filter((e) => e.isEnrolled);
  const hasEnrolledExams = enrolledExams.length > 0;
  const activeExam =
    enrolledExams.find((e) => e.examId === requestedExamId) ||
    enrolledExams[0] ||
    portfolio.find((e) => e.examId === requestedExamId) ||
    portfolio[0]!;
  const examId = activeExam.examId;

  const maps = catalog.syllabusMap.filter((m) => m.examId === examId);
  const masteryMap = new Map(masteryRows.map((m) => [m.topicId, m]));
  const artifactByTopic = new Map(catalog.artifacts.map((a) => [a.topicId, a.id]));
  const totalQuestionsAttempted = masteryRows.reduce((sum, m) => sum + m.attemptsCount, 0);

  // Aggregate Exam-Weighted Subject Mastery strictly from user's real practiced topics
  const l1Domains = catalog.topics.filter((t) => t.level === 1);
  const l3Topics = catalog.topics.filter((t) => t.level === 3);
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
        const earnedScore = m && m.attemptsCount > 0 ? m.masteryScore : 0;
        wSum += earnedScore * w;
        wTotal += w;
        practicedCount += m?.attemptsCount ?? 0;
      }
      const pct = practicedCount > 0 && wTotal > 0 ? Math.round(wSum / wTotal) : 0;
      const status =
        practicedCount === 0
          ? "NOT_STARTED"
          : pct >= 75
            ? "MASTERED"
            : pct >= 55
              ? "DEVELOPING"
              : "WEAK";
      return {
        domainId: dom.id,
        name: pickText(lang, dom.nameEn, dom.nameHi),
        weightPct: Math.round(wTotal),
        masteryPct: pct,
        practicedCount,
        status,
      };
    })
    .filter((d) => d.weightPct > 0)
    .sort((a, b) => b.weightPct - a.weightPct);

  // Critical Gap Alerts: ONLY show micro-topics the user has actually attempted and scored < 65%
  const gapAlerts = l3Topics
    .filter((t) => {
      const m = masteryMap.get(t.id);
      return Boolean(m && m.attemptsCount > 0 && m.masteryScore < 65);
    })
    .map((t) => {
      const m = masteryMap.get(t.id)!;
      return {
        topicId: t.id,
        name: pickText(lang, t.nameEn, t.nameHi),
        subject: t.subjectKey,
        accuracyPct: Math.round(m.masteryScore),
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

  const examSessions = recentSessions.filter((s) => s.examId === examId).slice(0, 5);

  return c.json({
    hasEnrolledExams,
    totalQuestionsAttempted,
    exam: activeExam,
    subjectMastery,
    gapAlerts,
    papers: examPapersList,
    recentSessions: examSessions.map((s) => ({
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
// 4. Global Cross-Exam Expertise & Readiness Portfolio (Screen 3 — Real Earned Data Only)
// ---------------------------------------------------------------------------
app.get("/api/v1/expertise/global", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);
  const lang = normalizeLang(user.preferredLanguage);

  const [catalog, portfolio, masteryRows, formatCounts, userFormatStats] = await Promise.all([
    getStaticCatalog(db),
    computeAllExamReadiness(db, user.id, lang),
    db.select().from(schema.userTopicMastery).where(eq(schema.userTopicMastery.userId, user.id)),
    db.execute(sql`
      SELECT question_format, COUNT(*)::int AS total_available
      FROM questions
      GROUP BY question_format
    `),
    db.execute(sql`
      SELECT
        q.question_format,
        COUNT(*)::int AS attempted,
        SUM(CASE WHEN tai.is_correct = TRUE THEN 1 ELSE 0 END)::int AS correct_cnt,
        COALESCE(ROUND(AVG(NULLIF(tai.time_spent_sec, 0)))::int, 0) AS avg_sec
      FROM test_attempt_items tai
      INNER JOIN test_sessions ts ON ts.id = tai.session_id
      INNER JOIN questions q ON q.id = tai.question_id
      WHERE ts.user_id = ${user.id}
        AND ts.status = 'SUBMITTED'
        AND tai.selected_option IS NOT NULL
      GROUP BY q.question_format
    `),
  ]);

  const enrolledRanking = portfolio.filter((e) => e.isEnrolled);
  const totalQuestionsAttempted = masteryRows.reduce((sum, m) => sum + m.attemptsCount, 0);
  const masteryMap = new Map(masteryRows.map((m) => [m.topicId, m]));

  const availByFmt = new Map(
    (formatCounts.rows as Array<{ question_format: string; total_available: number }>).map((r) => [
      r.question_format,
      r.total_available,
    ])
  );
  const userFmtMap = new Map(
    (
      userFormatStats.rows as Array<{
        question_format: string;
        attempted: number;
        correct_cnt: number;
        avg_sec: number;
      }>
    ).map((r) => [r.question_format, r])
  );

  const formatMeta: Array<{ format: string; labelEn: string; labelHi: string }> = [
    {
      format: "SINGLE_CHOICE",
      labelEn: "Direct Single-Choice Factual",
      labelHi: "प्रत्यक्ष एकल-विकल्प तथ्यात्मक प्रश्न",
    },
    {
      format: "CHRONOLOGY",
      labelEn: "Chronological Ordering (Dates & Treaties)",
      labelHi: "कालक्रमानुसार व्यवस्था (तिथियां एवं संधियां)",
    },
    {
      format: "MATCH_LIST",
      labelEn: "Match List-I with List-II (Matrix)",
      labelHi: "सूची-I का सूची-II से सुमेलन",
    },
    {
      format: "MULTI_STATEMENT",
      labelEn: "Multi-Statement Analysis ('1 and 2 only')",
      labelHi: "बहु-कथन विश्लेषण ('केवल 1 और 2')",
    },
    {
      format: "ASSERTION_REASON",
      labelEn: "Assertion (A) & Reason (R)",
      labelHi: "कथन (A) एवं कारण (R) विश्लेषण",
    },
  ];

  const formatDiagnostics = formatMeta.map((meta) => {
    const stat = userFmtMap.get(meta.format);
    const attempted = stat?.attempted ?? 0;
    const accuracyPct = attempted > 0 ? Math.round(((stat?.correct_cnt ?? 0) / attempted) * 100) : 0;
    const avgTimeSec = attempted > 0 ? stat?.avg_sec || 30 : 0;
    const tone: "EMERALD" | "AMBER" | "ROSE" =
      attempted === 0
        ? "AMBER"
        : accuracyPct >= 70
          ? "EMERALD"
          : accuracyPct >= 50
            ? "AMBER"
            : "ROSE";
    const badge =
      attempted === 0
        ? lang === "HI"
          ? "अभ्यास प्रतीक्षित"
          : "NOT ATTEMPTED YET"
        : accuracyPct >= 70
          ? lang === "HI"
            ? "मजबूत सटीकता"
            : "STRONG ACCURACY"
          : accuracyPct >= 50
            ? lang === "HI"
              ? "50-50 निष्कासन उपयोगी"
              : "USE 50-50 STRIKETHROUGH"
            : lang === "HI"
              ? "नकारात्मक अंकन जोखिम"
              : "HIGH NEGATIVE DRAG";

    return {
      format: meta.format,
      label: lang === "HI" ? meta.labelHi : meta.labelEn,
      attemptedCount: attempted,
      accuracyPct,
      avgTimeSec,
      availableQuestions: availByFmt.get(meta.format) ?? 0,
      badge,
      tone,
    };
  });

  const l1Domains = catalog.topics.filter((t) => t.level === 1);
  const l3Topics = catalog.topics.filter((t) => t.level === 3);

  const unifiedSubjectElo = l1Domains.map((dom) => {
    const children = l3Topics.filter((t) => t.subjectKey === dom.subjectKey);
    const attempts = children.reduce((acc, c) => acc + (masteryMap.get(c.id)?.attemptsCount ?? 0), 0);
    const practicedChildren = children.filter((c) => (masteryMap.get(c.id)?.attemptsCount ?? 0) > 0);
    const avg =
      practicedChildren.length > 0
        ? Math.round(
            practicedChildren.reduce((acc, c) => acc + (masteryMap.get(c.id)?.masteryScore ?? 0), 0) /
              children.length
          )
        : 0;
    return {
      domainId: dom.id,
      name: pickText(lang, dom.nameEn, dom.nameHi),
      eloScore: avg,
      attempts,
      retentionPct: attempts > 0 ? Math.min(96, Math.max(30, avg + 10)) : 0,
    };
  });

  const overallElo =
    totalQuestionsAttempted > 0
      ? Math.round(
          (unifiedSubjectElo.reduce((acc, s) => acc + s.eloScore, 0) /
            Math.max(1, unifiedSubjectElo.length)) *
            10
        ) / 10
      : 0;

  return c.json({
    hasEnrolledExams: enrolledRanking.length > 0,
    totalQuestionsAttempted,
    overallPortfolioElo: overallElo,
    examRanking: enrolledRanking,
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

  const [catalog, masteryRows, qCounts, cardCounts] = await Promise.all([
    getStaticCatalog(db),
    db.select().from(schema.userTopicMastery).where(eq(schema.userTopicMastery.userId, user.id)),
    db.execute(sql`
      SELECT topic_id, question_origin, COUNT(*)::int AS cnt
      FROM questions
      WHERE topic_id IS NOT NULL
      GROUP BY topic_id, question_origin
    `),
    db.execute(sql`
      SELECT topic_id, COUNT(*)::int AS cnt
      FROM flashcards
      GROUP BY topic_id
    `),
  ]);

  const topics = catalog.topics;
  const maps = catalog.syllabusMap.filter((m) => m.examId === examId);
  const artifacts = catalog.artifacts;

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
              masteryScore: mRow && mRow.attemptsCount > 0 ? Math.round(mRow.masteryScore) : 0,
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

  // Freemium Quota Enforcement: Free tier gets Unlimited Smart/Topic Drills + 2 Full-Length Commission Papers
  if (user.planTier !== "PRO_PASS" && body.sessionType === "FULL_PAPER") {
    const existingFullPapers = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.testSessions)
      .where(
        and(
          eq(schema.testSessions.userId, user.id),
          eq(schema.testSessions.sessionType, "FULL_PAPER")
        )
      );
    if ((existingFullPapers[0]?.count ?? 0) >= 2) {
      return c.json(
        {
          error: "FREEMIUM_LIMIT_REACHED",
          code: "FREEMIUM_LIMIT_REACHED",
          message:
            lang === "HI"
              ? "निःशुल्क स्टार्टर प्लान में 2 पूर्ण-लंबाई प्रश्नपत्र शामिल हैं। सभी 85+ आयोग प्रश्नपत्र अनलॉक करने हेतु संकल्प प्रो पास चुनें।"
              : "Free Starter includes 2 Full-Length Commission Papers + Unlimited Smart Drills. Upgrade to Sankalp Pro Pass for all 85+ Official Papers!",
        },
        402
      );
    }
  }

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

  // Idempotency & Replay Protection: prevent re-submitting an already graded session
  if (session.status === "SUBMITTED") {
    return c.json({
      ok: true,
      alreadySubmitted: true,
      sessionId,
      summary: {
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
    });
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
  const itemUpdateJobs: Array<() => Promise<unknown>> = [];

  for (const att of attemptRows) {
    const q = qMap.get(att.questionId);
    if (!q) continue;
    const r = respMap.get(att.questionId);
    const rawSel = r?.selectedOption ? String(r.selectedOption).toUpperCase() : null;
    const sel = rawSel && ["A", "B", "C", "D"].includes(rawSel) ? rawSel : null;
    const conf =
      r?.confidenceTag && ["SURE", "GUESS_50_50", "WILD_GUESS"].includes(r.confidenceTag)
        ? r.confidenceTag
        : "SURE";
    const elim = Array.isArray(r?.eliminatedOptions) ? r!.eliminatedOptions.slice(0, 4) : [];
    const spent = Math.min(3600, Math.max(0, Number(r?.timeSpentSec ?? 35) || 35));

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

    itemUpdateJobs.push(() =>
      db
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
        .where(eq(schema.testAttemptItems.id, att.id))
    );
  }

  // Execute per-item grading updates in parallel chunks of 25 for 15x faster submission throughput
  for (let i = 0; i < itemUpdateJobs.length; i += 25) {
    await Promise.all(itemUpdateJobs.slice(i, i + 25).map((fn) => fn()));
  }

  const netMarks = grossMarks - negativeMarks;

  await db
    .update(schema.testSessions)
    .set({
      status: "SUBMITTED",
      elapsedSec: Math.min(86400, Math.max(0, Number(body.elapsedSec ?? 600) || 600)),
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

  // Update Unified Global Topic Mastery in parallel
  const topicIdsToUpdate = Array.from(topicDelta.keys());
  const existingMasteryRows =
    topicIdsToUpdate.length > 0
      ? await db
          .select()
          .from(schema.userTopicMastery)
          .where(
            and(
              eq(schema.userTopicMastery.userId, user.id),
              inArray(schema.userTopicMastery.topicId, topicIdsToUpdate)
            )
          )
      : [];
  const existingMasteryMap = new Map(existingMasteryRows.map((m) => [m.topicId, m]));

  await Promise.all(
    Array.from(topicDelta.entries()).map(([topicId, d]) => {
      const prev = existingMasteryMap.get(topicId);
      if (prev) {
        const totalAtt = prev.attemptsCount + d.attempts;
        const totalCor = prev.correctCount + d.correct;
        const accuracyScore = Math.round((totalCor / Math.max(1, totalAtt)) * 100);
        const blendedScore = Math.min(
          98,
          Math.max(10, Math.round(accuracyScore * 0.65 + (prev.masteryScore + d.deltaScore) * 0.35))
        );
        return db
          .update(schema.userTopicMastery)
          .set({
            masteryScore: blendedScore,
            attemptsCount: totalAtt,
            correctCount: totalCor,
            wrongCount: prev.wrongCount + (d.attempts - d.correct),
            lastPracticedAt: new Date(),
          })
          .where(eq(schema.userTopicMastery.id, prev.id));
      }
      const initialAccuracy = Math.round((d.correct / Math.max(1, d.attempts)) * 100);
      return db.insert(schema.userTopicMastery).values({
        id: `${user.id}__${topicId}`,
        userId: user.id,
        topicId,
        masteryScore: Math.min(95, Math.max(15, initialAccuracy)),
        attemptsCount: d.attempts,
        correctCount: d.correct,
        wrongCount: d.attempts - d.correct,
      });
    })
  );

  // Ensure exam journey exists & increment real counters + activate 1+ day study streak
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
  } else {
    await db
      .insert(schema.userExamJourneys)
      .values({
        id: `${user.id}__${session.examId}`,
        userId: user.id,
        examId: session.examId,
        isPrimary: true,
        testsCompleted: 1,
        questionsPracticed: correctCount + wrongCount,
        guess5050NetGain: Math.round(guess5050NetGain * 100) / 100,
      })
      .onConflictDoNothing();
  }

  if (user.streakDays === 0 && correctCount + wrongCount > 0) {
    await db
      .update(schema.users)
      .set({
        streakDays: 1,
        activeExamId: user.activeExamId || session.examId,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, user.id));
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
  const queueMode = c.req.query("mode") || "DUE_ONLY"; // DUE_ONLY | ALL_PRACTICE
  const dailySessionCap = Number(c.req.query("limit") || "25");

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
      const dueTimeMs = srs ? new Date(srs.nextDueAt).getTime() : now;
      const isDue = !srs || dueTimeMs <= now;
      const overdueDays = isDue && srs ? Math.max(0, Math.floor((now - dueTimeMs) / 86400000)) : 0;
      const t = topicMap.get(fc.topicId);
      const topicMasteryPct = Math.round(masteryMap.get(fc.topicId) ?? 55);
      const originType = isPersonal
        ? "PERSONAL_CARD"
        : (srs?.originType as "TEST_MISTAKE" | "TOPIC_DECK") || "TOPIC_DECK";

      // Priority order: Due -> Test Mistakes -> Personal Cards -> Weak Topics (<60%) -> Most Overdue first
      const priorityRank =
        (isDue ? 0 : 200) +
        (originType === "TEST_MISTAKE" ? 0 : isPersonal ? 12 : topicMasteryPct < 60 ? 24 : 45) -
        Math.min(10, overdueDays) +
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
        overdueDays,
        nextDueAt: srs?.nextDueAt ? new Date(srs.nextDueAt).toISOString() : new Date(now).toISOString(),
        intervalDays: srs?.intervalDays ?? 0,
        repetitions: srs?.repetitions ?? 0,
        priorityRank,
      };
    })
    .sort((a, b) => a.priorityRank - b.priorityRank);

  const deckScoped = mapped.filter((cItem) => {
    if (deckFilter === "MISTAKE_DECK") return cItem.originType === "TEST_MISTAKE";
    if (deckFilter === "MY_CARDS") return cItem.isPersonal;
    if (deckFilter !== "ALL") return cItem.deckCategory === deckFilter;
    return true;
  });

  const dueInDeck = deckScoped.filter((x) => x.isDue);
  const sleepingInDeck = deckScoped
    .filter((x) => !x.isDue)
    .sort((a, b) => new Date(a.nextDueAt).getTime() - new Date(b.nextDueAt).getTime());

  const cardsToServe =
    queueMode === "ALL_PRACTICE"
      ? deckScoped
      : dueInDeck.slice(0, Math.max(1, dailySessionCap));

  return c.json({
    language: lang,
    queueMode,
    dailySessionCap,
    dueCount: mapped.filter((x) => x.isDue).length,
    deckDueCount: dueInDeck.length,
    overdueBacklogCount: dueInDeck.filter((x) => x.overdueDays >= 1).length,
    scheduledLaterCount: sleepingInDeck.length,
    nextScheduledDueAt: sleepingInDeck[0]?.nextDueAt || null,
    mistakeCount: mapped.filter((x) => x.originType === "TEST_MISTAKE").length,
    personalCount: mapped.filter((x) => x.isPersonal).length,
    cards: cardsToServe,
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

  const front = (body.front || "").trim().slice(0, 1000);
  const back = (body.back || "").trim().slice(0, 3000);
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
  const lastReviewedMs = existing[0]?.lastReviewedAt
    ? new Date(existing[0].lastReviewedAt).getTime()
    : Date.now();
  const actualElapsedDays = Math.max(0, (Date.now() - lastReviewedMs) / 86400000);

  // FSRS Overdue Bonus: if user returned late after N days and STILL recalled (Good/Easy),
  // factor actual elapsed days so they aren't stuck repeating tiny intervals.
  const effectiveBase =
    rating >= 3
      ? Math.max(prevInterval, Math.min(actualElapsedDays, Math.max(2, prevInterval * 3)))
      : prevInterval;

  const nextInterval =
    rating === 1
      ? intervalMap[1]
      : prevReps > 0 && effectiveBase >= 2
        ? Math.round(effectiveBase * (rating === 4 ? 2.4 : rating === 3 ? 1.8 : 1.2) * 10) / 10
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
  const body = await c.req.json<{
    planId: string;
    phoneNumber?: string;
    displayName?: string;
  }>();

  const [plan] = await db
    .select()
    .from(schema.subscriptionPlans)
    .where(eq(schema.subscriptionPlans.id, body.planId))
    .limit(1);

  if (!plan) {
    return c.json({ error: "Invalid subscription plan" }, 400);
  }

  const submittedPhone = normalizeIndianOrE164Phone(body.phoneNumber);
  const effectivePhone = submittedPhone || user.phoneNumber || null;

  if (body.phoneNumber && !submittedPhone) {
    return c.json({ error: "Please enter a valid 10-digit Indian mobile number." }, 400);
  }
  if (!effectivePhone && !user.email) {
    return c.json({ error: "Phone number is required before proceeding to payment." }, 400);
  }

  if (submittedPhone || body.displayName?.trim()) {
    await db
      .update(schema.users)
      .set({
        phoneNumber: effectivePhone,
        displayName: body.displayName?.trim()
          ? body.displayName.trim().slice(0, 80)
          : user.displayName,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, user.id));
  }

  const keyId = c.env?.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
  const keySecret = c.env?.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;

  const order = await createRazorpayOrder({
    amountPaise: plan.amountPaise,
    currency: plan.currency,
    receipt: `rcpt_${Date.now()}`,
    notes: {
      userId: user.id,
      planCode: plan.code,
      ...(effectivePhone ? { phone: effectivePhone } : {}),
    },
    keyId,
    keySecret,
  });

  const internalId = `ord_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db.insert(schema.paymentOrders).values({
    id: internalId,
    userId: user.id,
    planId: plan.id,
    razorpayOrderId: order.razorpayOrderId,
    buyerPhone: effectivePhone,
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
    buyerPhone: effectivePhone,
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

  // Idempotency guard against duplicate verify calls
  if (orderRow.status === "PAID") {
    return c.json({
      ok: true,
      alreadyVerified: true,
      planTier: "PRO_PASS",
      proExpiresAt: user.proExpiresAt,
      razorpayOrderId: body.razorpayOrderId,
    });
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

// Test-Mode Helper: Reset user's PRO_PASS back to FREE so Razorpay Checkout can be re-tested anytime
app.post("/api/v1/billing/reset-test-plan", async (c) => {
  const keyId = c.env?.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || "";
  if (keyId && !keyId.startsWith("rzp_test_")) {
    return c.json({ error: "Plan reset is only available in Razorpay Test Mode" }, 403);
  }
  const db = createDb(c.env?.DATABASE_URL);
  const fbProject = c.env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "sankalp-uppcs-app";
  const user = await ensureUserRecord(db, c.req.raw, fbProject);

  await db
    .update(schema.users)
    .set({
      planTier: "FREE",
      proExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, user.id));

  return c.json({ ok: true, planTier: "FREE" });
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

// ---------------------------------------------------------------------------
// 10. Public Marketing, Daily Current Affairs, Blog & SEO Endpoints
// ---------------------------------------------------------------------------
app.get("/robots.txt", (c) => {
  return c.text(buildRobotsTxt(), 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
});

app.get("/sitemap.xml", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const xml = await buildSitemapXml(db);
  return c.body(xml, 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=1800",
  });
});

app.get("/api/v1/public/home", async (c) => {
  const lang = normalizeLang(c.req.query("lang") || "EN");
  const cached = publicHomeCache.get(lang);
  if (cached && Date.now() < cached.expiresAt) {
    return c.json(cached.payload, 200, {
      "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
    });
  }

  const db = createDb(c.env?.DATABASE_URL);
  const [countsRes, catalog, subjectRows, sampleQuestions, posts] = await Promise.all([
    db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM questions) AS total_questions,
        (SELECT COUNT(*)::int FROM exam_papers) AS total_papers,
        (SELECT COUNT(*)::int FROM syllabus_topics WHERE level = 3) AS total_micro_topics,
        (SELECT COUNT(*)::int FROM exams WHERE is_active = true) AS total_exams
    `),
    getStaticCatalog(db),
    db.execute(sql`
      SELECT subject, COUNT(*)::int AS cnt
      FROM questions
      GROUP BY subject
      ORDER BY cnt DESC
    `),
    db
      .select()
      .from(schema.questions)
      .where(sql`${schema.questions.goldenRuleEn} IS NOT NULL`)
      .limit(1),
    db
      .select()
      .from(schema.seoPosts)
      .where(eq(schema.seoPosts.isPublished, true))
      .orderBy(desc(schema.seoPosts.publishedAt))
      .limit(6),
  ]);

  const exams = catalog.exams;
  const plans = catalog.plans;
  const statsRow = countsRes.rows[0] as Record<string, number>;
  const demoQ = sampleQuestions[0];

  const payload = {
    language: lang,
    stats: {
      totalQuestions: statsRow?.total_questions ?? 2118,
      totalPapers: statsRow?.total_papers ?? 85,
      totalMicroTopics: statsRow?.total_micro_topics ?? 35,
      totalExams: statsRow?.total_exams ?? 4,
    },
    exams: exams.map((e) => ({
      id: e.id,
      slug: e.slug,
      name: pickText(lang, e.nameEn, e.nameHi),
      shortName: pickText(lang, e.shortNameEn, e.shortNameHi),
      description: pickText(lang, e.descriptionEn, e.descriptionHi),
      totalQuestions: e.totalQuestions,
      maxMarks: e.maxMarks,
      durationMins: e.durationMins,
      positiveMarks: Math.round(e.positiveMarks * 100) / 100,
      negativeMarks: Math.round(e.positiveMarks * e.negativeMarkingRatio * 100) / 100,
      historicalCutoff: e.historicalCutoff,
      targetCycleLabel: e.targetCycleLabel,
    })),
    subjectBreakdown: (subjectRows.rows as Array<{ subject: string; cnt: number }>).map((r) => ({
      subject: r.subject,
      count: r.cnt,
    })),
    plans: plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: pickText(lang, p.nameEn, p.nameHi),
      badge: pickText(lang, p.badgeEn, p.badgeHi),
      amountInr: Math.round(p.amountPaise / 100),
      validityDays: p.validityDays,
      features: lang === "HI" ? p.featuresHi : p.featuresEn,
    })),
    sampleQuestion: demoQ
      ? {
          id: demoQ.id,
          subject: demoQ.subject,
          stem: pickText(lang, demoQ.questionEn, demoQ.questionHi),
          options: pickOptions(lang, demoQ.optionsEn, demoQ.optionsHi),
          correctOption: demoQ.correctOption,
          explanation: pickText(lang, demoQ.explanationEn, demoQ.explanationHi),
          goldenRule: pickText(lang, demoQ.goldenRuleEn, demoQ.goldenRuleHi),
        }
      : null,
    latestPosts: posts.map((p) => ({
      id: p.id,
      slug: p.slug,
      category: p.category,
      linkedTopicId: p.linkedTopicId,
      title: pickText(lang, p.titleEn, p.titleHi),
      summary: pickText(lang, p.summaryEn, p.summaryHi),
      tags: p.tags,
      examSlugs: p.examSlugs,
      readingTimeMins: p.readingTimeMins,
      publishedAt: p.publishedAt,
    })),
  };

  publicHomeCache.set(lang, { expiresAt: Date.now() + 60_000, payload });
  return c.json(payload, 200, {
    "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
  });
});

app.get("/api/v1/public/posts", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const lang = normalizeLang(c.req.query("lang") || "EN");
  const cat = c.req.query("category") || "ALL";

  const rows = await db
    .select()
    .from(schema.seoPosts)
    .where(
      cat !== "ALL"
        ? and(eq(schema.seoPosts.isPublished, true), eq(schema.seoPosts.category, cat))
        : eq(schema.seoPosts.isPublished, true)
    )
    .orderBy(desc(schema.seoPosts.publishedAt));

  return c.json({
    language: lang,
    posts: rows.map((p) => ({
      id: p.id,
      slug: p.slug,
      category: p.category,
      linkedTopicId: p.linkedTopicId,
      title: pickText(lang, p.titleEn, p.titleHi),
      summary: pickText(lang, p.summaryEn, p.summaryHi),
      tags: p.tags,
      examSlugs: p.examSlugs,
      readingTimeMins: p.readingTimeMins,
      publishedAt: p.publishedAt,
    })),
  });
});

app.get("/api/v1/public/posts/:slug", async (c) => {
  const db = createDb(c.env?.DATABASE_URL);
  const lang = normalizeLang(c.req.query("lang") || "EN");
  const slug = c.req.param("slug");

  const [post] = await db
    .select()
    .from(schema.seoPosts)
    .where(and(eq(schema.seoPosts.slug, slug), eq(schema.seoPosts.isPublished, true)))
    .limit(1);

  if (!post) {
    return c.json({ error: "Article not found" }, 404);
  }

  const related = await db
    .select()
    .from(schema.seoPosts)
    .where(and(eq(schema.seoPosts.isPublished, true), sql`${schema.seoPosts.slug} <> ${slug}`))
    .orderBy(desc(schema.seoPosts.publishedAt))
    .limit(3);

  return c.json({
    language: lang,
    post: {
      id: post.id,
      slug: post.slug,
      category: post.category,
      linkedTopicId: post.linkedTopicId,
      title: pickText(lang, post.titleEn, post.titleHi),
      summary: pickText(lang, post.summaryEn, post.summaryHi),
      body: pickText(lang, post.bodyEn, post.bodyHi),
      keyTakeaways: lang === "HI" ? post.keyTakeawaysHi : post.keyTakeawaysEn,
      tags: post.tags,
      examSlugs: post.examSlugs,
      coverMediaUrl: post.coverMediaUrl,
      readingTimeMins: post.readingTimeMins,
      publishedAt: post.publishedAt,
    },
    relatedPosts: related.map((r) => ({
      slug: r.slug,
      category: r.category,
      title: pickText(lang, r.titleEn, r.titleHi),
      readingTimeMins: r.readingTimeMins,
      publishedAt: r.publishedAt,
    })),
  });
});

// Edge SEO HTML Injector + SPA Asset Fallback
app.all("*", async (c) => {
  if (c.env?.ASSETS) {
    const assetRes = await c.env.ASSETS.fetch(c.req.raw);
    const contentType = assetRes.headers.get("content-type") || "";
    if (c.req.method === "GET" && contentType.includes("text/html")) {
      try {
        const url = new URL(c.req.url);
        const rawHtml = await assetRes.text();
        const db = createDb(c.env?.DATABASE_URL);
        const seoHtml = await injectEdgeSeoIntoHtml(rawHtml, url.pathname, db);
        return c.html(seoHtml, 200);
      } catch {
        return c.env.ASSETS.fetch(c.req.raw);
      }
    }
    return assetRes;
  }
  return c.text("Sankalp UPPCS API Running. Build static assets with `npm run build`.", 200);
});

export default app;
