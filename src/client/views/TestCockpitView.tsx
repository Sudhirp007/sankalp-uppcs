import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Globe2,
  Layers,
  Plus,
  Scissors,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { api, type TestSessionDetailResponse } from "../lib/api";
import { UI_COPY, type LangCode } from "../lib/i18n";

interface LocalResponseState {
  selectedOption: string | null;
  eliminatedOptions: string[];
  confidenceTag: "SURE" | "GUESS_50_50" | "WILD_GUESS";
  isMarkedReview: boolean;
  timeSpentSec: number;
}

interface TestCockpitViewProps {
  lang: LangCode;
  detail: TestSessionDetailResponse;
  submitting: boolean;
  onToggleLanguage: () => Promise<void>;
  onSubmitPaper: (payload: {
    elapsedSec: number;
    responses: Array<{
      questionId: string;
      selectedOption: string | null;
      eliminatedOptions: string[];
      confidenceTag: "SURE" | "GUESS_50_50" | "WILD_GUESS";
      isMarkedReview: boolean;
      timeSpentSec: number;
    }>;
  }) => Promise<void>;
  onExitToDashboard: () => void;
  onOpenCheatSheet: (artifactId: string) => void;
  onOpenMistakeDeck: () => void;
  onFlashcardCreated?: () => void;
}

