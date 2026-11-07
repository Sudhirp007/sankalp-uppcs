import { getFreshFirebaseToken } from "./firebase";
import type { LangCode } from "./i18n";

const ASPIRANT_STORAGE_KEY = "sankalp_aspirant_id";
const SAFE_GUEST_ID_RE = /^asp_[a-zA-Z0-9_-]{8,56}$/;

export function getOrCreateAspirantId(): string {
  let id = localStorage.getItem(ASPIRANT_STORAGE_KEY);
  if (!id || !SAFE_GUEST_ID_RE.test(id)) {
    const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    id = `asp_${rand}`;
    localStorage.setItem(ASPIRANT_STORAGE_KEY, id);
  }
  return id;
}

export function rotateNewGuestAspirantId(): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const id = `asp_${rand}`;
  localStorage.setItem(ASPIRANT_STORAGE_KEY, id);
  return id;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("x-aspirant-id", getOrCreateAspirantId());

  const token = await getFreshFirebaseToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(path, {
    ...init,
    headers,
  });

  if (!res.ok) {
    let errMsg = `API Error ${res.status}`;
    try {
      const errBody = (await res.json()) as { error?: string };
      if (errBody?.error) errMsg = errBody.error;
    } catch {
      // ignore json parse failure
    }
    throw new Error(errMsg);
  }
  return (await res.json()) as T;
}

export interface ExamPortfolioCard {
  examId: string;
  slug: string;
  name: string;
  shortName: string;
  description: string;
  totalQuestions: number;
  maxMarks: number;
  durationMins: number;
  positiveMarks: number;
  negativeMarks: number;
  historicalCutoff: number;
  targetCycleLabel: string;
  daysRemaining: number;
  isEnrolled: boolean;
  isPrimary: boolean;
  hasActivity?: boolean;
  readinessScore: number;
  predictedScore: number;
  cutoffMargin: number;
  statusTier: "STRONGHOLD" | "DEVELOPING" | "VULNERABLE" | "NOT_STARTED";
  testsCompleted: number;
  questionsPracticed: number;
  guess5050NetGain: number;
}

export interface UserProfileDTO {
  id: string;
  email: string | null;
  phoneNumber?: string | null;
  isAuthenticated?: boolean;
  displayName: string;
  preferredLanguage: LangCode;
  activeExamId: string;
  dailyGoalMins: number;
  streakDays: number;
  onboardingCompleted: boolean;
  planTier: "FREE" | "PRO_PASS";
  proExpiresAt: string | null;
  isTestBillingMode?: boolean;
  scratchpadNotes: Record<string, string>;
}

export interface BootstrapResponse {
  user: UserProfileDTO;
  exams: ExamPortfolioCard[];
  enrolledExamsCount?: number;
  dueFlashcardsCount: number;
}

export interface JourneyDashboardResponse {
  exam: ExamPortfolioCard;
  hasEnrolledExams: boolean;
  totalQuestionsAttempted: number;
  subjectMastery: Array<{
    domainId: string;
    name: string;
    weightPct: number;
    masteryPct: number;
    practicedCount: number;
    status: "MASTERED" | "DEVELOPING" | "WEAK" | "NOT_STARTED";
  }>;
  gapAlerts: Array<{
    topicId: string;
    name: string;
    subject: string;
    accuracyPct: number;
    weightPct: number;
    artifactId: string;
  }>;
  papers: Array<{
    id: string;
    title: string;
    year: number | null;
    paperType: string;
    totalQuestions: number;
    maxMarks: number;
    durationMins: number;
    hasOfficialKey: boolean;
  }>;
  recentSessions: Array<{
    id: string;
    title: string;
    status: string;
    netMarks: number;
    maxMarks: number;
    correctCount: number;
    wrongCount: number;
    startedAt: string;
  }>;
}

