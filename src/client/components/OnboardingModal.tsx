import React, { useState } from "react";
import { CheckCircle2, Globe2, Sparkles, Target, Clock, X } from "lucide-react";
import type { ExamPortfolioCard } from "../lib/api";
import type { LangCode } from "../lib/i18n";

interface OnboardingModalProps {
  initialLang: LangCode;
  initialActiveExamId: string;
  initialDailyGoalMins: number;
  exams: ExamPortfolioCard[];
  onClose?: () => void;
  onSave: (payload: {
    preferredLanguage: LangCode;
    activeExamId: string;
    enrolledExamIds: string[];
    dailyGoalMins: number;
  }) => Promise<void>;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  initialLang,
  initialActiveExamId,
  initialDailyGoalMins,
  exams,
  onClose,
  onSave,
}) => {
  const [lang, setLang] = useState<LangCode>(initialLang);
  const [selectedExams, setSelectedExams] = useState<string[]>(() => {
    const enrolled = exams.filter((e) => e.isEnrolled).map((e) => e.examId);
    return enrolled.length > 0 ? enrolled : ["uppcs-prelims", "uppsc-ro-aro"];
  });
  const [primaryExam, setPrimaryExam] = useState<string>(initialActiveExamId || "uppcs-prelims");
  const [dailyMins, setDailyMins] = useState<number>(initialDailyGoalMins || 45);
  const [saving, setSaving] = useState(false);

  const toggleExam = (examId: string) => {
    setSelectedExams((prev) => {
      if (prev.includes(examId)) {
        if (prev.length === 1) return prev;
        const next = prev.filter((id) => id !== examId);
        if (primaryExam === examId) setPrimaryExam(next[0]!);
        return next;
      }
      return [...prev, examId];
    });
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const active = selectedExams.includes(primaryExam) ? primaryExam : selectedExams[0]!;
      await onSave({
        preferredLanguage: lang,
        activeExamId: active,
        enrolledExamIds: selectedExams,
        dailyGoalMins: dailyMins,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden my-6">
        <div className="bg-gradient-to-r from-[#1E3A8A] to-indigo-800 px-6 py-5 text-white flex items-start justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide uppercase mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              {lang === "HI" ? "व्यक्तिगत अध्ययन प्रोफ़ाइल" : "Personalized Study Architecture"}
            </div>
            <h2 className="text-xl font-bold">
              {lang === "HI"
                ? "अपना माध्यम एवं लक्ष्य परीक्षाएं चुनें"
                : "Configure Your Preferred Medium & Exam Journeys"}
            </h2>
            <p className="text-sm text-indigo-100 mt-1">
              {lang === "HI"
                ? "सभी प्रश्न, व्याख्या, चीट शीट और फ्लैशकार्ड केवल आपकी चुनी हुई एक ही भाषा में दिखेंगे।"
                : "Zero dual-language clutter: every question, explanation, cheat sheet, and flashcard renders strictly in your chosen medium."}
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-indigo-100 hover:bg-white/15 transition"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="p-6 space-y-6 max-h-[78vh] overflow-y-auto">
          {/* Step 1: Single-Language Medium Selection */}
          <section>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
              <Globe2 className="w-4 h-4 text-[#1E3A8A]" />
              <span>
                {lang === "HI"
                  ? "1. परीक्षा का माध्यम चुनें (कभी भी बदला जा सकता है)"
                  : "1. Select Preferred Study & Test Medium (Switchable Anytime)"}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setLang("EN")}
                className={`text-left rounded-xl border-2 p-4 transition ${
                  lang === "EN"
                    ? "border-[#1E3A8A] bg-indigo-50/60"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">English Medium</span>
                  {lang === "EN" && <CheckCircle2 className="w-5 h-5 text-[#1E3A8A]" />}
                </div>
                <p className="text-xs text-slate-600 mt-1.5">
                  Pure English stems, options, Laxmikanth/NCERT notes & active-recall cards.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setLang("HI")}
                className={`text-left rounded-xl border-2 p-4 transition ${
                  lang === "HI"
                    ? "border-[#1E3A8A] bg-indigo-50/60"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">हिन्दी माध्यम (Pure Devanagari)</span>
                  {lang === "HI" && <CheckCircle2 className="w-5 h-5 text-[#1E3A8A]" />}
                </div>
                <p className="text-xs text-slate-600 mt-1.5">
                  शुद्ध हिन्दी प्रश्न, विकल्प, आयोग शब्दावली, चीट शीट्स एवं मेमोरी ट्रिक्स।
                </p>
              </button>
            </div>

            {/* Live Single-Language Question Preview */}
            <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700">
              <span className="font-semibold text-[#1E3A8A] uppercase tracking-wider text-[11px] block mb-1">
                {lang === "HI" ? "लाइव एकल-भाषा पूर्वावलोकन:" : "Live Single-Language Preview:"}
              </span>
              {lang === "HI"
                ? "प्रश्न: अशोक मेहता समिति (1977) ने पंचायती राज संस्थाओं के लिए द्वि-स्तरीय प्रणाली की सिफारिश की थी..."
                : "Q: Which committee recommended replacing the 3-tier Panchayati Raj system with a 2-tier system in 1977?"}
            </div>
          </section>

          {/* Step 2: Target Exam Journeys */}
          <section>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
              <Target className="w-4 h-4 text-[#1E3A8A]" />
              <span>
                {lang === "HI"
                  ? "2. अपनी लक्षित परीक्षाएं चुनें (प्रत्येक परीक्षा की स्वतंत्र यात्रा + समग्र पोर्टफोलियो)"
                  : "2. Choose Target Exam Journeys (Separate Per-Exam Track + Global Expertise)"}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {exams.map((ex) => {
                const checked = selectedExams.includes(ex.examId);
                const isPrimary = primaryExam === ex.examId;
                return (
                  <div
                    key={ex.examId}
                    onClick={() => toggleExam(ex.examId)}
                    className={`cursor-pointer rounded-xl border-2 p-3.5 transition ${
                      checked
                        ? "border-[#1E3A8A] bg-indigo-50/40"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-sm text-slate-900">{ex.shortName}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{ex.targetCycleLabel}</div>
                      </div>
                      <span
                        className={`font-mono-metric text-[11px] px-2 py-0.5 rounded-md font-semibold ${
                          checked ? "bg-[#1E3A8A] text-white" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        +{ex.positiveMarks.toFixed(2)} / -{ex.negativeMarks.toFixed(2)}
                      </span>
                    </div>
                    {checked && (
                      <div className="mt-2.5 pt-2 border-t border-indigo-100 flex items-center justify-between">
                        <span className="text-[11px] text-emerald-700 font-semibold">
                          {lang === "HI" ? "यात्रा सक्रिय" : "Journey Enrolled"}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPrimaryExam(ex.examId);
                          }}
                          className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                            isPrimary
                              ? "bg-amber-100 text-amber-900"
                              : "text-indigo-700 hover:underline"
                          }`}
                        >
                          {isPrimary
                            ? lang === "HI"
                              ? "मुख्य लक्ष्य ★"
                              : "Primary Focus ★"
                            : lang === "HI"
                              ? "मुख्य बनाएं"
                              : "Set Primary"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Step 3: Daily Commitment */}
          <section>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
              <Clock className="w-4 h-4 text-[#1E3A8A]" />
              <span>
                {lang === "HI" ? "3. दैनिक अभ्यास लक्ष्य" : "3. Daily Adaptive Study Target"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { mins: 30, tagEn: "Working Professional", tagHi: "नौकरीपेशा अभ्यर्थी" },
                { mins: 45, tagEn: "Recommended Pace", tagHi: "अनुशंसित गति" },
                { mins: 90, tagEn: "Intensive Prelims Sprint", tagHi: "तीव्र प्रीलिम्स मोड" },
              ].map((opt) => (
                <button
                  key={opt.mins}
                  type="button"
                  onClick={() => setDailyMins(opt.mins)}
                  className={`rounded-xl border-2 p-3 text-center transition ${
                    dailyMins === opt.mins
                      ? "border-[#1E3A8A] bg-indigo-50/60"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="font-mono-metric text-lg font-bold text-slate-900">
                    {opt.mins} {lang === "HI" ? "मिनट" : "min"}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5">
                    {lang === "HI" ? opt.tagHi : opt.tagEn}
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {lang === "HI"
              ? `${selectedExams.length} परीक्षा यात्राएं चयनित`
              : `${selectedExams.length} exam journeys active`}
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white font-semibold px-6 py-2.5 text-sm shadow-sm transition disabled:opacity-60 cursor-pointer"
          >
            {saving
              ? lang === "HI"
                ? "सहेजा जा रहा है..."
                : "Saving Profile..."
              : lang === "HI"
                ? "मेरा डैशबोर्ड प्रारंभ करें →"
                : "Launch My Sankalp Journey →"}
          </button>
        </div>
      </div>
    </div>
  );
};
