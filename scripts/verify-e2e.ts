import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

function loadLocalEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [".env.local", ".dev.vars"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const k = trimmed.slice(0, eqIdx).trim();
        const v = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
        out[k] = v;
      }
    }
  }
  return out;
}

const BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:8787";
const TEST_USER_ID = `asp_e2e_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

async function reqJson<T>(path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const headers = new Headers(init?.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("x-aspirant-id", TEST_USER_ID);
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

async function main() {
  console.log(`\n=== Sankalp End-to-End Security & Live Service Verification (${BASE_URL}) ===`);
  console.log(`Test Aspirant Identity: ${TEST_USER_ID}\n`);

  // 1. Static SPA Assets + OWASP Security Headers + Edge SEO + /checkout Route Check
  const rootRes = await fetch(`${BASE_URL}/`);
  const rootHtml = await rootRes.text();
  assert.equal(rootRes.status, 200, "GET / must return 200 OK");
  assert.ok(rootHtml.includes('<div id="root"></div>'), "GET / must serve built Vite SPA HTML");
  assert.ok(
    rootHtml.includes('<link rel="canonical" href="https://uppcs.mockexamonline.com/" />'),
    "GET / must inject Edge SEO canonical tag for uppcs.mockexamonline.com"
  );
  assert.ok(
    Boolean(rootRes.headers.get("strict-transport-security")),
    "OWASP HSTS header must be set"
  );
  assert.ok(
    Boolean(rootRes.headers.get("content-security-policy")),
    "OWASP Content-Security-Policy header must be set"
  );
  assert.equal(
    rootRes.headers.get("x-content-type-options"),
    "nosniff",
    "OWASP X-Content-Type-Options: nosniff must be set"
  );
  assert.equal(
    rootRes.headers.get("x-frame-options"),
    "SAMEORIGIN",
    "OWASP X-Frame-Options: SAMEORIGIN must be set"
  );

  const checkoutRes = await fetch(`${BASE_URL}/checkout`);
  const checkoutHtml = await checkoutRes.text();
  assert.equal(checkoutRes.status, 200, "GET /checkout must return 200 OK regular SPA page");
  assert.ok(
    checkoutHtml.includes('name="robots" content="noindex, nofollow"'),
    "GET /checkout must set noindex, nofollow"
  );

  const appSetupRes = await fetch(`${BASE_URL}/app/setup`);
  assert.equal(appSetupRes.status, 200, "GET /app/setup must return 200 OK regular SPA page");

  const robotsRes = await fetch(`${BASE_URL}/robots.txt`);
  const robotsTxt = await robotsRes.text();
  assert.equal(robotsRes.status, 200);
  assert.ok(robotsTxt.includes("Disallow: /checkout"));

  const pubHome = await reqJson<{
    stats: { totalQuestions: number; totalPapers: number };
    sampleQuestion: { id: string } | null;
    latestPosts: Array<{ slug: string }>;
  }>("/api/v1/public/home");
  assert.equal(pubHome.status, 200);
  assert.ok(pubHome.data.stats.totalQuestions >= 2100);
  assert.ok(pubHome.data.latestPosts.length >= 6);
  assert.ok(pubHome.data.sampleQuestion?.id);

  console.log(
    `[PASS 1/10] OWASP Headers + /checkout & /app/setup Regular Routes + Edge SEO verified (${pubHome.data.latestPosts.length} SEO posts)`
  );

  // 2. Live Service Health Check (Neon + pgvector + Firebase + Razorpay)
  const health = await reqJson<{
    ok: boolean;
    neon: {
      connected: boolean;
      branch: string;
      database: string;
      pgvectorEnabled: boolean;
      counts: Record<string, number>;
    };
    firebase: { projectId: string; statelessJwksVerification: boolean };
    razorpay: { configuredMode: string; hmacWebCryptoReady: boolean };
  }>("/api/v1/health");
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(health.data.neon.connected, true);
  assert.equal(health.data.neon.pgvectorEnabled, true);
  assert.ok(health.data.neon.counts.questions >= 1200);
  assert.equal(health.data.firebase.projectId, "sankalp-uppcs-app");
  console.log(
    `[PASS 2/10] Neon Postgres (${health.data.neon.database}@${health.data.neon.branch}): ${health.data.neon.counts.questions} questions, pgvector=${health.data.neon.pgvectorEnabled}`
  );

  // 3. Anti-Spoofing Identity Check + Brand-New User True Zero-State Check
  const spoofAttempt = await fetch(`${BASE_URL}/api/v1/bootstrap`, {
    headers: {
      "x-aspirant-id": "fb_victim_account_spoof_attempt",
      Authorization: "Bearer forged.invalid.jwt",
    },
  });
  assert.equal(spoofAttempt.status, 200);
  const spoofJson = (await spoofAttempt.json()) as { user: { id: string } };
  assert.notEqual(
    spoofJson.user.id,
    "fb_victim_account_spoof_attempt",
    "Unauthenticated x-aspirant-id MUST NEVER spoof fb_* Firebase accounts"
  );
  assert.ok(spoofJson.user.id.startsWith("asp_anon_"), "Spoofed header must isolate to random asp_anon_*");

  // Brand-new guest user MUST start completely empty (0 streak, 0 enrolled exams, 0% readiness, 0 gap alerts)
  const initialBoot = await reqJson<{
    user: { id: string; streakDays: number; onboardingCompleted: boolean; planTier: string };
    enrolledExamsCount: number;
    exams: Array<{ examId: string; readinessScore: number; isEnrolled: boolean; statusTier: string }>;
    dueFlashcardsCount: number;
  }>("/api/v1/bootstrap");
  assert.equal(initialBoot.data.user.id, TEST_USER_ID);
  assert.equal(initialBoot.data.user.onboardingCompleted, false, "New user onboardingCompleted must be false");
  assert.equal(initialBoot.data.user.streakDays, 0, "New user streakDays must be 0");
  assert.equal(initialBoot.data.enrolledExamsCount, 0, "New user enrolledExamsCount must be 0");
  assert.equal(initialBoot.data.dueFlashcardsCount, 0, "New user dueFlashcardsCount must be 0");
  assert.ok(
    initialBoot.data.exams.every((e) => e.readinessScore === 0 && e.statusTier === "NOT_STARTED"),
    "All exams must start at 0% NOT_STARTED for new users"
  );

  const emptyJourney = await reqJson<{
    hasEnrolledExams: boolean;
    totalQuestionsAttempted: number;
    gapAlerts: unknown[];
  }>("/api/v1/journeys/uppcs-prelims/dashboard");
  assert.equal(emptyJourney.data.hasEnrolledExams, false);
  assert.equal(emptyJourney.data.totalQuestionsAttempted, 0);
  assert.equal(emptyJourney.data.gapAlerts.length, 0);

  const emptyGlobal = await reqJson<{
    hasEnrolledExams: boolean;
    totalQuestionsAttempted: number;
    overallPortfolioElo: number;
    examRanking: unknown[];
  }>("/api/v1/expertise/global");
  assert.equal(emptyGlobal.data.hasEnrolledExams, false);
  assert.equal(emptyGlobal.data.totalQuestionsAttempted, 0);
  assert.equal(emptyGlobal.data.overallPortfolioElo, 0);
  assert.equal(emptyGlobal.data.examRanking.length, 0);

  console.log(
    `[PASS 3/10] Anti-Spoofing fb_* Guard + True Empty Zero-State verified (0 enrolled exams, 0% readiness, 0 ELO, 0 fake gaps)`
  );

  // 4. Configure Medium & Exam Journeys -> Verify Exact Selected Exams Populate at 0%
  await reqJson("/api/v1/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({
      preferredLanguage: "EN",
      activeExamId: "uppcs-prelims",
      enrolledExamIds: ["uppcs-prelims", "uppsc-ro-aro"],
      dailyGoalMins: 45,
      displayName: "E2E Aspirant",
      onboardingCompleted: true,
    }),
  });

  const configuredGlobal = await reqJson<{
    hasEnrolledExams: boolean;
    examRanking: Array<{ examId: string; readinessScore: number }>;
  }>("/api/v1/expertise/global");
  assert.equal(configuredGlobal.data.hasEnrolledExams, true);
  assert.equal(
    configuredGlobal.data.examRanking.length,
    2,
    "Global Expertise must list strictly the 2 exams selected by the user"
  );

  const createdSession = await reqJson<{ sessionId: string; totalQuestions: number; language: string }>(
    "/api/v1/test-sessions",
    {
      method: "POST",
      body: JSON.stringify({
        examId: "uppcs-prelims",
        sessionType: "TOPIC_DRILL",
        topicIds: ["top-polity-panchayat"],
        mode: "EXAM",
        limit: 5,
      }),
    }
  );
  assert.equal(createdSession.status, 200);

  const enSession = await reqJson<{
    session: { id: string; language: string; status: string };
    items: Array<{
      questionId: string;
      stem: string;
      options: Array<{ key: string; text: string }>;
      correctOption?: string;
    }>;
  }>(`/api/v1/test-sessions/${createdSession.data.sessionId}`);
  assert.equal(
    enSession.data.items[0]?.correctOption,
    undefined,
    "correctOption MUST NOT leak while EXAM session is IN_PROGRESS"
  );
  console.log(
    `[PASS 4/10] Exam Selection (2 tracks) + Test Cockpit EN Mode verified (${enSession.data.items.length} questions, answer-key hidden pre-submit)`
  );

  // 5. Switch Profile to Pure Hindi Medium (HI) -> Verify Devanagari Rendering
  await reqJson("/api/v1/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({ preferredLanguage: "HI" }),
  });

  const hiStudio = await reqJson<{
    language: string;
    sheets: Array<{ id: string; title: string }>;
  }>("/api/v1/studio");
  assert.equal(hiStudio.data.language, "HI");
  assert.match(hiStudio.data.sheets[0]!.title, /[\u0900-\u097F]/);

  await reqJson("/api/v1/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({ preferredLanguage: "EN" }),
  });
  console.log(`[PASS 5/10] Strict Single-Language Hindi Switch verified`);

  // 6. Submit Paper -> Verify Real Mastery Populates + Double-Submit Idempotency Guard
  const submitBody = {
    elapsedSec: 215,
    responses: enSession.data.items.map((it, idx) => ({
      questionId: it.questionId,
      selectedOption: idx === 0 ? "B" : idx === 1 ? "A" : null,
      eliminatedOptions: idx === 0 ? ["C", "D"] : [],
      confidenceTag: idx === 0 ? "GUESS_50_50" : "SURE",
      isMarkedReview: idx === 1 || idx === 2,
      timeSpentSec: 40,
    })),
  };

  const submitRes = await reqJson<{
    ok: boolean;
    alreadySubmitted?: boolean;
    summary: {
      correctCount: number;
      wrongCount: number;
      skippedCount: number;
      netMarks: number;
      maxMarks: number;
      guess5050NetGain: number;
    };
  }>(`/api/v1/test-sessions/${createdSession.data.sessionId}/submit`, {
    method: "POST",
    body: JSON.stringify(submitBody),
  });
  assert.equal(submitRes.status, 200);
  assert.equal(submitRes.data.ok, true);

  // Re-submit same session -> must return alreadySubmitted: true without double-inflating mastery!
  const replaySubmit = await reqJson<{ ok: boolean; alreadySubmitted?: boolean }>(
    `/api/v1/test-sessions/${createdSession.data.sessionId}/submit`,
    {
      method: "POST",
      body: JSON.stringify(submitBody),
    }
  );
  assert.equal(replaySubmit.status, 200);
  assert.equal(replaySubmit.data.alreadySubmitted, true, "Double-submit replay guard must prevent duplicate ELO inflation");

  const populatedJourney = await reqJson<{
    totalQuestionsAttempted: number;
    exam: { questionsPracticed: number };
  }>("/api/v1/journeys/uppcs-prelims/dashboard");
  assert.ok(populatedJourney.data.totalQuestionsAttempted >= 2, "Solved questions must populate Journey Home");

  const populatedBoot = await reqJson<{ user: { streakDays: number } }>("/api/v1/bootstrap");
  assert.equal(populatedBoot.data.user.streakDays, 1, "First submitted session must increment streakDays from 0 -> 1");

  console.log(
    `[PASS 6/10] Real Mastery Population + Double-Submit Idempotency Guard verified (attempted=${populatedJourney.data.totalQuestionsAttempted}, streak=1d)`
  );

  // 7. Learning Studio Personal Curation, Private Personal Flashcard CRUD & FSRS Scheduling
  const scratch = await reqJson<{ ok: boolean; scratchpadNotes: Record<string, string> }>(
    "/api/v1/me/scratchpad",
    {
      method: "PATCH",
      body: JSON.stringify({
        artifactId: "cs-panchayati-raj",
        note: "E2E Verified: Ashok Mehta 1977 = 2-tier",
      }),
    }
  );
  assert.equal(scratch.data.ok, true);

  const createdCard = await reqJson<{ ok: boolean; flashcardId: string }>("/api/v1/srs/cards", {
    method: "POST",
    body: JSON.stringify({
      topicId: "top-econ-fiscal",
      front: "E2E Private Card: FRBM 2003 Fiscal Deficit target?",
      back: "3% of GDP",
      mnemonic: "FRBM = 3%",
    }),
  });
  assert.equal(createdCard.status, 200);

  const otherGuestId = `asp_iso_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const otherUserDeckRes = await fetch(`${BASE_URL}/api/v1/srs/due?deck=MY_CARDS`, {
    headers: { "x-aspirant-id": otherGuestId },
  });
  const otherUserDeck = (await otherUserDeckRes.json()) as { personalCount: number };
  assert.equal(otherUserDeck.personalCount, 0, "Private personal flashcards MUST NOT leak across users");

  const dueCards = await reqJson<{
    cards: Array<{ flashcardId: string }>;
  }>("/api/v1/srs/due");
  const targetCardId = dueCards.data.cards[0]!.flashcardId;
  const reviewRes = await reqJson<{ ok: boolean; nextIntervalDays: number }>("/api/v1/srs/review", {
    method: "POST",
    body: JSON.stringify({ flashcardId: targetCardId, rating: 3 }),
  });
  assert.equal(reviewRes.data.ok, true);

  await reqJson<{ ok: boolean }>(`/api/v1/srs/cards/${createdCard.data.flashcardId}`, {
    method: "DELETE",
  });
  console.log(
    `[PASS 7/10] Private Personal Flashcard Isolation & FSRS Scheduling verified (nextIntervalDays=${reviewRes.data.nextIntervalDays}d)`
  );

  // 8. Phone-First Billing Guard (Rejects Unregistered Order Without Phone -> Accepts Valid 10-Digit Phone)
  const localEnv = loadLocalEnv();
  const rzpSecret = process.env.RAZORPAY_KEY_SECRET || localEnv.RAZORPAY_KEY_SECRET || "";

  const missingPhoneOrder = await reqJson<{ error?: string }>("/api/v1/billing/create-order", {
    method: "POST",
    body: JSON.stringify({ planId: "plan-sankalp-pro-annual" }),
  });
  assert.equal(
    missingPhoneOrder.status,
    400,
    "Unregistered visitor without phone number MUST be prompted for 10-digit mobile number (400)"
  );

  const order1 = await reqJson<{
    orderId: string;
    keyId: string;
    isSandbox: boolean;
    buyerPhone: string | null;
    sandboxProof?: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string };
  }>("/api/v1/billing/create-order", {
    method: "POST",
    body: JSON.stringify({
      planId: "plan-sankalp-pro-annual",
      phoneNumber: "9876543210",
      displayName: "Vikky Buyer",
    }),
  });
  assert.equal(order1.status, 200);
  assert.equal(order1.data.buyerPhone, "+919876543210");
  if (rzpSecret) {
    assert.equal(order1.data.isSandbox, false);
    assert.ok(order1.data.orderId.startsWith("order_"));
  }
  console.log(
    `[PASS 8/10] Phone-First Checkout Guard verified (missing phone -> 400; +919876543210 -> ${order1.data.orderId})`
  );

  // 9. Tampered Signature Rejection + Valid HMAC Upgrade + Idempotent Verify + Test Reset
  const tamperedVerify = await reqJson<{ error?: string }>("/api/v1/billing/verify-payment", {
    method: "POST",
    body: JSON.stringify({
      razorpayOrderId: order1.data.orderId,
      razorpayPaymentId: "pay_tampered_123",
      razorpaySignature: "0000000000000000000000000000000000000000000000000000000000000000",
    }),
  });
  assert.equal(tamperedVerify.status, 400);

  const testPid = `pay_test_${Date.now().toString(36)}`;
  const paymentPayload = order1.data.sandboxProof
    ? order1.data.sandboxProof
    : {
        razorpayOrderId: order1.data.orderId,
        razorpayPaymentId: testPid,
        razorpaySignature: createHmac("sha256", rzpSecret)
          .update(`${order1.data.orderId}|${testPid}`)
          .digest("hex"),
      };

  const validVerify = await reqJson<{ ok: boolean; planTier: string }>(
    "/api/v1/billing/verify-payment",
    {
      method: "POST",
      body: JSON.stringify(paymentPayload),
    }
  );
  assert.equal(validVerify.status, 200);
  assert.equal(validVerify.data.planTier, "PRO_PASS");

  const resetPlan = await reqJson<{ ok: boolean; planTier: string }>(
    "/api/v1/billing/reset-test-plan",
    { method: "POST" }
  );
  assert.equal(resetPlan.status, 200);
  assert.equal(resetPlan.data.planTier, "FREE");
  console.log(`[PASS 9/10] Razorpay HMAC-SHA256 Verification & Test-Mode Plan Reset verified`);

  // 10. Freemium Conversion Gate Check (FREE tier allows 2 FULL_PAPER mocks, gates 3rd with 402)
  const fp1 = await reqJson<{ sessionId: string }>("/api/v1/test-sessions", {
    method: "POST",
    body: JSON.stringify({ examId: "uppcs-prelims", sessionType: "FULL_PAPER", mode: "EXAM", limit: 10 }),
  });
  assert.equal(fp1.status, 200);

  const fp2 = await reqJson<{ sessionId: string }>("/api/v1/test-sessions", {
    method: "POST",
    body: JSON.stringify({ examId: "uppcs-prelims", sessionType: "FULL_PAPER", mode: "EXAM", limit: 10 }),
  });
  assert.equal(fp2.status, 200);

  const fp3 = await reqJson<{ code?: string }>("/api/v1/test-sessions", {
    method: "POST",
    body: JSON.stringify({ examId: "uppcs-prelims", sessionType: "FULL_PAPER", mode: "EXAM", limit: 10 }),
  });
  assert.equal(fp3.status, 402);
  assert.equal(fp3.data.code, "FREEMIUM_LIMIT_REACHED");
  console.log(`[PASS 10/10] Freemium Conversion Gate verified (2 Free Full Papers -> 3rd triggers 402)`);

  console.log("\nALL 10 END-TO-END SECURITY & LIVE SERVICE CHECKS PASSED!\n");
}

main().catch((err) => {
  console.error("\n[E2E FAILURE]", err);
  process.exit(1);
});