export interface GlobalExpertiseResponse {
  hasEnrolledExams: boolean;
  totalQuestionsAttempted: number;
  overallPortfolioElo: number;
  examRanking: ExamPortfolioCard[];
  formatDiagnostics: Array<{
    format: string;
    label: string;
    attemptedCount?: number;
    accuracyPct: number;
    avgTimeSec: number;
    availableQuestions: number;
    badge: string;
    tone: "EMERALD" | "AMBER" | "ROSE";
  }>;
  unifiedSubjectElo: Array<{
    domainId: string;
    name: string;
    eloScore: number;
    attempts: number;
    retentionPct: number;
  }>;
}

export interface SyllabusMicroTopic {
  id: string;
  name: string;
  description: string;
  isHighYield: boolean;
  priorityTier: string;
  weightPct: number;
  masteryScore: number;
  questionCounts: { total: number; pyq: number; concept: number; ncert: number };
  artifact: { id: string; type: string; title: string; pyqCoverageCount: number } | null;
  flashcardsCount: number;
}

export interface SyllabusTreeResponse {
  examId: string;
  language: LangCode;
  tree: Array<{
    id: string;
    name: string;
    description: string;
    weightPct: number;
    masteryScore: number;
    totalQuestions: number;
    modules: Array<{
      id: string;
      name: string;
      masteryScore: number;
      microTopics: SyllabusMicroTopic[];
    }>;
  }>;
}

export interface TestCockpitItem {
  attemptItemId: string;
  questionId: string;
  displayOrder: number;
  subject: string;
  topicId: string | null;
  difficulty: string;
  questionOrigin: string;
  questionFormat: string;
  stem: string;
  options: Array<{ key: string; text: string }>;
  selectedOption: string | null;
  eliminatedOptions: string[];
  confidenceTag: "SURE" | "GUESS_50_50" | "WILD_GUESS";
  isMarkedReview: boolean;
  timeSpentSec: number;
  linkedArtifactId: string;
  // Populated post-submit or in TUTOR mode
  correctOption?: string;
  isCorrect?: boolean | null;
  marksAwarded?: number;
  explanation?: string;
  goldenRule?: string;
  sourceKeyType?: string;
  confidenceScore?: number;
  repeatedIn?: string[];
}

export interface TestSessionDetailResponse {
  session: {
    id: string;
    examId: string;
    title: string;
    sessionType: string;
    mode: "EXAM" | "TUTOR";
    language: LangCode;
    status: "IN_PROGRESS" | "SUBMITTED";
    durationSec: number;
    elapsedSec: number;
    totalQuestions: number;
    positiveMarks: number;
    negativePenalty: number;
    correctCount: number;
    wrongCount: number;
    skippedCount: number;
    canceledCount: number;
    grossMarks: number;
    negativeMarks: number;
    netMarks: number;
    maxMarks: number;
    guess5050NetGain: number;
    wildGuessNetGain: number;
  };
  items: TestCockpitItem[];
}

export interface StudioSheet {
  id: string;
  topicId: string;
  topicName: string;
  subjectKey: string;
  artifactType: string;
  title: string;
  estReadMins: number;
  pyqCoverageCount: number;
  canonicalSource: string;
  topicMasteryPct: number;
  curationTier: "PRIORITY_GAP" | "PERSONAL_NOTE" | "STRONGHOLD";
  curatedReason: string;
  hasPersonalNote: boolean;
  linkedFlashcardsCount: number;
  scratchpadNote: string;
  content: {
    summary?: string;
    matrixTitle?: string;
    matrixHeaders?: string[];
    matrixRows?: string[][];
    keyArticles?: Array<{ badge: string; title: string; detail: string; tag: string }>;
    chronologyLock?: { title: string; chain: string; rule: string };
  };
}

export interface FlashcardItemDTO {
  flashcardId: string;
  srsId: string | null;
  topicId: string;
  topicBreadcrumb: string;
  topicMasteryPct: number;
  deckCategory: string;
  isPersonal: boolean;
  originType: "TEST_MISTAKE" | "TOPIC_DECK" | "PERSONAL_CARD";
  originLabel: string;
  cardTypeLabel: string;
  front: string;
  back: string;
  trapWarning: string;
  mnemonic: string;
  askedInLabel: string;
  isDue: boolean;
  overdueDays: number;
  nextDueAt: string;
  intervalDays: number;
  repetitions: number;
}

