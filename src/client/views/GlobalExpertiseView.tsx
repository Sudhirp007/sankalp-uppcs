import React from "react";
import {
  Award,
  BarChart3,
  BrainCircuit,
  Compass,
  Play,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import type { GlobalExpertiseResponse } from "../lib/api";
import type { LangCode } from "../lib/i18n";

interface GlobalExpertiseViewProps {
  lang: LangCode;
  data: GlobalExpertiseResponse;
  onSwitchExamJourney: (examId: string) => void;
  onStartFormatDrill: (questionFormat: string) => void;
  onOpenSetup?: () => void;
}

export const GlobalExpertiseView: React.FC<GlobalExpertiseViewProps> = ({
  lang,
  data,
  onSwitchExamJourney,
  onStartFormatDrill,
  onOpenSetup,
}) => {
  const isUnpracticed = data.totalQuestionsAttempted === 0;

  if (!data.hasEnrolledExams) {
    return (
      <div
        className={`rounded-3xl bg-white border border-slate-200 shadow-xs p-8 sm:p-12 text-center max-w-2xl mx-auto space-y-4 ${
          lang === "HI" ? "lang-hi" : ""
        }`}
      >
        <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-[#1E3A8A] flex items-center justify-center mx-auto">
          <Compass className="w-6 h-6" />
        </div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">
          {lang === "HI"
            ? "समग्र दक्षता (Global Expertise) अभी खाली है"
            : "Global Expertise Is Empty — Choose Exams & Start Practicing"}
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          {lang === "HI"
            ? "आपकी समग्र दक्षता केवल आपके द्वारा चुनी गई परीक्षाओं और हल किए गए प्रश्नों के आधार पर बनती है।"
            : "Your Cross-Exam Readiness, Question-Format Diagnostics, and Subject ELO populate strictly from the exams you select and the questions you solve."}
        </p>
        {onOpenSetup && (
          <button
            type="button"
            onClick={onOpenSetup}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white font-bold px-6 py-3 text-sm cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>
              {lang === "HI"
                ? "लक्षित परीक्षाएं चुनें →"
                : "Select Target Exam Journeys →"}
            </span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${lang === "HI" ? "lang-hi" : ""}`}>
      {/* Header Banner */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 text-[#1E3A8A] px-3 py-0.5 text-xs font-bold mb-2">
            <Compass className="w-3.5 h-3.5" />
            {lang === "HI"
              ? "समग्र आयोग दक्षता पोर्टफोलियो (Cross-Exam Radar)"
              : "Unified Cross-Exam Expertise Radar"}
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            {lang === "HI"
              ? "आपकी चयनित परीक्षाओं में वास्तविक दक्षता"
              : "Where You Stand Across Your Selected Exam Journeys"}
          </h1>
          <p className="text-xs text-slate-600 mt-1 max-w-2xl">
            {lang === "HI"
              ? "आपका विषय-स्तरीय ज्ञान केवल आपके द्वारा हल किए गए प्रश्नों से मापा जाता है और प्रत्येक चयनित परीक्षा के आधिकारिक पाठ्यक्रम पर प्रोजेक्ट किया जाता है।"
              : "Populated strictly from the exams you selected and the questions you solve — never pre-filled with synthetic scores."}
          </p>
        </div>

        <div className="rounded-2xl bg-slate-900 text-white px-5 py-3.5 text-center shrink-0">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
            {lang === "HI" ? "समग्र विषय दक्षता सूचकांक" : "Global GS Mastery Index"}
          </div>
          <div className="font-mono-metric text-3xl font-extrabold text-emerald-400 mt-0.5">
            {data.overallPortfolioElo}
            <span className="text-sm text-slate-400 font-normal"> / 100</span>
          </div>
        </div>
      </div>

      {/* Selected Exam Readiness Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {data.examRanking.map((ex, idx) => {
          const badgeStyle =
            ex.statusTier === "STRONGHOLD"
              ? "bg-emerald-100 text-emerald-800 border-emerald-200"
              : ex.statusTier === "DEVELOPING"
                ? "bg-indigo-100 text-[#1E3A8A] border-indigo-200"
                : ex.statusTier === "NOT_STARTED"
                  ? "bg-slate-100 text-slate-700 border-slate-200"
                  : "bg-amber-100 text-amber-900 border-amber-200";

          return (
            <div
              key={ex.examId}
              className="rounded-2xl bg-white border border-slate-200 shadow-xs p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${badgeStyle}`}
                  >
                    #{idx + 1} • {ex.statusTier === "NOT_STARTED" ? "NOT STARTED" : ex.statusTier}
                  </span>
                  <span className="font-mono-metric text-xs text-slate-500">
                    +{ex.positiveMarks.toFixed(2)}/-{ex.negativeMarks.toFixed(2)}
                  </span>
                </div>

                <h3 className="font-bold text-base text-slate-900">{ex.shortName}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{ex.targetCycleLabel}</p>

                <div className="mt-4 flex items-baseline justify-between">
                  <div>
                    <span className="font-mono-metric text-3xl font-extrabold text-slate-900">
                      {ex.readinessScore}%
                    </span>
                    <span className="text-xs text-slate-500 ml-1">
                      {lang === "HI" ? "तत्परता" : "Readiness"}
                    </span>
                  </div>
                  <span
                    className={`font-mono-metric text-xs font-bold ${
                      !ex.hasActivity
                        ? "text-slate-400"
                        : ex.cutoffMargin >= 0
                          ? "text-emerald-700"
                          : "text-rose-700"
                    }`}
                  >
                    {!ex.hasActivity
                      ? lang === "HI"
                        ? "0 प्रश्न हल"
                        : "0 Qs solved"
                      : `${ex.cutoffMargin >= 0 ? `+${ex.cutoffMargin}` : ex.cutoffMargin} ${
                          lang === "HI" ? "कटऑफ से" : "vs Cutoff"
                        }`}
                  </span>
                </div>

                <div className="mt-2 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      ex.statusTier === "STRONGHOLD"
                        ? "bg-emerald-600"
                        : ex.statusTier === "DEVELOPING"
                          ? "bg-[#1E3A8A]"
                          : ex.statusTier === "NOT_STARTED"
                            ? "bg-slate-300"
                            : "bg-amber-600"
                    }`}
                    style={{ width: `${ex.readinessScore}%` }}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => onSwitchExamJourney(ex.examId)}
                className="mt-5 w-full rounded-xl border border-slate-300 hover:border-[#1E3A8A] hover:bg-indigo-50/50 text-slate-800 hover:text-[#1E3A8A] font-semibold py-2 text-xs transition cursor-pointer"
              >
                {lang === "HI" ? "इस परीक्षा यात्रा पर जाएं →" : "Switch to Exam Journey →"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Empty Diagnostic State Until Questions Are Solved vs Live Populated Diagnostics */}
      {isUnpracticed ? (
        <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-8 text-center space-y-3">
          <div className="text-base font-extrabold text-slate-900">
            {lang === "HI"
              ? "अभी तक कोई टेस्ट या अभ्यास प्रश्न हल नहीं किया गया है"
              : "No Questions Solved Yet — Diagnostics & Subject ELO Start Empty"}
          </div>
          <p className="text-xs sm:text-sm text-slate-600 max-w-xl mx-auto">
            {lang === "HI"
              ? "जैसे ही आप प्रश्न हल करेंगे, कथन-आधारित/सुमेलन प्रश्न निदान और विषयवार ELO स्कोर स्वतः यहाँ दिखने लगेंगे।"
              : "Solve your first 10-question format drill below (or a 15-Min Smart Drill on Journey Home) to populate real accuracy, speed, and Unified Subject Mastery."}
          </p>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => onStartFormatDrill("SINGLE_CHOICE")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white font-bold px-5 py-2.5 text-xs cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>
                {lang === "HI"
                  ? "पहला 10-प्रश्न अभ्यास शुरू करें →"
                  : "Start First 10-Question Practice Drill →"}
              </span>
            </button>
            {onOpenSetup && (
              <button
                type="button"
                onClick={onOpenSetup}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold px-4 py-2.5 text-xs cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>{lang === "HI" ? "चयनित परीक्षाएं बदलें" : "Edit Selected Exams"}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 shadow-xs p-6">
            <div className="flex items-center gap-2 mb-1">
              <BrainCircuit className="w-4 h-4 text-[#1E3A8A]" />
              <h2 className="font-bold text-base text-slate-900">
                {lang === "HI"
                  ? "प्रश्न-प्रारूप संज्ञानात्मक निदान (Question-Pattern Skill)"
                  : "Cognitive Question-Format Diagnostic"}
              </h2>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              {lang === "HI"
                ? "पहचानें कि किस प्रकार के प्रश्न आपके नकारात्मक अंकन का कारण बन रहे हैं।"
                : "Pinpoints whether factual gaps or tricky UPPSC question formats (Assertion-Reason, Multi-Statement) cause negative marks."}
            </p>

            <div className="space-y-3">
              {data.formatDiagnostics.map((fmt) => {
                const pillClass =
                  fmt.tone === "EMERALD"
                    ? "bg-emerald-100 text-emerald-800"
                    : fmt.tone === "AMBER"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-rose-100 text-rose-800";

                return (
                  <div
                    key={fmt.format}
                    className="rounded-xl border border-slate-200 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">{fmt.label}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${pillClass}`}>
                          {fmt.badge}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 flex items-center gap-3 font-mono-metric">
                        <span>Attempted: {fmt.attemptedCount ?? 0}</span>
                        <span>•</span>
                        <span>Accuracy: {fmt.accuracyPct}%</span>
                        <span>•</span>
                        <span>Avg Time: {fmt.avgTimeSec}s</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onStartFormatDrill(fmt.format)}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-[#1E3A8A] font-semibold px-3 py-1.5 text-xs transition cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      {lang === "HI" ? "प्रारूप अभ्यास" : "Drill Format"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Unified Global Subject ELO Table */}
          <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 shadow-xs p-6">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-[#1E3A8A]" />
              <h2 className="font-bold text-base text-slate-900">
                {lang === "HI" ? "एकीकृत विषय मास्टरी (Global ELO)" : "Unified Subject Mastery Ledger"}
              </h2>
            </div>

            <div className="divide-y divide-slate-100">
              {data.unifiedSubjectElo.map((row) => (
                <div key={row.domainId} className="py-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-xs text-slate-900">{row.name}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {row.attempts} {lang === "HI" ? "प्रश्न हल" : "attempted"} • SRS{" "}
                      {row.retentionPct}%
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {row.attempts > 0 && row.eloScore >= 75 ? (
                      <Award className="w-4 h-4 text-emerald-600" />
                    ) : row.attempts > 0 && row.eloScore < 50 ? (
                      <ShieldAlert className="w-4 h-4 text-rose-600" />
                    ) : null}
                    <span className="font-mono-metric text-sm font-bold text-slate-900">
                      {row.eloScore}/100
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
