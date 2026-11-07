import React, { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Compass,
  Crown,
  Flame,
  Globe2,
  GraduationCap,
  Layers,
  LayoutDashboard,
  ListTree,
  LogOut,
  Settings2,
  UserCircle2,
} from "lucide-react";
import type { User as FirebaseUser } from "firebase/auth";
import {
  api,
  rotateNewGuestAspirantId,
  type BootstrapResponse,
  type GlobalExpertiseResponse,
  type JourneyDashboardResponse,
  type StudioSheet,
  type SyllabusTreeResponse,
  type TestSessionDetailResponse,
} from "./lib/api";
import { signOutFirebase, subscribeFirebaseUser } from "./lib/firebase";
import { UI_COPY, type LangCode } from "./lib/i18n";
import { OnboardingModal } from "./components/OnboardingModal";
import { UpgradeModal } from "./components/UpgradeModal";
import { AuthModal } from "./components/AuthModal";
import { JourneyDashboardView } from "./views/JourneyDashboardView";
import { GlobalExpertiseView } from "./views/GlobalExpertiseView";
import { SyllabusExplorerView } from "./views/SyllabusExplorerView";
import { TestCockpitView } from "./views/TestCockpitView";
import { LearningStudioView } from "./views/LearningStudioView";
import { FlashcardsSrsView } from "./views/FlashcardsSrsView";
import { PublicMarketingApp } from "./views/PublicMarketingApp";
import { CheckoutPageView } from "./views/CheckoutPageView";

type ActiveTab = "JOURNEY" | "GLOBAL" | "SYLLABUS" | "STUDIO" | "SRS" | "COCKPIT";