export const TestCockpitView: React.FC<TestCockpitViewProps> = ({
  lang,
  detail,
  submitting,
  onToggleLanguage,
  onSubmitPaper,
  onExitToDashboard,
  onOpenCheatSheet,
  onOpenMistakeDeck,
  onFlashcardCreated,
}) => {
  const t = UI_COPY[lang];
  const { session, items } = detail;
  const isSubmitted = session.status === "SUBMITTED";

  const [currentIdx, setCurrentIdx] = useState(0);
  const [omrFilter, setOmrFilter] = useState<"ALL" | "REVIEW" | "UNANSWERED" | "WRONG">("ALL");
  const [savedCardIds, setSavedCardIds] = useState<Record<string, boolean>>({});
  const [savingCard, setSavingCard] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(session.elapsedSec || 0);
  const [responses, setResponses] = useState<Record<string, LocalResponseState>>(() => {
    const map: Record<string, LocalResponseState> = {};
    for (const item of items) {
      map[item.questionId] = {
        selectedOption: item.selectedOption,
        eliminatedOptions: item.eliminatedOptions || [],
        confidenceTag: item.confidenceTag || "SURE",
        isMarkedReview: Boolean(item.isMarkedReview),
        timeSpentSec: item.timeSpentSec || 0,
      };
    }
    return map;
  });

  // Sync local state if session reloads (e.g., after submit or language toggle)
  useEffect(() => {
    setResponses((prev) => {
      const next: Record<string, LocalResponseState> = {};
      for (const item of items) {
        next[item.questionId] = prev[item.questionId] || {
          selectedOption: item.selectedOption,
          eliminatedOptions: item.eliminatedOptions || [],
          confidenceTag: item.confidenceTag || "SURE",
          isMarkedReview: Boolean(item.isMarkedReview),
          timeSpentSec: item.timeSpentSec || 0,
        };
      }
      return next;
    });
  }, [session.id, session.status]);

  const currentItem = items[currentIdx] || items[0]!;
  const curState = responses[currentItem.questionId] || {
    selectedOption: null,
    eliminatedOptions: [],
    confidenceTag: "SURE",
    isMarkedReview: false,
    timeSpentSec: 0,
  };

  // Live Countdown & Per-Question Pacing Timer while IN_PROGRESS
  useEffect(() => {
    if (isSubmitted) return;
    const timer = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
      setResponses((prev) => {
        const cur = prev[currentItem.questionId];
        if (!cur) return prev;
        return {
          ...prev,
          [currentItem.questionId]: { ...cur, timeSpentSec: cur.timeSpentSec + 1 },
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isSubmitted, currentItem.questionId]);

  const selectOption = (optKey: string) => {
    if (isSubmitted) return;
    setResponses((prev) => {
      const cur = prev[currentItem.questionId]!;
      if (cur.eliminatedOptions.includes(optKey)) return prev;
      return {
        ...prev,
        [currentItem.questionId]: {
          ...cur,
          selectedOption: cur.selectedOption === optKey ? null : optKey,
        },
      };
    });
  };

  const toggleEliminate = (optKey: string) => {
    if (isSubmitted) return;
    setResponses((prev) => {
      const cur = prev[currentItem.questionId]!;
      const exists = cur.eliminatedOptions.includes(optKey);
      const nextElim = exists
        ? cur.eliminatedOptions.filter((k) => k !== optKey)
        : [...cur.eliminatedOptions, optKey];
      const autoConfidence =
        nextElim.length >= 2 && cur.confidenceTag === "SURE" ? "GUESS_50_50" : cur.confidenceTag;
      return {
        ...prev,
        [currentItem.questionId]: {
          ...cur,
          eliminatedOptions: nextElim,
          selectedOption: cur.selectedOption === optKey ? null : cur.selectedOption,
          confidenceTag: autoConfidence,
        },
      };
    });
  };

  const setConfidence = (tag: "SURE" | "GUESS_50_50" | "WILD_GUESS") => {
    if (isSubmitted) return;
    setResponses((prev) => ({
      ...prev,
      [currentItem.questionId]: { ...prev[currentItem.questionId]!, confidenceTag: tag },
    }));
  };

  const toggleReviewMark = () => {
    if (isSubmitted) return;
    setResponses((prev) => {
      const cur = prev[currentItem.questionId]!;
      return {
        ...prev,
        [currentItem.questionId]: { ...cur, isMarkedReview: !cur.isMarkedReview },
      };
    });
  };

  // Keyboard shortcuts: A-D select, R mark review, ArrowLeft / ArrowRight navigate
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const upper = e.key.toUpperCase();
      if (!isSubmitted && ["A", "B", "C", "D"].includes(upper)) {
        selectOption(upper);
      } else if (!isSubmitted && upper === "R") {
        toggleReviewMark();
      } else if (e.key === "ArrowRight" && currentIdx < items.length - 1) {
        setCurrentIdx((i) => i + 1);
      } else if (e.key === "ArrowLeft" && currentIdx > 0) {
        setCurrentIdx((i) => i - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentIdx, items.length, isSubmitted, currentItem.questionId]);

  const remainingSec = Math.max(0, session.durationSec - elapsedSec);
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, "0");
  const ss = String(remainingSec % 60).padStart(2, "0");

  const paletteCounts = useMemo(() => {
    let answered = 0;
    let marked = 0;
    let wrong = 0;
    for (const it of items) {
      const r = responses[it.questionId];
      if (r?.selectedOption) answered++;
      if (r?.isMarkedReview || it.isMarkedReview) marked++;
      if (isSubmitted && it.isCorrect === false) wrong++;
    }
    return { answered, marked, wrong, unanswered: items.length - answered };
  }, [items, responses, isSubmitted]);

  const handleSaveQuestionAsFlashcard = async () => {
    if (savedCardIds[currentItem.questionId] || savingCard) return;
    setSavingCard(true);
    try {
      const correctChoice = currentItem.options.find((o) => o.key === currentItem.correctOption);
      const backAnswer = correctChoice
        ? `(${correctChoice.key}) ${correctChoice.text}${
            currentItem.explanation ? ` — ${currentItem.explanation.slice(0, 220)}` : ""
          }`
        : currentItem.explanation || "Refer to official answer key";

      await api.createPersonalFlashcard({
        topicId: currentItem.topicId,
        sourceQuestionId: currentItem.questionId,
        front: currentItem.stem,
        back: backAnswer,
        mnemonic: currentItem.goldenRule || undefined,
        originContext: `Saved from ${session.title} (Q.${currentItem.displayOrder})`,
      });
      setSavedCardIds((prev) => ({ ...prev, [currentItem.questionId]: true }));
      onFlashcardCreated?.();
    } finally {
      setSavingCard(false);
    }
  };

  const handleFinalSubmit = async () => {
    await onSubmitPaper({
      elapsedSec,
      responses: items.map((it) => {
        const r = responses[it.questionId]!;
        return {
          questionId: it.questionId,
          selectedOption: r.selectedOption,
          eliminatedOptions: r.eliminatedOptions,
          confidenceTag: r.confidenceTag,
          isMarkedReview: r.isMarkedReview,
          timeSpentSec: r.timeSpentSec,
        };
      }),
    });
  };

  const showSolutionCard = isSubmitted || (session.mode === "TUTOR" && Boolean(curState.selectedOption));

  return (
    <div className={`min-h-screen bg-[#F8FAFC] flex flex-col ${lang === "HI" ? "lang-hi" : ""}`}>
      {/* Distraction-Free Top Exam Header */}
      <header className="sticky top-0 z-30 bg-slate-900 text-white px-4 lg:px-6 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExitToDashboard}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t.backToDashboard}
          </button>
          <div>
            <div className="font-bold text-sm text-white">{session.title}</div>
            <div className="text-[11px] text-slate-400 font-mono-metric">
              +{session.positiveMarks.toFixed(2)} / -{session.negativePenalty.toFixed(2)} Marking •{" "}
              {items.length} Qs
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Single-Language Medium Instant Switcher */}
          <button
            type="button"
            onClick={onToggleLanguage}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/20 border border-indigo-400/30 hover:bg-indigo-500/30 px-3 py-1.5 text-xs font-semibold text-indigo-100 transition cursor-pointer"
          >
            <Globe2 className="w-3.5 h-3.5" />
            {t.mediumLabel}
          </button>

          {!isSubmitted ? (
            <>
              <div
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono-metric text-sm font-bold ${
                  remainingSec < 180 ? "bg-rose-600 text-white" : "bg-slate-800 text-emerald-400"
                }`}
              >
                <Clock className="w-4 h-4" />
                {mm}:{ss}
              </div>

              <button
                type="button"
                disabled={submitting}
                onClick={handleFinalSubmit}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-1.5 text-xs shadow-xs transition disabled:opacity-60 cursor-pointer"
              >
                {submitting ? "..." : t.submitPaper}
              </button>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 py-1 text-xs font-bold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {lang === "HI" ? "आयोग ग्रेडिंग पूर्ण" : "Commission Graded"}
            </span>
          )}
        </div>
      </header>

      {/* Post-Test Commission Scorecard & Guesswork Audit Banner (Screen 6) */}
      {isSubmitted && (
        <div className="bg-white border-b border-slate-200 px-4 lg:px-8 py-4">
          <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-3">
              <div className="text-[11px] font-semibold text-[#1E3A8A]">
                {lang === "HI" ? "शुद्ध प्राप्तांक (Net Marks)" : "Commission Net Marks"}
              </div>
              <div className="font-mono-metric text-xl font-extrabold text-slate-900 mt-0.5">
                {session.netMarks} <span className="text-xs text-slate-500">/ {session.maxMarks}</span>
              </div>
            </div>

            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
              <div className="text-[11px] font-semibold text-emerald-800">
                {lang === "HI" ? "सही उत्तर (+अंक)" : "Correct (+Gross)"}
              </div>
              <div className="font-mono-metric text-xl font-extrabold text-emerald-700 mt-0.5">
                {session.correctCount} <span className="text-xs">(+{session.grossMarks})</span>
              </div>
            </div>

            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3">
              <div className="text-[11px] font-semibold text-rose-800">
                {lang === "HI" ? "गलत उत्तर (-दंड)" : "Wrong (-1/3 Penalty)"}
              </div>
              <div className="font-mono-metric text-xl font-extrabold text-rose-700 mt-0.5">
                {session.wrongCount} <span className="text-xs">(-{session.negativeMarks})</span>
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
              <div className="text-[11px] font-semibold text-amber-900">
                {lang === "HI" ? "50-50 एलिमिनेशन शुद्ध लाभ" : "50-50 Elimination Net Gain"}
              </div>
              <div className="font-mono-metric text-xl font-extrabold text-amber-900 mt-0.5">
                {session.guess5050NetGain >= 0
                  ? `+${session.guess5050NetGain}`
                  : session.guess5050NetGain}{" "}
                <span className="text-xs font-sans">marks</span>
              </div>
            </div>

            <div className="rounded-xl bg-slate-900 text-white p-3 flex flex-col justify-between">
              <div className="text-[11px] text-slate-300">
                {lang === "HI" ? "त्रुटि फ्लैशकार्ड डेक तैयार" : "Mistakes Queued to SRS"}
              </div>
              <button
                type="button"
                onClick={onOpenMistakeDeck}
                className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-amber-300 hover:underline cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5" />
                {lang === "HI" ? "मिस्टेक फ्लैशकार्ड्स खोलें →" : "Practice Mistake Deck →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3-Column Cockpit Body */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-6 py-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column (3 cols): Question Provenance & Shortcuts */}
        <aside className="lg:col-span-3 space-y-4 order-2 lg:order-1">
          <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {lang === "HI" ? "प्रश्न मेटाडेटा" : "Question Context"}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-[#1E3A8A]">
                {currentItem.subject}
              </span>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                {currentItem.questionOrigin}
              </span>
              <span className="text-xs font-mono-metric px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-900">
                {currentItem.difficulty}
              </span>
            </div>
            <div className="text-xs text-slate-500 font-mono-metric pt-1 border-t border-slate-100">
              {lang === "HI" ? "इस प्रश्न पर समय:" : "Time on Question:"} {curState.timeSpentSec}s
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2 text-xs text-slate-600">
            <div className="font-bold text-slate-800">
              {lang === "HI" ? "कीबोर्ड शॉर्टकट्स" : "Cockpit Shortcuts"}
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-slate-100 rounded font-mono-metric">A–D</kbd>{" "}
              {lang === "HI" ? "विकल्प चुनें" : "Select Option"}
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-slate-100 rounded font-mono-metric">Alt+Click</kbd>{" "}
              {lang === "HI" ? "विकल्प काटें (50-50)" : "50-50 Strikethrough"}
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-slate-100 rounded font-mono-metric">R</kbd>{" "}
              {lang === "HI" ? "पुनर्विचार चिह्न" : "Mark for Review"}
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-slate-100 rounded font-mono-metric">← / →</kbd>{" "}
              {lang === "HI" ? "पिछला / अगला प्रश्न" : "Prev / Next Question"}
            </div>
          </div>
        </aside>

        {/* Center Column (6 cols): Single-Language Stem, Options, Confidence & Deep Review */}
        <main className="lg:col-span-6 space-y-4 order-1 lg:order-2">
          <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-6 space-y-5">
            {/* Question Number & Mark Review Pill */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <span className="font-mono-metric text-sm font-extrabold text-[#1E3A8A]">
                {lang === "HI"
                  ? `प्रश्न ${currentItem.displayOrder} / ${items.length}`
                  : `Question ${currentItem.displayOrder} of ${items.length}`}
              </span>
              {!isSubmitted ? (
                <button
                  type="button"
                  onClick={toggleReviewMark}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                    curState.isMarkedReview
                      ? "bg-purple-100 text-purple-800"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  {curState.isMarkedReview ? t.markedForReview : t.markForReview}
                </button>
              ) : (
                (curState.isMarkedReview || currentItem.isMarkedReview) && (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-purple-100 text-purple-800 px-2.5 py-1 text-xs font-bold">
                    <Bookmark className="w-3.5 h-3.5" />
                    {lang === "HI" ? "परीक्षा के दौरान चिह्नित" : "Marked for Review in Test"}
                  </span>
                )
              )}
            </div>

            {/* Strictly Single-Language Question Stem */}
            <div className="text-base font-medium text-slate-900 whitespace-pre-line leading-relaxed">
              {currentItem.stem}
            </div>

            {/* Options with 50-50 Strikethrough Support */}
            <div className="space-y-2.5">
              {currentItem.options.map((opt) => {
                const isSelected = curState.selectedOption === opt.key;
                const isEliminated = curState.eliminatedOptions.includes(opt.key);
                const isCorrectChoice = showSolutionCard && currentItem.correctOption === opt.key;
                const isWrongSelected =
                  showSolutionCard && isSelected && currentItem.correctOption !== opt.key;

                let cardStyle = "border-slate-200 hover:border-slate-300 bg-white";
                if (isCorrectChoice) {
                  cardStyle = "border-emerald-500 bg-emerald-50/70";
                } else if (isWrongSelected) {
                  cardStyle = "border-rose-500 bg-rose-50/70";
                } else if (isSelected) {
                  cardStyle = "border-[#1E3A8A] bg-indigo-50/60 ring-1 ring-[#1E3A8A]";
                } else if (isEliminated) {
                  cardStyle = "border-slate-200 bg-slate-50 opacity-55";
                }

                return (
                  <div
                    key={opt.key}
                    onClick={(e) => {
                      if (e.altKey) {
                        toggleEliminate(opt.key);
                      } else {
                        selectOption(opt.key);
                      }
                    }}
                    className={`rounded-xl border-2 p-3.5 flex items-start justify-between gap-3 transition ${
                      isSubmitted ? "cursor-default" : "cursor-pointer"
                    } ${cardStyle}`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`font-mono-metric w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                          isCorrectChoice
                            ? "bg-emerald-600 text-white"
                            : isWrongSelected
                              ? "bg-rose-600 text-white"
                              : isSelected
                                ? "bg-[#1E3A8A] text-white"
                                : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {opt.key}
                      </span>
                      <span
                        className={`text-sm text-slate-800 pt-0.5 ${
                          isEliminated && !isSelected ? "line-through text-slate-400" : ""
                        }`}
                      >
                        {opt.text}
                      </span>
                    </div>

                    {!isSubmitted && (
                      <button
                        type="button"
                        title="50-50 Eliminate Option"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleEliminate(opt.key);
                        }}
                        className={`p-1.5 rounded-lg transition shrink-0 cursor-pointer ${
                          isEliminated
                            ? "bg-amber-100 text-amber-900"
                            : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        }`}
                      >
                        <Scissors className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {showSolutionCard && isCorrectChoice && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    )}
                    {showSolutionCard && isWrongSelected && (
                      <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Confidence Tagging Bar (Calibration for 50-50 Guesswork ROI) */}
            {!isSubmitted && (
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div className="text-[11px] text-slate-500">{t.eliminateHint}</div>
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      { key: "SURE", label: t.sure100 },
                      { key: "GUESS_50_50", label: t.guess5050 },
                      { key: "WILD_GUESS", label: t.wildGuess },
                    ] as const
                  ).map((cTag) => (
                    <button
                      key={cTag.key}
                      type="button"
                      onClick={() => setConfidence(cTag.key)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition cursor-pointer ${
                        curState.confidenceTag === cTag.key
                          ? "border-[#1E3A8A] bg-indigo-50 text-[#1E3A8A]"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {cTag.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Navigation Footer */}
            <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t.prevQuestion}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (currentIdx < items.length - 1) {
                    setCurrentIdx((i) => i + 1);
                  } else if (!isSubmitted) {
                    handleFinalSubmit();
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white px-5 py-2 text-xs font-bold transition cursor-pointer"
              >
                {currentIdx < items.length - 1
                  ? t.saveNext
                  : isSubmitted
                    ? t.backToDashboard
                    : t.submitPaper}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Post-Submit / Tutor Deep Review & Provenance Panel (Screen 6) */}
          {showSolutionCard && (
            <div className="rounded-2xl bg-white border border-indigo-200 shadow-xs p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-bold text-emerald-800">
                  <ShieldCheck className="w-4 h-4" />
                  {currentItem.sourceKeyType === "OFFICIAL_FINAL"
                    ? lang === "HI"
                      ? "सत्यापित: आयोग अंतिम उत्तर कुंजी (Official Final Key)"
                      : "Verified: Official Final Commission Answer Key"
                    : lang === "HI"
                      ? `मानक संदर्भ व्याख्या (विश्वसनीयता ${Math.round((currentItem.confidenceScore ?? 0.96) * 100)}%)`
                      : `Standard Reference Verified (${Math.round((currentItem.confidenceScore ?? 0.96) * 100)}% Confidence)`}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={savingCard || Boolean(savedCardIds[currentItem.questionId])}
                    onClick={handleSaveQuestionAsFlashcard}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                      savedCardIds[currentItem.questionId]
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200"
                    }`}
                  >
                    {savedCardIds[currentItem.questionId] ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        {lang === "HI" ? "मेरे फ्लैशकार्ड्स में सहेजा गया" : "Saved to My Flashcards"}
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        {savingCard
                          ? "..."
                          : lang === "HI"
                            ? "फ्लैशकार्ड बनाएं"
                            : "Save to My Flashcards"}
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenCheatSheet(currentItem.linkedArtifactId)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-[#1E3A8A] px-3 py-1.5 text-xs font-bold transition cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    {t.openCheatSheet}
                  </button>
                </div>
              </div>

              {currentItem.goldenRule && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-900 uppercase tracking-wide mb-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    {lang === "HI" ? "गोल्डन रूल (स्मृति सूत्र)" : "Golden Rule Memory Anchor"}
                  </div>
                  <p className="text-xs font-semibold text-amber-950">{currentItem.goldenRule}</p>
                </div>
              )}

              {currentItem.explanation && (
                <div className="text-sm text-slate-700 leading-relaxed">
                  {currentItem.explanation}
                </div>
              )}

              {currentItem.repeatedIn && currentItem.repeatedIn.length > 0 && (
                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">
                    {lang === "HI" ? "पुनरावृत्ति इतिहास:" : "Repeated PYQ Lineage:"}
                  </span>
                  {currentItem.repeatedIn.map((rep, idx) => (
                    <span
                      key={idx}
                      className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700"
                    >
                      {rep}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>

        {/* Right Column (3 cols): OMR Question Palette */}
        <aside className="lg:col-span-3 order-3">
          <div className="sticky top-20 rounded-2xl bg-white border border-slate-200 p-4 space-y-4">
            <div className="font-bold text-sm text-slate-900">
              {lang === "HI" ? "ओएमआर प्रश्न पैलेट (OMR)" : "OMR Question Palette"}
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
              <div className="rounded-lg bg-emerald-50 text-emerald-800 p-1.5 font-semibold">
                <div className="font-mono-metric text-sm font-bold">{paletteCounts.answered}</div>
                {lang === "HI" ? "हल किए" : "Answered"}
              </div>
              <div className="rounded-lg bg-purple-50 text-purple-800 p-1.5 font-semibold">
                <div className="font-mono-metric text-sm font-bold">{paletteCounts.marked}</div>
                {lang === "HI" ? "चिह्नित" : "Review"}
              </div>
              <div className="rounded-lg bg-slate-100 text-slate-700 p-1.5 font-semibold">
                <div className="font-mono-metric text-sm font-bold">{paletteCounts.unanswered}</div>
                {lang === "HI" ? "शेष" : "Left"}
              </div>
            </div>

            {/* Quick OMR Filter Tabs (Jump directly to Review / Unanswered / Wrong) */}
            <div className="flex flex-wrap gap-1.5">
              {(isSubmitted
                ? [
                    { key: "ALL" as const, label: lang === "HI" ? "सभी" : "All" },
                    {
                      key: "WRONG" as const,
                      label: lang === "HI" ? `गलत (${paletteCounts.wrong})` : `Wrong (${paletteCounts.wrong})`,
                    },
                    {
                      key: "REVIEW" as const,
                      label: lang === "HI" ? `चिह्नित (${paletteCounts.marked})` : `Review (${paletteCounts.marked})`,
                    },
                  ]
                : [
                    { key: "ALL" as const, label: lang === "HI" ? "सभी" : "All" },
                    {
                      key: "REVIEW" as const,
                      label: lang === "HI" ? `चिह्नित (${paletteCounts.marked})` : `Review (${paletteCounts.marked})`,
                    },
                    {
                      key: "UNANSWERED" as const,
                      label: lang === "HI" ? `शेष (${paletteCounts.unanswered})` : `Left (${paletteCounts.unanswered})`,
                    },
                  ]
              ).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setOmrFilter(f.key)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                    omrFilter === f.key
                      ? "bg-[#1E3A8A] text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-5 gap-2">
              {items.map((it, idx) => {
                const r = responses[it.questionId];
                const isMarked = Boolean(r?.isMarkedReview || it.isMarkedReview);
                const isAnswered = Boolean(r?.selectedOption);

                if (omrFilter === "REVIEW" && !isMarked) return null;
                if (omrFilter === "UNANSWERED" && isAnswered) return null;
                if (omrFilter === "WRONG" && it.isCorrect !== false) return null;

                let btnColor = "bg-slate-100 text-slate-700 border-slate-200";
                if (isSubmitted) {
                  if (it.isCorrect === true) btnColor = "bg-emerald-600 text-white border-emerald-600";
                  else if (it.isCorrect === false) btnColor = "bg-rose-600 text-white border-rose-600";
                } else if (isMarked) {
                  btnColor = "bg-purple-600 text-white border-purple-600";
                } else if (isAnswered) {
                  btnColor = "bg-[#1E3A8A] text-white border-[#1E3A8A]";
                }

                return (
                  <button
                    key={it.questionId}
                    type="button"
                    onClick={() => setCurrentIdx(idx)}
                    className={`relative font-mono-metric h-9 rounded-lg border text-xs font-bold transition cursor-pointer ${btnColor} ${
                      currentIdx === idx ? "ring-2 ring-offset-1 ring-amber-500" : ""
                    }`}
                  >
                    {it.displayOrder}
                    {/* Distinct indicator for Answered + Marked for Review (evaluated per UPPSC rule) */}
                    {!isSubmitted && isMarked && isAnswered && (
                      <span
                        title="Answered & Marked for Review (Evaluated on Submit)"
                        className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white"
                      />
                    )}
                    {isSubmitted && isMarked && (
                      <span
                        title="Was Marked for Review"
                        className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-purple-400 border border-white"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="text-[11px] text-slate-500 leading-snug pt-2 border-t border-slate-100">
              {lang === "HI"
                ? "नियम: 'चिह्नित + उत्तर चयनित' का मूल्यांकन होगा; केवल 'चिह्नित (बिना उत्तर)' पर 0 अंक।"
                : "UPPSC Rule: Answered + Review (green dot) IS graded; Unanswered + Review = 0 marks."}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
