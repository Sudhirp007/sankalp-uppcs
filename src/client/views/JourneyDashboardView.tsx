import React from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileText,
  Flame,
  Play,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import type { JourneyDashboardResponse } from "../lib/api";
import { UI_COPY, type LangCode } from "../lib/i18n";

interface JourneyDashboardViewProps {
  lang: LangCode;
  data: JourneyDashboardResponse;
  startingSession: boolean;
  onStartSmartDrill: () => void;
  onStartPaper: (paperId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenCheatSheet: (artifactId: string) => void;
  onNavigateSyllabus: () => void;
}

export const JourneyDashboardView: React.FC<JourneyDashboardViewProps> = ({
  lang,
  data,
  startingSession,
  onStartSmartDrill,
  onStartPaper,
  onOpenSession,
  onOpenCheatSheet,
  onNavigateSyllabus,
}) => {
  const t = UI_COPY[lang];
  const { exam, subjectMastery, gapAlerts, papers, recentSessions } = data;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (Math.min(100, Math.max(0, exam.readinessScore)) / 100) * circumference;

  return (
    <div className={`space-y-6 ${lang === "HI" ? "lang-hi" : ""}`}>
      {/* Hero Row: Exam Readiness Gauge + Today's Adaptive Smart Drill */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Per-Exam Readiness Card */}
        <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 shadow-xs p-6 flex flex-col sm:flex-row items-center gap-6">
          <div className="relative w-36 h-36 shrink-0 flex items-center justify-center">
            <svg className="w-36 h-36 -rotate-90" viewBox="0 0 128 128">
              <circle
                cx="64"
                cy="64"
                r={radius}
                stroke="#E2E8F0"
                strokeWidth="11"
                fill="none"
              />
              <circle
                cx="64"
                cy="64"
                r={radius}
                stroke={exam.readinessScore >= 75 ? "#047857" : exam.readinessScore >= 62 ? "#1E3A8A" : "#B45309"}
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                fill="none"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-mono-metric text-3xl font-extrabold text-slate-900">
                {exam.readinessScore}%
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {exam.statusTier}
              </span>
            </div>
          </div>

          <div className="flex-1 space-y-3 text-center sm:text-left">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#1E3A8A] bg-indigo-50 px-2.5 py-0.5 rounded-full mb-1.5">
                <span>{exam.targetCycleLabel}</span>
                <span>•</span>
                <span>
                  {exam.daysRemaining} {lang === "HI" ? "दिन शेष" : "Days Left"}
                </span>
              </div>
              <h1 className="text-xl font-bold text-slate-900">{exam.name}</h1>
              <p className="text-xs text-slate-600 mt-1">{exam.description}</p>
            </div>

            <div className="grid grid-cols-3 gap-2.5 pt-1">
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-2.5">
                <div className="text-[11px] text-slate-500">{t.predictedScore}</div>
                <div className="font-mono-metric text-base font-bold text-slate-900">
                  {exam.predictedScore}
                  <span className="text-xs text-slate-400 font-normal">/{exam.maxMarks}</span>
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-2.5">
                <div className="text-[11px] text-slate-500">{t.cutoffTarget}</div>
                <div className="font-mono-metric text-base font-bold text-slate-900">
                  {exam.historicalCutoff}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-2.5">
                <div className="text-[11px] text-slate-500">
                  {lang === "HI" ? "कटऑफ अंतर" : "Cutoff Margin"}
                </div>
                <div
                  className={`font-mono-metric text-base font-bold ${
                    exam.cutoffMargin >= 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {exam.cutoffMargin >= 0 ? `+${exam.cutoffMargin}` : exam.cutoffMargin}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Adaptive Smart Drill Launcher */}
        <div className="lg:col-span-5 rounded-2xl bg-gradient-to-br from-[#1E3A8A] via-indigo-900 to-slate-900 text-white p-6 flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                <Flame className="w-3.5 h-3.5 text-amber-300" />
                {lang === "HI" ? "दैनिक अनुकूली अभ्यास" : "Daily Adaptive Prescription"}
              </span>
              <span className="font-mono-metric text-xs bg-white/10 px-2.5 py-1 rounded-md">
                +{exam.positiveMarks.toFixed(2)} / -{exam.negativeMarks.toFixed(2)}
              </span>
            </div>
            <h2 className="text-lg font-bold">
              {lang === "HI"
                ? `${exam.shortName}: उच्च-भारांक एवं कमज़ोर विषय ड्रिल`
                : `${exam.shortName}: High-Yield & Weak Micro-Topic Drill`}
            </h2>
            <p className="text-xs text-indigo-100/90 mt-1.5 leading-relaxed">
              {lang === "HI"
                ? "आयोग के पिछले वर्षों के प्रश्नों (PYQs) और अवधारणा प्रश्नों का मिश्रण, 50-50 एलिमिनेशन ऑडिट के साथ।"
                : "15 curated PYQs + Concept Builders weighted to this exam's official blueprint, with 50-50 elimination net-gain tracking."}
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={startingSession}
              onClick={onStartSmartDrill}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white text-[#1E3A8A] hover:bg-indigo-50 font-bold px-4 py-2.5 text-sm shadow-xs transition disabled:opacity-60 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              {startingSession ? "..." : t.startSmartDrill}
            </button>
            <button
              type="button"
              onClick={onNavigateSyllabus}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white font-semibold px-3.5 py-2.5 text-xs transition cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {t.customPractice}
            </button>
          </div>
        </div>
      </div>

      {/* Middle Row: Exam-Weighted Subject Mastery + Critical Gap Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Subject Mastery */}
        <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 shadow-xs p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#1E3A8A]" />
              <h2 className="font-bold text-base text-slate-900">{t.subjectMasteryTitle}</h2>
            </div>
            <span className="text-xs text-slate-500">
              {lang === "HI" ? "आयोग भारांक अनुसार क्रमबद्ध" : "Ordered by Exam Weightage"}
            </span>
          </div>

          <div className="space-y-3.5">
            {subjectMastery.map((sub) => {
              const barColor =
                sub.status === "MASTERED"
                  ? "bg-emerald-600"
                  : sub.status === "DEVELOPING"
                    ? "bg-[#1E3A8A]"
                    : "bg-amber-600";
              return (
                <div key={sub.domainId} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="font-semibold text-slate-800 flex items-center gap-2">
                      <span>{sub.name}</span>
                      <span className="font-mono-metric text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {sub.weightPct}% {lang === "HI" ? "भार" : "wt"}
                      </span>
                    </div>
                    <span className="font-mono-metric font-bold text-slate-900">{sub.masteryPct}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${Math.min(100, Math.max(8, sub.masteryPct))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Critical Gap Alerts -> Direct Cheat Sheet Remediation */}
        <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 shadow-xs p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <h2 className="font-bold text-base text-slate-900">{t.criticalGapsTitle}</h2>
            </div>

            <div className="space-y-3">
              {gapAlerts.map((gap) => (
                <div
                  key={gap.topicId}
                  className="rounded-xl border border-amber-200/80 bg-amber-50/40 p-3.5 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold text-amber-800 uppercase">
                        {gap.subject}
                      </div>
                      <div className="font-bold text-sm text-slate-900">{gap.name}</div>
                    </div>
                    <span className="font-mono-metric text-xs font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800 shrink-0">
                      {gap.accuracyPct}%
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-slate-600">
                      {lang === "HI"
                        ? `परीक्षा भारांक: ~${gap.weightPct}%`
                        : `Exam Weight: ~${gap.weightPct}%`}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenCheatSheet(gap.artifactId)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-[#1E3A8A] hover:underline cursor-pointer"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      {t.openCheatSheet}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row: Official Commission Past Papers & Recent Attempts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 shadow-xs p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#1E3A8A]" />
              <h2 className="font-bold text-base text-slate-900">{t.officialPapersTitle}</h2>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {papers.map((p) => (
              <div key={p.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-sm text-slate-900">{p.title}</div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                    {p.year && <span>{p.year}</span>}
                    <span>•</span>
                    <span>
                      {p.hasOfficialKey
                        ? lang === "HI"
                          ? "आधिकारिक अंतिम उत्तर कुंजी सत्यापित"
                          : "Official Final Commission Key"
                        : lang === "HI"
                          ? "मानक हल सहित"
                          : "Verified Solutions"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={startingSession}
                  onClick={() => onStartPaper(p.id)}
                  className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-[#1E3A8A] font-semibold px-3 py-1.5 text-xs transition cursor-pointer"
                >
                  {t.attemptPaper}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 shadow-xs p-6">
          <h2 className="font-bold text-base text-slate-900 mb-4">{t.recentSessionsTitle}</h2>
          {recentSessions.length === 0 ? (
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-5 text-center text-xs text-slate-500">
              {lang === "HI"
                ? "अभी तक कोई टेस्ट सबमिट नहीं किया गया है। ऊपर '15-मिनट स्मार्ट ड्रिल' से शुरुआत करें!"
                : "No test sessions submitted in this journey yet. Launch a 15-Min Smart Drill above to calibrate your cutoff score!"}
            </div>
          ) : (
            <div className="space-y-2.5">
              {recentSessions.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-semibold text-xs text-slate-900">{s.title}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="font-mono-metric font-semibold text-slate-800">
                        {s.netMarks}/{s.maxMarks}
                      </span>
                      <span>
                        (+{s.correctCount} / -{s.wrongCount})
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenSession(s.id)}
                    className="rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold px-2.5 py-1.5 text-xs transition cursor-pointer"
                  >
                    {t.reviewAttempt}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