export const App: React.FC = () => {
  const [pathname, setPathname] = useState<string>(() => window.location.pathname || "/");
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("JOURNEY");

  const [journeyData, setJourneyData] = useState<JourneyDashboardResponse | null>(null);
  const [globalData, setGlobalData] = useState<GlobalExpertiseResponse | null>(null);
  const [syllabusData, setSyllabusData] = useState<SyllabusTreeResponse | null>(null);
  const [studioSheets, setStudioSheets] = useState<StudioSheet[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>("cs-panchayati-raj");
  const [activeSession, setActiveSession] = useState<TestSessionDetailResponse | null>(null);

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [loadingBoot, setLoadingBoot] = useState(true);
  const [startingSession, setStartingSession] = useState(false);
  const [submittingSession, setSubmittingSession] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname || "/");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigateTo = useCallback((nextPath: string) => {
    const currentFull = `${window.location.pathname}${window.location.search}`;
    if (currentFull !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    const cleanOnlyPath = nextPath.split("?")[0] || "/";
    setPathname(cleanOnlyPath);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const unsub = subscribeFirebaseUser((u) => {
      setFbUser(u);
    });
    return unsub;
  }, []);

  const refreshAll = useCallback(async (overrideExamId?: string): Promise<BootstrapResponse | null> => {
    try {
      setErrorBanner(null);
      const b = await api.getBootstrap();
      setBoot(b);
      const targetExam = overrideExamId || b.user.activeExamId || "uppcs-prelims";
      const [jData, gData, sTree, stData] = await Promise.all([
        api.getJourneyDashboard(targetExam),
        api.getGlobalExpertise(),
        api.getSyllabusTree(targetExam),
        api.getLearningStudio(),
      ]);
      setJourneyData(jData);
      setGlobalData(gData);
      setSyllabusData(sTree);
      setStudioSheets(stData.sheets);
      return b;
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to connect to Sankalp Edge API");
      return null;
    } finally {
      setLoadingBoot(false);
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll, fbUser?.uid]);

  const lang: LangCode = boot?.user.preferredLanguage || "EN";
  const t = UI_COPY[lang];

  // Unified Sign-Out Handler -> Always Redirects Cleanly to Home Page (/)
  const handleSignOut = useCallback(async () => {
    await signOutFirebase();
    rotateNewGuestAspirantId();
    setActiveSession(null);
    setActiveTab("JOURNEY");
    setShowAuthModal(false);
    setShowUpgradeModal(false);
    navigateTo("/");
    await refreshAll();
  }, [navigateTo, refreshAll]);

  // Unified Post-Registration / Post-Sign-In Handler -> Takes User to Configure Medium & Exam Journeys
  const handleAuthenticated = useCallback(async () => {
    const freshBoot = await refreshAll();
    const hasPracticed = freshBoot?.exams.some((e) => e.questionsPracticed > 0) ?? false;
    const needsSetup =
      !freshBoot?.user.onboardingCompleted ||
      (freshBoot?.enrolledExamsCount ?? 0) === 0 ||
      !hasPracticed;

    if (needsSetup) {
      navigateTo("/app/setup");
    } else if (!window.location.pathname.startsWith("/app")) {
      navigateTo("/app");
    }
  }, [navigateTo, refreshAll]);

  const handleToggleLanguage = async () => {
    const nextLang: LangCode = lang === "EN" ? "HI" : "EN";
    await api.updatePreferences({ preferredLanguage: nextLang });
    await refreshAll();
    if (activeSession) {
      const refreshed = await api.getTestSession(activeSession.session.id);
      setActiveSession(refreshed);
    }
  };

  const handleSwitchExamJourney = async (examId: string) => {
    if (examId === "__MANAGE__") {
      navigateTo("/app/setup");
      return;
    }
    await api.updatePreferences({ activeExamId: examId });
    await refreshAll(examId);
    setActiveTab("JOURNEY");
  };

  const launchSession = async (params: {
    sessionType: "FULL_PAPER" | "TOPIC_DRILL" | "ADAPTIVE_SMART_DRILL";
    paperId?: string;
    topicIds?: string[];
    origins?: string[];
    questionFormat?: string;
    mode?: "EXAM" | "TUTOR";
    limit?: number;
  }) => {
    if (!boot) return;
    setStartingSession(true);
    try {
      const created = await api.createTestSession({
        examId: boot.user.activeExamId,
        ...params,
      });
      const detail = await api.getTestSession(created.sessionId);
      setActiveSession(detail);
      setActiveTab("COCKPIT");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unable to start test session";
      if (msg.includes("FREEMIUM_LIMIT_REACHED")) {
        setShowUpgradeModal(true);
      } else {
        setErrorBanner(msg);
      }
    } finally {
      setStartingSession(false);
    }
  };

  const handleOpenExistingSession = async (sessionId: string) => {
    setStartingSession(true);
    try {
      const detail = await api.getTestSession(sessionId);
      setActiveSession(detail);
      setActiveTab("COCKPIT");
    } finally {
      setStartingSession(false);
    }
  };

  const handleSubmitPaper = async (payload: {
    elapsedSec: number;
    responses: Array<{
      questionId: string;
      selectedOption: string | null;
      eliminatedOptions: string[];
      confidenceTag: "SURE" | "GUESS_50_50" | "WILD_GUESS";
      isMarkedReview: boolean;
      timeSpentSec: number;
    }>;
  }) => {
    if (!activeSession) return;
    setSubmittingSession(true);
    try {
      await api.submitTestSession(activeSession.session.id, payload);
      const graded = await api.getTestSession(activeSession.session.id);
      setActiveSession(graded);
      await refreshAll();
    } finally {
      setSubmittingSession(false);
    }
  };

  const handleOpenCheatSheet = (artifactId: string) => {
    setSelectedSheetId(artifactId);
    setActiveTab("STUDIO");
  };

  const cleanPath = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");

  // 1. Dedicated Regular Full-Page Phone-First Checkout Route (/checkout)
  if (cleanPath === "/checkout") {
    return (
      <CheckoutPageView
        lang={lang}
        userEmail={fbUser?.email || boot?.user.email || null}
        initialDisplayName={fbUser?.displayName || boot?.user.displayName || ""}
        initialPhoneNumber={fbUser?.phoneNumber || boot?.user.phoneNumber || null}
        currentPlanTier={boot?.user.planTier || "FREE"}
        isTestBillingMode={boot?.user.isTestBillingMode ?? true}
        onToggleLanguage={handleToggleLanguage}
        onNavigateHome={() => navigateTo("/")}
        onResetPlanSuccess={async () => {
          await refreshAll();
        }}
        onPaymentSuccess={async () => {
          await refreshAll();
          // After payment, take buyer straight to /app setup page to provide further profile & exam info
          navigateTo("/app/setup");
        }}
      />
    );
  }

  const isAppWorkspace = cleanPath === "/app" || cleanPath.startsWith("/app/");

  // 2. Public Marketing Website, SEO Content Hubs & Pricing Funnel (/, /pricing, /current-affairs, /blog, /exams/*)
  if (!isAppWorkspace) {
    return (
      <>
        <PublicMarketingApp
          pathname={cleanPath}
          lang={lang}
          fbUser={fbUser}
          planTier={boot?.user.planTier || "FREE"}
          onToggleLanguage={handleToggleLanguage}
          onNavigate={navigateTo}
          onSignOut={handleSignOut}
          onEnterFreeApp={async (opts) => {
            if (opts?.examId) {
              await api.updatePreferences({
                activeExamId: opts.examId,
                enrolledExamIds: [opts.examId],
              });
              await refreshAll(opts.examId);
            }
            navigateTo("/app");
            if (opts?.topicId) {
              await launchSession({
                sessionType: "TOPIC_DRILL",
                topicIds: [opts.topicId],
                limit: 10,
              });
            }
          }}
          onOpenProCheckout={(planId) => {
            // Unregistered visitors go to dedicated phone-first /checkout regular page;
            // signed-in users also get the clean full-page /checkout experience!
            const targetUrl =
              typeof planId === "string" && planId
                ? `/checkout?plan=${encodeURIComponent(planId)}`
                : "/checkout";
            navigateTo(targetUrl);
          }}
          onOpenAuthModal={() => setShowAuthModal(true)}
        />

        {showAuthModal && (
          <AuthModal
            lang={lang}
            fbUser={fbUser}
            onClose={() => setShowAuthModal(false)}
            onAuthenticated={handleAuthenticated}
            onSignedOut={handleSignOut}
          />
        )}
      </>
    );
  }

  if (loadingBoot || !boot) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] text-slate-600 gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#1E3A8A] text-white flex items-center justify-center font-extrabold text-lg animate-pulse">
          स
        </div>
        <div className="text-sm font-semibold">Initializing Sankalp Adaptive Engine...</div>
      </div>
    );
  }

  const enrolledExams = boot.exams.filter((e) => e.isEnrolled);
  const requiresInitialSetup = !boot.user.onboardingCompleted || enrolledExams.length === 0;

  // 3. Regular Full-Page "Configure Your Preferred Medium & Exam Journeys" (NOT a popup!)
  if (cleanPath === "/app/setup" || (cleanPath === "/app" && requiresInitialSetup && activeTab !== "COCKPIT")) {
    return (
      <OnboardingModal
        initialLang={boot.user.preferredLanguage}
        initialActiveExamId={boot.user.activeExamId}
        initialDailyGoalMins={boot.user.dailyGoalMins}
        initialDisplayName={fbUser?.displayName || boot.user.displayName}
        initialPhoneNumber={fbUser?.phoneNumber || boot.user.phoneNumber || ""}
        planTier={boot.user.planTier}
        isAuthenticated={Boolean(fbUser || boot.user.isAuthenticated)}
        exams={boot.exams}
        onNavigateHome={() => navigateTo("/")}
        onSignOut={handleSignOut}
        onClose={!requiresInitialSetup ? () => navigateTo("/app") : undefined}
        onSave={async (payload) => {
          await api.updatePreferences({ ...payload, onboardingCompleted: true });
          await refreshAll(payload.activeExamId);
          setActiveTab("JOURNEY");
          navigateTo("/app");
        }}
      />
    );
  }

  // 4. Distraction-Free Full-Screen 3-Column Test Cockpit Mode
  if (activeTab === "COCKPIT" && activeSession) {
    return (
      <TestCockpitView
        lang={lang}
        detail={activeSession}
        submitting={submittingSession}
        onToggleLanguage={handleToggleLanguage}
        onSubmitPaper={handleSubmitPaper}
        onExitToDashboard={() => setActiveTab("JOURNEY")}
        onOpenCheatSheet={handleOpenCheatSheet}
        onOpenMistakeDeck={() => setActiveTab("SRS")}
        onFlashcardCreated={() => {
          void refreshAll();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      {/* Persistent Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 lg:px-6 h-16 flex items-center justify-between gap-3">
          {/* Brand + Active Exam Journey Switcher */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div
              onClick={() => navigateTo("/")}
              title="Back to MockExamOnline.com Home"
              className="flex items-center gap-2 cursor-pointer shrink-0"
            >
              <div className="w-9 h-9 rounded-xl bg-[#1E3A8A] text-white flex items-center justify-center font-extrabold text-base shadow-xs shrink-0">
                <GraduationCap className="w-5 h-5" />
              </div>
              <div className="hidden lg:block">
                <div className="font-extrabold text-base leading-none text-slate-900">Sankalp</div>
                <div className="text-[10px] text-slate-500 font-medium mt-0.5 whitespace-nowrap">
                  MockExamOnline
                </div>
              </div>
            </div>

            {enrolledExams.length > 0 && (
              <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
                <span className="hidden xl:inline text-[11px] font-semibold text-slate-400 uppercase">
                  {t.activeJourneyLabel}:
                </span>
                <select
                  aria-label="Active Exam Journey"
                  value={boot.user.activeExamId}
                  onChange={(e) => handleSwitchExamJourney(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-[#1E3A8A] focus:outline-none focus:border-[#1E3A8A] cursor-pointer"
                >
                  {enrolledExams.map((ex) => (
                    <option key={ex.examId} value={ex.examId}>
                      {ex.shortName} ({ex.readinessScore}%)
                    </option>
                  ))}
                  <option value="__MANAGE__">
                    {lang === "HI" ? "+ परीक्षाएं जोड़ें / बदलें..." : "+ Add / Manage Exams..."}
                  </option>
                </select>
              </div>
            )}
          </div>

          {/* Primary Navigation Tabs */}
          <nav className="hidden xl:flex items-center gap-1 shrink-0">
            {(
              [
                { id: "JOURNEY", label: t.navJourney, icon: LayoutDashboard },
                { id: "GLOBAL", label: t.navGlobal, icon: Compass },
                { id: "SYLLABUS", label: t.navSyllabus, icon: ListTree },
                { id: "STUDIO", label: t.navStudio, icon: BookOpen },
                {
                  id: "SRS",
                  label: `${t.navSrs}${boot.dueFlashcardsCount ? ` (${boot.dueFlashcardsCount})` : ""}`,
                  icon: Layers,
                },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                    isActive
                      ? "bg-indigo-50 text-[#1E3A8A]"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Action Controls: Streak, Medium Toggle, Razorpay Pro Pass, Setup, Auth */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden 2xl:inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-bold text-amber-900 whitespace-nowrap">
              <Flame className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="font-mono-metric">{boot.user.streakDays}</span>
              <span className="text-[11px]">{t.streakSuffix}</span>
            </div>

            {/* Instant Single-Language Toggle (EN / हिन्दी) */}
            <button
              type="button"
              title={t.mediumToggleTitle}
              onClick={handleToggleLanguage}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 px-2.5 py-1.5 text-xs font-bold text-[#1E3A8A] whitespace-nowrap transition cursor-pointer"
            >
              <Globe2 className="w-3.5 h-3.5 shrink-0" />
              <span>{t.mediumLabel}</span>
            </button>

            {/* Razorpay Pro Pass Upgrade / Active Badge */}
            {boot.user.planTier === "PRO_PASS" ? (
              <button
                type="button"
                onClick={() => setShowUpgradeModal(true)}
                title="Manage Pro Pass or Reset in Test Mode"
                className="inline-flex items-center gap-1 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-200 px-2.5 py-1.5 text-[11px] font-extrabold whitespace-nowrap transition cursor-pointer"
              >
                <Crown className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>{t.proActiveBadge}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigateTo("/checkout")}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold px-2.5 sm:px-3 py-1.5 text-xs whitespace-nowrap shadow-xs transition cursor-pointer"
              >
                <Crown className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">{t.upgradePro}</span>
              </button>
            )}

            <button
              type="button"
              title={t.preferencesSetup}
              onClick={() => navigateTo("/app/setup")}
              className="p-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
            >
              <Settings2 className="w-4 h-4" />
            </button>

            {fbUser ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowAuthModal(true)}
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-xs font-bold text-emerald-900 hover:bg-emerald-100 cursor-pointer"
                >
                  <UserCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  <span className="max-w-[110px] truncate">
                    {fbUser.displayName || fbUser.phoneNumber || fbUser.email?.split("@")[0]}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  title="Sign Out to Home Page"
                  className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 px-2.5 py-1.5 text-xs font-bold text-rose-800 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{t.signOut}</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white px-3 py-1.5 text-xs font-bold transition cursor-pointer"
              >
                <UserCircle2 className="w-3.5 h-3.5" />
                <span>{t.signIn}</span>
              </button>
            )}
          </div>
        </div>

        {/* Tablet & Mobile Sub-Nav Strip (<1280px) */}
        <div className="xl:hidden flex items-center gap-1 overflow-x-auto px-4 py-2 border-t border-slate-100 bg-slate-50/70">
          {(
            [
              { id: "JOURNEY", label: t.navJourney },
              { id: "GLOBAL", label: t.navGlobal },
              { id: "SYLLABUS", label: t.navSyllabus },
              { id: "STUDIO", label: t.navStudio },
              { id: "SRS", label: t.navSrs },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`shrink-0 rounded-lg px-3 py-1 text-xs font-bold ${
                activeTab === item.id ? "bg-[#1E3A8A] text-white" : "text-slate-600"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-6 py-6">
        {errorBanner && (
          <div className="mb-5 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-800 font-medium">
            {errorBanner}
          </div>
        )}

        {activeTab === "JOURNEY" && journeyData && (
          <JourneyDashboardView
            lang={lang}
            data={journeyData}
            startingSession={startingSession}
            onStartSmartDrill={() =>
              launchSession({ sessionType: "ADAPTIVE_SMART_DRILL", limit: 10 })
            }
            onStartPaper={(paperId) =>
              launchSession({ sessionType: "FULL_PAPER", paperId, limit: 15 })
            }
            onOpenSession={handleOpenExistingSession}
            onOpenCheatSheet={handleOpenCheatSheet}
            onNavigateSyllabus={() => setActiveTab("SYLLABUS")}
            onOpenSetup={() => navigateTo("/app/setup")}
          />
        )}

        {activeTab === "GLOBAL" && globalData && (
          <GlobalExpertiseView
            lang={lang}
            data={globalData}
            onSwitchExamJourney={handleSwitchExamJourney}
            onStartFormatDrill={(questionFormat) =>
              launchSession({
                sessionType: "TOPIC_DRILL",
                questionFormat,
                limit: 10,
              })
            }
            onOpenSetup={() => navigateTo("/app/setup")}
          />
        )}

        {activeTab === "SYLLABUS" && syllabusData && (
          <SyllabusExplorerView
            lang={lang}
            data={syllabusData}
            startingSession={startingSession}
            onStartCustomSession={({ topicIds, origins, mode, limit }) =>
              launchSession({
                sessionType: "TOPIC_DRILL",
                topicIds,
                origins,
                mode,
                limit,
              })
            }
            onOpenCheatSheet={handleOpenCheatSheet}
          />
        )}

        {activeTab === "STUDIO" && (
          <LearningStudioView
            lang={lang}
            sheets={studioSheets}
            selectedSheetId={selectedSheetId}
            onSelectSheet={setSelectedSheetId}
            onStartTopicDrill={(topicId) =>
              launchSession({
                sessionType: "TOPIC_DRILL",
                topicIds: [topicId],
                limit: 10,
              })
            }
            onOpenFlashcards={() => setActiveTab("SRS")}
            onRefreshStudio={() => {
              void refreshAll();
            }}
          />
        )}

        {activeTab === "SRS" && (
          <FlashcardsSrsView
            lang={lang}
            onReviewedCountChange={() => {
              void refreshAll();
            }}
          />
        )}
      </main>

      {showUpgradeModal && (
        <UpgradeModal
          lang={lang}
          userEmail={fbUser?.email || boot.user.email}
          userPhone={fbUser?.phoneNumber || boot.user.phoneNumber}
          userName={fbUser?.displayName || boot.user.displayName}
          currentPlanTier={boot.user.planTier}
          isTestBillingMode={boot.user.isTestBillingMode}
          onClose={() => setShowUpgradeModal(false)}
          onSuccess={() => refreshAll().then(() => {})}
        />
      )}

      {showAuthModal && (
        <AuthModal
          lang={lang}
          fbUser={fbUser}
          onClose={() => setShowAuthModal(false)}
          onAuthenticated={handleAuthenticated}
          onSignedOut={handleSignOut}
        />
      )}
    </div>
  );
};