export interface SubscriptionPlanDTO {
  id: string;
  code: string;
  name: string;
  badge: string;
  amountPaise: number;
  amountInr: number;
  currency: string;
  validityDays: number;
  features: string[];
}

export interface PublicPostSummary {
  id: string;
  slug: string;
  category: "CURRENT_AFFAIRS" | "BLOG" | string;
  linkedTopicId: string | null;
  title: string;
  summary: string;
  tags: string[];
  examSlugs: string[];
  readingTimeMins: number;
  publishedAt: string;
}

export interface PublicHomeResponse {
  language: LangCode;
  stats: {
    totalQuestions: number;
    totalPapers: number;
    totalMicroTopics: number;
    totalExams: number;
  };
  exams: Array<{
    id: string;
    slug: string;
    name: string;
    shortName: string;
    description: string;
    totalQuestions: number;
    maxMarks: number;
    durationMins: number;
    positiveMarks: number;
    negativeMarks: number;
    historicalCutoff: number;
    targetCycleLabel: string;
  }>;
  subjectBreakdown: Array<{ subject: string; count: number }>;
  plans: Array<{
    id: string;
    code: string;
    name: string;
    badge: string;
    amountInr: number;
    validityDays: number;
    features: string[];
  }>;
  sampleQuestion: {
    id: string;
    subject: string;
    stem: string;
    options: Array<{ key: string; text: string }>;
    correctOption: string;
    explanation: string;
    goldenRule: string;
  } | null;
  latestPosts: PublicPostSummary[];
}

export interface PublicPostDetailResponse {
  language: LangCode;
  post: PublicPostSummary & {
    body: string;
    keyTakeaways: string[];
    coverMediaUrl: string | null;
  };
  relatedPosts: Array<{
    slug: string;
    category: string;
    title: string;
    readingTimeMins: number;
    publishedAt: string;
  }>;
}

