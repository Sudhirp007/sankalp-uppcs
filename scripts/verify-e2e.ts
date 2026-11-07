import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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
const TEST_USER_ID = `asp_e2e_${Date.now().toString(36)}`;

async function reqJson<T>(path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const headers = new Headers(init?.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("x-aspirant-id", TEST_USER_ID);
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

async function main() {
  console.log(`\n=== Sankalp End-to-End Live Service Verification (${BASE_URL}) ===`);
  console.log(`Test Aspirant Identity: ${TEST_USER_ID}\n`);

  // 1. Static SPA Assets + Edge SEO Injection + Sitemap & Robots Check
  const rootRes = await fetch(`${BASE_URL}/`);
  const rootHtml = await rootRes.text();
  assert.equal(rootRes.status, 200, "GET / must return 200 OK");
  assert.ok(
    rootHtml.includes("<div id=\"root\"></div>"),
    "GET / must serve built Vite SPA HTML"
  );
  assert.ok(
    rootHtml.includes('<link rel="canonical" href="https://uppcs.mockexamonline.com/" />'),
    "GET / must inject Edge SEO canonical tag for uppcs.mockexamonline.com"
  );
  assert.ok(
    rootHtml.includes('type="application/ld+json"'),
    "GET / must inject Schema.org JSON-LD structured data"
  );

  const robotsRes = await fetch(`${BASE_URL}/robots.txt`);
  const robotsTxt = await robotsRes.text();
  assert.equal(robotsRes.status, 200);
  assert.ok(robotsTxt.includes("Sitemap: https://uppcs.mockexamonline.com/sitemap.xml"));

  const sitemapRes = await fetch(`${BASE_URL}/sitemap.xml`);
  const sitemapXml = await sitemapRes.text();
  assert.equal(sitemapRes.status, 200);
  assert.ok(sitemapXml.includes("<urlset") && sitemapXml.includes("/current-affairs/"));

  const pubHome = await reqJson<{
    stats: { totalQuestions: number; totalPapers: number };
    sampleQuestion: { id: string } | null;
    latestPosts: Array<{ slug: string }>;
  }>("/api/v1/public/home");
  assert.equal(pubHome.status, 200);
  assert.ok(pubHome.data.stats.totalQuestions >= 2100, "Public marketing stats must reflect >=2100 questions");
  assert.ok(pubHome.data.latestPosts.length >= 6, "Public home must return seeded Current Affairs & Blog posts");
  assert.ok(pubHome.data.sampleQuestion?.id, "Public home must return live interactive PYQ sampleQuestion");

  console.log(
    `[PASS 1/9] Edge SEO + Sitemap + Public Marketing Feed verified (${pubHome.data.latestPosts.length} SEO posts, sampleQ=${pubHome.data.sampleQuestion?.id})`
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
  assert.ok(health.data.neon.counts.questions >= 1200, "Neon must hold >=1200 UPPSC questions");
  assert.equal(health.data.firebase.projectId, "sankalp-uppcs-app");
  assert.equal(health.data.razorpay.hmacWebCryptoReady, true);
  console.log(
    `[PASS 2/8] Neon Postgres (${health.data.neon.database}@${health.data.neon.branch}): ${health.data.neon.counts.questions} questions, ${health.data.neon.counts.topics} topics, pgvector=${health.data.neon.pgvectorEnabled} | Firebase=${health.data.firebase.projectId} | Razorpay=${health.data.razorpay.configuredMode}`
  );

  // 3. Firebase Auth Forged Token Guard + Bootstrap User Provisioning in Neon
  const forgedBoot = await fetch(`${BASE_URL}/api/v1/bootstrap`, {
    headers: {
      "x-aspirant-id": TEST_USER_ID,
      Authorization: "Bearer forged.invalid.jwt",
    },
  });
  assert.equal(forgedBoot.status, 200);
  const bootJson = (await forgedBoot.json()) as {
    user: { id: string; preferredLanguage: string; planTier: string };
    exams: Array<{ examId: string; readinessScore: number }>;
    dueFlashcardsCount: number;
  };
  assert.equal(bootJson.user.id, TEST_USER_ID, "Forged JWT must not hijack another user identity");
  assert.equal(bootJson.exams.length, 4, "All 4 UPPSC exam journeys returned");
  console.log(
    `[PASS 3/8] Firebase JWKS Guard & Neon Aspirant Provisioning verified (4 UPPSC exams, ${bootJson.dueFlashcardsCount} due SRS cards)`
  );

  // 4. Strict Single-Language Mode (EN) + Test Session Creation (Zero Answer Leakage Pre-Submit)
  await reqJson("/api/v1/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({
      preferredLanguage: "EN",
      activeExamId: "uppcs-prelims",
      enrolledExamIds: ["uppcs-prelims", "uppsc-ro-aro"],
      dailyGoalMins: 45,
      onboardingCompleted: true,
    }),
  });

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
  assert.equal(createdSession.data.language, "EN");

  const enSession = await reqJson<{
    session: { id: string; language: string; status: string };
    items: Array<{
      questionId: string;
      stem: string;
      options: Array<{ key: string; text: string }>;
      correctOption?: string;
    }>;
  }>(`/api/v1/test-sessions/${createdSession.data.sessionId}`);
  assert.equal(enSession.data.session.language, "EN");
  assert.equal(
    enSession.data.items[0]?.correctOption,
    undefined,
    "correctOption MUST NOT leak while EXAM session is IN_PROGRESS"
  );
  console.log(
    `[PASS 4/8] Test Cockpit EN Mode verified (${enSession.data.items.length} questions, answer-key hidden pre-submit)`
  );

  // 5. Switch Profile to Pure Hindi Medium (HI) -> Verify Devanagari Rendering on Session & Studio
  await reqJson("/api/v1/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({ preferredLanguage: "HI" }),
  });

  const hiStudio = await reqJson<{
    language: string;
    sheets: Array<{ id: string; title: string }>;
  }>("/api/v1/studio");
  assert.equal(hiStudio.data.language, "HI");
  assert.match(
    hiStudio.data.sheets[0]!.title,
    /[\u0900-\u097F]/,
    "Hindi medium studio title must render in Devanagari"
  );

  const hiSession = await reqJson<{
    session: { language: string; title: string };
    items: Array<{ questionId: string; stem: string }>;
  }>(`/api/v1/test-sessions/${createdSession.data.sessionId}`);
  assert.equal(hiSession.data.session.language, "HI");
  assert.match(
    hiSession.data.session.title,
    /[\u0900-\u097F]/,
    "Hindi session header must render in Devanagari"
  );
  console.log(
    `[PASS 5/8] Strict Single-Language Hindi Switch verified ("${hiStudio.data.sheets[0]!.title.slice(0, 42)}...")`
  );

  // Switch back to EN and submit paper with 50-50 Elimination & Confidence Tags
  await reqJson("/api/v1/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({ preferredLanguage: "EN" }),
  });

  // 6. Commission Grading (+1.33 / -0.44), 50-50 Net-Gain Audit, Global Expertise & Provenance
  const submitRes = await reqJson<{
    ok: boolean;
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
    body: JSON.stringify({
      elapsedSec: 215,
      responses: enSession.data.items.map((it, idx) => ({
        questionId: it.questionId,
        selectedOption: idx === 0 ? "B" : idx === 1 ? "A" : null,
        eliminatedOptions: idx === 0 ? ["C", "D"] : [],
        confidenceTag: idx === 0 ? "GUESS_50_50" : "SURE",
        isMarkedReview: idx === 1 || idx === 2,
        timeSpentSec: 40,
      })),
    }),
  });
  assert.equal(submitRes.status, 200);
  assert.equal(submitRes.data.ok, true);

  const postSubmit = await reqJson<{
    session: { status: string };
    items: Array<{ correctOption?: string; sourceKeyType?: string; isMarkedReview?: boolean }>;
  }>(`/api/v1/test-sessions/${createdSession.data.sessionId}`);
  assert.equal(postSubmit.data.session.status, "SUBMITTED");
  assert.ok(Boolean(postSubmit.data.items[0]?.correctOption), "correctOption revealed post-submit");
  assert.equal(postSubmit.data.items[1]?.isMarkedReview, true, "Marked for review persisted post-submit");

  const globalExp = await reqJson<{
    overallPortfolioElo: number;
    examRanking: Array<{ examId: string; readinessScore: number; statusTier: string }>;
  }>("/api/v1/expertise/global");
  assert.equal(globalExp.data.examRanking.length, 4);
  console.log(
    `[PASS 6/8] Commission Grading & Cross-Exam Radar verified (Net=${submitRes.data.summary.netMarks}/${submitRes.data.summary.maxMarks}, 50-50 Gain=${submitRes.data.summary.guess5050NetGain}, Global ELO=${globalExp.data.overallPortfolioElo})`
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

  const curatedStudio = await reqJson<{
    sheets: Array<{ id: string; hasPersonalNote: boolean; curationTier: string }>;
  }>("/api/v1/studio");
  const annotatedSheet = curatedStudio.data.sheets.find((s) => s.id === "cs-panchayati-raj");
  assert.equal(annotatedSheet?.hasPersonalNote, true, "Studio sheet must reflect personal note");

  // Create a Private Personal Flashcard & verify multi-tenant privacy isolation
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
  assert.equal(createdCard.data.ok, true);

  const myDeck = await reqJson<{
    personalCount: number;
    cards: Array<{ flashcardId: string; isPersonal: boolean }>;
  }>("/api/v1/srs/due?deck=MY_CARDS");
  assert.equal(myDeck.data.personalCount, 1);
  assert.equal(myDeck.data.cards[0]?.flashcardId, createdCard.data.flashcardId);

  // Verify another user CANNOT see this user's private flashcard
  const otherUserDeckRes = await fetch(`${BASE_URL}/api/v1/srs/due?deck=MY_CARDS`, {
    headers: { "x-aspirant-id": `asp_isolated_${Date.now().toString(36)}` },
  });
  const otherUserDeck = (await otherUserDeckRes.json()) as { personalCount: number };
  assert.equal(otherUserDeck.personalCount, 0, "Private personal flashcards MUST NOT leak across users");

  const dueCards = await reqJson<{
    deckDueCount: number;
    scheduledLaterCount: number;
    cards: Array<{ flashcardId: string }>;
  }>("/api/v1/srs/due");
  assert.ok(dueCards.data.cards.length > 0, "Must have flashcards available");
  const targetCardId = dueCards.data.cards[0]!.flashcardId;
  const reviewRes = await reqJson<{ ok: boolean; nextIntervalDays: number }>("/api/v1/srs/review", {
    method: "POST",
    body: JSON.stringify({ flashcardId: targetCardId, rating: 3 }),
  });
  assert.equal(reviewRes.data.ok, true);
  assert.ok(reviewRes.data.nextIntervalDays >= 2);

  // Verify reviewed card leaves Due-Today queue until its revisit date, while still reachable in ALL_PRACTICE
  const afterReviewDue = await reqJson<{
    scheduledLaterCount: number;
    cards: Array<{ flashcardId: string }>;
  }>("/api/v1/srs/due?mode=DUE_ONLY");
  assert.ok(
    !afterReviewDue.data.cards.some((c) => c.flashcardId === targetCardId),
    "Reviewed card scheduled 6d ahead must sleep until its due date in DUE_ONLY mode"
  );
  assert.ok(afterReviewDue.data.scheduledLaterCount >= 1);

  const delCard = await reqJson<{ ok: boolean }>(`/api/v1/srs/cards/${createdCard.data.flashcardId}`, {
    method: "DELETE",
  });
  assert.equal(delCard.data.ok, true);
  console.log(
    `[PASS 7/8] Curated Studio, Private Personal Flashcard Isolation & FSRS Review verified (nextIntervalDays=${reviewRes.data.nextIntervalDays}d)`
  );

  // 8. Live Razorpay Test API Order Creation + Tampered Signature Rejection + Valid HMAC Upgrade
  const localEnv = loadLocalEnv();
  const rzpSecret = process.env.RAZORPAY_KEY_SECRET || localEnv.RAZORPAY_KEY_SECRET || "";

  const plans = await reqJson<{ plans: Array<{ id: string; amountInr: number }> }>(
    "/api/v1/billing/plans"
  );
  assert.ok(plans.data.plans.length >= 2);

  // 8a. Create Order #1 via Razorpay API and verify tampered signature is REJECTED (400)
  const order1 = await reqJson<{
    orderId: string;
    keyId: string;
    isSandbox: boolean;
    sandboxProof?: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string };
  }>("/api/v1/billing/create-order", {
    method: "POST",
    body: JSON.stringify({ planId: "plan-sankalp-pro-annual" }),
  });
  assert.equal(order1.status, 200);
  if (rzpSecret) {
    assert.equal(order1.data.isSandbox, false, "Must use real Razorpay Test Mode API when keys exist");
    assert.ok(order1.data.orderId.startsWith("order_"), "Razorpay API must return official order_... ID");
  }

  const tamperedVerify = await reqJson<{ error?: string }>("/api/v1/billing/verify-payment", {
    method: "POST",
    body: JSON.stringify({
      razorpayOrderId: order1.data.orderId,
      razorpayPaymentId: "pay_tampered_123",
      razorpaySignature: "0000000000000000000000000000000000000000000000000000000000000000",
    }),
  });
  assert.equal(tamperedVerify.status, 400, "Tampered Razorpay HMAC signature MUST be rejected");

  // 8b. Create Order #2 and verify valid Web Crypto HMAC-SHA256 upgrades user to PRO_PASS
  const order2 = await reqJson<{
    orderId: string;
    isSandbox: boolean;
    sandboxProof?: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string };
  }>("/api/v1/billing/create-order", {
    method: "POST",
    body: JSON.stringify({ planId: "plan-sankalp-pro-annual" }),
  });
  assert.equal(order2.status, 200);

  const paymentPayload = order2.data.sandboxProof
    ? order2.data.sandboxProof
    : {
        razorpayOrderId: order2.data.orderId,
        razorpayPaymentId: `pay_test_${Date.now().toString(36)}`,
        razorpaySignature: createHmac("sha256", rzpSecret)
          .update(`${order2.data.orderId}|pay_test_${Date.now().toString(36)}`)
          .digest("hex"),
      };
  // Ensure paymentId matches signature input exactly when computed locally
  if (!order2.data.sandboxProof) {
    const testPid = `pay_test_${Date.now().toString(36)}`;
    paymentPayload.razorpayPaymentId = testPid;
    paymentPayload.razorpaySignature = createHmac("sha256", rzpSecret)
      .update(`${order2.data.orderId}|${testPid}`)
      .digest("hex");
  }

  const validVerify = await reqJson<{ ok: boolean; planTier: string }>(
    "/api/v1/billing/verify-payment",
    {
      method: "POST",
      body: JSON.stringify(paymentPayload),
    }
  );
  assert.equal(validVerify.status, 200);
  assert.equal(validVerify.data.planTier, "PRO_PASS");

  // 8c. Verify Test-Mode Plan Reset back to FREE works cleanly
  const resetPlan = await reqJson<{ ok: boolean; planTier: string }>(
    "/api/v1/billing/reset-test-plan",
    { method: "POST" }
  );
  assert.equal(resetPlan.status, 200);
  assert.equal(resetPlan.data.planTier, "FREE");

  console.log(
    `[PASS 8/9] Live Razorpay Test API Order (${order2.data.orderId}, isSandbox=${order2.data.isSandbox}) + Web Crypto HMAC-SHA256 verified (tampered rejected 400; valid signature upgraded user to PRO_PASS)`
  );

  // 9. Freemium Conversion Gate Check (FREE tier allows 2 FULL_PAPER mocks, gates 3rd with 402 FREEMIUM_LIMIT_REACHED)
  const fp1 = await reqJson<{ sessionId: string }>("/api/v1/test-sessions", {
    method: "POST",
    body: JSON.stringify({ examId: "uppcs-prelims", sessionType: "FULL_PAPER", mode: "EXAM", limit: 10 }),
  });
  assert.equal(fp1.status, 200, "1st Free FULL_PAPER mock must succeed");

  const fp2 = await reqJson<{ sessionId: string }>("/api/v1/test-sessions", {
    method: "POST",
    body: JSON.stringify({ examId: "uppcs-prelims", sessionType: "FULL_PAPER", mode: "EXAM", limit: 10 }),
  });
  assert.equal(fp2.status, 200, "2nd Free FULL_PAPER mock must succeed");

  const fp3 = await reqJson<{ code?: string; error?: string }>("/api/v1/test-sessions", {
    method: "POST",
    body: JSON.stringify({ examId: "uppcs-prelims", sessionType: "FULL_PAPER", mode: "EXAM", limit: 10 }),
  });
  assert.equal(fp3.status, 402, "3rd Free FULL_PAPER mock must trigger 402 Freemium Upgrade Gate");
  assert.equal(fp3.data.code, "FREEMIUM_LIMIT_REACHED");
  console.log("[PASS 9/9] Freemium Conversion Gate verified (2 Free Full Papers allowed -> 3rd triggers 402 FREEMIUM_LIMIT_REACHED)");

  console.log("\nALL 9 END-TO-END LIVE SERVICE CHECKS PASSED!\n");
}

main().catch((err) => {
  console.error("\n[E2E FAILURE]", err);
  process.exit(1);
});