export const api = {
  getPublicHome: (lang: LangCode = "EN") =>
    apiFetch<PublicHomeResponse>(`/api/v1/public/home?lang=${lang}`),

  getPublicPosts: (category = "ALL", lang: LangCode = "EN") =>
    apiFetch<{ language: LangCode; posts: PublicPostSummary[] }>(
      `/api/v1/public/posts?category=${encodeURIComponent(category)}&lang=${lang}`
    ),

  getPublicPostBySlug: (slug: string, lang: LangCode = "EN") =>
    apiFetch<PublicPostDetailResponse>(
      `/api/v1/public/posts/${encodeURIComponent(slug)}?lang=${lang}`
    ),

  getBootstrap: () => apiFetch<BootstrapResponse>("/api/v1/bootstrap"),

  updatePreferences: (payload: {
    preferredLanguage?: LangCode;
    activeExamId?: string;
    enrolledExamIds?: string[];
    dailyGoalMins?: number;
    displayName?: string;
    phoneNumber?: string;
    onboardingCompleted?: boolean;
  }) =>
    apiFetch<{ ok: boolean; preferredLanguage: LangCode; activeExamId: string }>(
      "/api/v1/me/preferences",
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      }
    ),

  saveScratchpad: (artifactId: string, note: string) =>
    apiFetch<{ ok: boolean; scratchpadNotes: Record<string, string> }>("/api/v1/me/scratchpad", {
      method: "PATCH",
      body: JSON.stringify({ artifactId, note }),
    }),

  getJourneyDashboard: (examId: string) =>
    apiFetch<JourneyDashboardResponse>(`/api/v1/journeys/${encodeURIComponent(examId)}/dashboard`),

  getGlobalExpertise: () => apiFetch<GlobalExpertiseResponse>("/api/v1/expertise/global"),

  getSyllabusTree: (examId: string) =>
    apiFetch<SyllabusTreeResponse>(`/api/v1/syllabus/${encodeURIComponent(examId)}/tree`),

  createTestSession: (payload: {
    examId?: string;
    paperId?: string;
    sessionType?: "FULL_PAPER" | "TOPIC_DRILL" | "ADAPTIVE_SMART_DRILL";
    mode?: "EXAM" | "TUTOR";
    topicIds?: string[];
    origins?: string[];
    questionFormat?: string;
    limit?: number;
  }) =>
    apiFetch<{ sessionId: string; totalQuestions: number; language: LangCode }>(
      "/api/v1/test-sessions",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  getTestSession: (sessionId: string) =>
    apiFetch<TestSessionDetailResponse>(`/api/v1/test-sessions/${encodeURIComponent(sessionId)}`),

  submitTestSession: (
    sessionId: string,
    payload: {
      elapsedSec: number;
      responses: Array<{
        questionId: string;
        selectedOption: string | null;
        eliminatedOptions: string[];
        confidenceTag: "SURE" | "GUESS_50_50" | "WILD_GUESS";
        isMarkedReview: boolean;
        timeSpentSec: number;
      }>;
    }
  ) =>
    apiFetch<{
      ok: boolean;
      sessionId: string;
      summary: {
        correctCount: number;
        wrongCount: number;
        skippedCount: number;
        netMarks: number;
        maxMarks: number;
        guess5050NetGain: number;
      };
    }>(`/api/v1/test-sessions/${encodeURIComponent(sessionId)}/submit`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getLearningStudio: () => apiFetch<{ language: LangCode; sheets: StudioSheet[] }>("/api/v1/studio"),

  getDueFlashcards: (deck = "ALL", mode: "DUE_ONLY" | "ALL_PRACTICE" = "DUE_ONLY") =>
    apiFetch<{
      language: LangCode;
      queueMode: "DUE_ONLY" | "ALL_PRACTICE";
      dailySessionCap: number;
      dueCount: number;
      deckDueCount: number;
      overdueBacklogCount: number;
      scheduledLaterCount: number;
      nextScheduledDueAt: string | null;
      mistakeCount: number;
      personalCount: number;
      cards: FlashcardItemDTO[];
    }>(`/api/v1/srs/due?deck=${encodeURIComponent(deck)}&mode=${encodeURIComponent(mode)}`),

  createPersonalFlashcard: (payload: {
    topicId?: string | null;
    sourceQuestionId?: string | null;
    front: string;
    back: string;
    mnemonic?: string;
    trapWarning?: string;
    originContext?: string;
  }) =>
    apiFetch<{ ok: boolean; flashcardId: string }>("/api/v1/srs/cards", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deletePersonalFlashcard: (flashcardId: string) =>
    apiFetch<{ ok: boolean; deletedId: string }>(`/api/v1/srs/cards/${encodeURIComponent(flashcardId)}`, {
      method: "DELETE",
    }),

  reviewFlashcard: (flashcardId: string, rating: 1 | 2 | 3 | 4) =>
    apiFetch<{ ok: boolean; flashcardId: string; nextIntervalDays: number; nextDueAt: string }>(
      "/api/v1/srs/review",
      {
        method: "POST",
        body: JSON.stringify({ flashcardId, rating }),
      }
    ),

  getBillingPlans: () => apiFetch<{ plans: SubscriptionPlanDTO[] }>("/api/v1/billing/plans"),

  createBillingOrder: (
    planId: string,
    opts?: { phoneNumber?: string; displayName?: string }
  ) =>
    apiFetch<{
      orderId: string;
      amountPaise: number;
      currency: string;
      keyId: string;
      isSandbox: boolean;
      planName: string;
      buyerPhone?: string | null;
      sandboxProof?: {
        razorpayOrderId: string;
        razorpayPaymentId: string;
        razorpaySignature: string;
      };
    }>("/api/v1/billing/create-order", {
      method: "POST",
      body: JSON.stringify({ planId, ...(opts || {}) }),
    }),

  verifyBillingPayment: (payload: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }) =>
    apiFetch<{ ok: boolean; planTier: "PRO_PASS"; proExpiresAt: string; razorpayOrderId: string }>(
      "/api/v1/billing/verify-payment",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  resetTestBillingPlan: () =>
    apiFetch<{ ok: boolean; planTier: "FREE" }>("/api/v1/billing/reset-test-plan", {
      method: "POST",
    }),
};
