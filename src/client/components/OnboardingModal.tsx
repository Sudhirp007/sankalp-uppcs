import React, { useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Crown,
  Globe2,
  GraduationCap,
  LogOut,
  Phone,
  Sparkles,
  Target,
  User,
} from "lucide-react";
import type { ExamPortfolioCard } from "../lib/api";
import type { LangCode } from "../lib/i18n";

interface OnboardingModalProps {
  initialLang: LangCode;
  initialActiveExamId: string;
  initialDailyGoalMins: number;
  initialDisplayName?: string;
  initialPhoneNumber?: string | null;
  planTier?: "FREE" | "PRO_PASS";
  isAuthenticated?: boolean;
  exams: ExamPortfolioCard[];
  onNavigateHome: () => void;
  onSignOut?: () => Promise<void>;
  onClose?: () => void;
  onSave: (payload: {
    preferredLanguage: LangCode;
    activeExamId: string;
    enrolledExamIds: string[];
    dailyGoalMins: number;
    displayName?: string;
    phoneNumber?: string;
  }) => Promise<void>;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  initialLang,
  initialActiveExamId,
  initialDailyGoalMins,
  initialDisplayName = "",
  initialPhoneNumber = "",
  planTier = "FREE",
  isAuthenticated = false,
  exams,
  onNavigateHome,
  onSignOut,
  onClose,
  onSave,
}) => {
  const [lang, setLang] = useState<LangCode>(initialLang);
  const [displayName, setDisplayName] = useState<string>(() =>
    initialDisplayName === "Guest Aspirant" || initialDisplayName === "Aspirant"
      ? ""
      : initialDisplayName
  );
  const [phoneInput, setPhoneInput] = useState<string>(() =>
    (initialPhoneNumber || "").replace(/^\+91/, "")
  );
  const [selectedExams, setSelectedExams] = useState<string[]>(() =>
    exams.filter((e) => e.isEnrolled).map((e) => e.examId)
  );
  const [primaryExam, setPrimaryExam] = useState<string>(initialActiveExamId || "");
  const [dailyMins, setDailyMins] = useState<number>(initialDailyGoalMins || 45);
  const [saving, setSaving] = useState(false);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);

  const toggleExam = (examId: string) => {
    setValidationMsg(null);
    setSelectedExams((prev) => {
      if (prev.includes(examId)) {
        const next = prev.filter((id) => id !== examId);
        if (primaryExam === examId) {
          setPrimaryExam(next[0] || "");
        }
        return next;
      }
      const next = [...prev, examId];
      if (!primaryExam || !next.includes(primaryExam)) {
        setPrimaryExam(examId);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedExams.length === 0) {
      setValidationMsg(
        lang === "HI"
          ? "कृपया आगे बढ़ने से पहले कम से कम 1 लक्ष्य परीक्षा चुनें।"
          : "Please select at least 1 target exam journey above to personalize your dashboard."
      );
      return;
    }

    const cleanDigits = phoneInput.replace(/[^\d]/g, "");
    if (cleanDigits.length > 0 && cleanDigits.length !== 10) {
      setValidationMsg(
        lang === "HI"
          ? "कृपया वैध 10-अंकीय मोबाइल नंबर दर्ज करें (या इसे खाली छोड़ दें)।"
          : "Please enter a valid 10-digit mobile number (or leave blank)."
      );
      return;
    }

    setSaving(true);
    setValidationMsg(null);
    try {
      const active = selectedExams.includes(primaryExam) ? primaryExam : selectedExams[0]!;
      await onSave({
        preferredLanguage: lang,
        activeExamId: active,
        enrolledExamIds: selectedExams,
        dailyGoalMins: dailyMins,
        displayName: displayName.trim() || undefined,
        phoneNumber: cleanDigits.length === 10 ? `+91${cleanDigits}` : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A] ${lang === "HI" ? "lang-hi" : ""}`}>
      {/* Regular Full-Page Top Navigation Bar */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 lg:px-6 h-16 flex items-center justify-between gap-3">
          <div
            onClick={onNavigateHome}
            className="flex items-center gap-2.5 cursor-pointer"
            title="Go to Home Page"
          >
            <div className="w-9 h-9 rounded-xl bg-[#1E3A8A] text-white flex items-center justify-center shadow-xs">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <div className="font-extrabold text-base leading-none text-slate-900">Sankalp</div>
              <div className="text-[11px] text-slate-500 font-medium mt-0.5">MockExamOnline.com</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {planTier === "PRO_PASS" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-200 px-3 py-1 text-xs font-extrabold text-emerald-900">
                <Crown className="w-3.5 h-3.5 text-amber-600" />
                {lang === "HI" ? "प्रो पास सक्रिय" : "Pro Pass Active"}
              </span>
            )}

            <button
              type="button"
              onClick={() => setLang(lang === "EN" ? "HI" : "EN")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 px-3 py-1.5 text-xs font-bold text-[#1E3A8A] cursor-pointer"
            >
              <Globe2 className="w-3.5 h-3.5" />
              <span>{lang === "HI" ? "हिन्दी" : "English"}</span>
            </button>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{lang === "HI" ? "डैशबोर्ड पर वापस" : "Back to Dashboard"}</span>
              </button>
            )}

            {isAuthenticated && onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-800 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{lang === "HI" ? "साइन आउट" : "Sign Out"}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Regular Full-Page Setup Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 lg:px-6 py-8 sm:py-10">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Page Hero Header */}
          <div className="rounded-3xl bg-gradient-to-r from-[#1E3A8A] via-indigo-900 to-slate-900 p-6 sm:p-8 text-white shadow-sm">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide uppercase mb-3">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              {planTier === "PRO_PASS"
                ? lang === "HI"
                  ? "भुगतान सफल • अपनी प्रोफ़ाइल पूर्ण करें"
                  : "Pro Pass Unlocked • Complete Your Study Profile"
                : lang === "HI"
                  ? "व्यक्तिगत अध्ययन प्रोफ़ाइल सेटअप"
                  : "Personalized Study Workspace Setup"}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {lang === "HI"
                ? "अपना माध्यम एवं लक्ष्य परीक्षाएं चुनें"
                : "Configure Your Preferred Medium & Exam Journeys"}
            </h1>
            <p className="text-sm text-indigo-100 mt-2 max-w-2xl leading-relaxed">
              {lang === "HI"
                ? "सभी प्रश्न, व्याख्या, चीट शीट और फ्लैशकार्ड केवल आपकी चुनी हुई एक ही भाषा में दिखेंगे। आपका डैशबोर्ड केवल आपके द्वारा चुनी गई परीक्षाओं और हल किए गए प्रश्नों से ही तैयार होगा।"
                : "Zero dual-language clutter: every question, explanation, cheat sheet, and flashcard renders strictly in your chosen medium. Your readiness metrics start clean at 0% and grow strictly from the questions you solve."}
            </p>
          </div>

          {/* Step 1: Aspirant Profile Details (Name & Mobile) */}
          <section className="rounded-2xl bg-white border border-slate-200 shadow-xs p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <User className="w-4 h-4 text-[#1E3A8A]" />
              <span>
                {lang === "HI"
                  ? "1. अभ्यर्थी विवरण (Aspirant Profile Details)"
                  : "1. Your Aspirant Profile Details"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {lang === "HI" ? "आपका पूरा नाम" : "Full Name"}
                </label>
                <input
                  type="text"
                  placeholder={lang === "HI" ? "जैसे: सुधीर पाण्डेय" : "e.g., Sudhir Pandey"}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {lang === "HI" ? "मोबाइल नंबर (10 अंक)" : "Mobile Number (10-digit WhatsApp / SMS)"}
                </label>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-mono-metric font-bold text-slate-700">
                    <Phone className="w-3.5 h-3.5 text-slate-500" />
                    +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="9876543210"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
                    className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-mono-metric focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Step 2: Single-Language Medium Selection */}
          <section className="rounded-2xl bg-white border border-slate-200 shadow-xs p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Globe2 className="w-4 h-4 text-[#1E3A8A]" />
              <span>
                {lang === "HI"
                  ? "2. परीक्षा का माध्यम चुनें (कभी भी बदला जा सकता है)"
                  : "2. Select Preferred Study & Test Medium (Switchable Anytime)"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <button
                type="button"
                onClick={() => setLang("EN")}
                className={`text-left rounded-xl border-2 p-4 transition cursor-pointer ${
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
                className={`text-left rounded-xl border-2 p-4 transition cursor-pointer ${
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

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700">
              <span className="font-semibold text-[#1E3A8A] uppercase tracking-wider text-[11px] block mb-1">
                {lang === "HI" ? "लाइव एकल-भाषा पूर्वावलोकन:" : "Live Single-Language Preview:"}
              </span>
              {lang === "HI"
                ? "प्रश्न: अशोक मेहता समिति (1977) ने पंचायती राज संस्थाओं के लिए द्वि-स्तरीय प्रणाली की सिफारिश की थी..."
                : "Q: Which committee recommended replacing the 3-tier Panchayati Raj system with a 2-tier system in 1977?"}
            </div>
          </section>

          {/* Step 3: Target Exam Journeys */}
          <section className="rounded-2xl bg-white border border-slate-200 shadow-xs p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Target className="w-4 h-4 text-[#1E3A8A]" />
                <span>
                  {lang === "HI"
                    ? "3. अपनी लक्षित परीक्षाएं चुनें (एक या अधिक चुनें)"
                    : "3. Choose Your Target Exam Journeys (Select 1 or More)"}
                </span>
              </div>
              <span className="text-xs font-semibold text-slate-500">
                {lang === "HI"
                  ? `${selectedExams.length} परीक्षा चयनित`
                  : `${selectedExams.length} exam(s) selected`}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {exams.map((ex) => {
                const checked = selectedExams.includes(ex.examId);
                const isPrimary = checked && (primaryExam === ex.examId || selectedExams[0] === ex.examId);
                return (
                  <div
                    key={ex.examId}
                    onClick={() => toggleExam(ex.examId)}
                    className={`cursor-pointer rounded-xl border-2 p-4 transition ${
                      checked
                        ? "border-[#1E3A8A] bg-indigo-50/40 shadow-2xs"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                          <span>{ex.shortName}</span>
                          {checked && <CheckCircle2 className="w-4 h-4 text-[#1E3A8A]" />}
                        </div>
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

                    {checked ? (
                      <div className="mt-3 pt-2.5 border-t border-indigo-100 flex items-center justify-between">
                        <span className="text-[11px] text-emerald-700 font-semibold">
                          {lang === "HI" ? "यात्रा चयनित" : "Journey Selected"}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPrimaryExam(ex.examId);
                          }}
                          className={`text-[11px] px-2.5 py-0.5 rounded font-semibold cursor-pointer ${
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
                    ) : (
                      <div className="mt-2.5 text-[11px] text-slate-400">
                        {lang === "HI" ? "चुनने के लिए क्लिक करें" : "Click to add to your Exam Portfolio"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Step 4: Daily Study Commitment */}
          <section className="rounded-2xl bg-white border border-slate-200 shadow-xs p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Clock className="w-4 h-4 text-[#1E3A8A]" />
              <span>
                {lang === "HI" ? "4. दैनिक अभ्यास लक्ष्य" : "4. Daily Adaptive Study Target"}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { mins: 30, tagEn: "Working Professional", tagHi: "नौकरीपेशा अभ्यर्थी" },
                { mins: 45, tagEn: "Recommended Pace", tagHi: "अनुशंसित गति" },
                { mins: 90, tagEn: "Intensive Prelims Sprint", tagHi: "तीव्र प्रीलिम्स मोड" },
              ].map((opt) => (
                <button
                  key={opt.mins}
                  type="button"
                  onClick={() => setDailyMins(opt.mins)}
                  className={`rounded-xl border-2 p-3.5 text-center transition cursor-pointer ${
                    dailyMins === opt.mins
                      ? "border-[#1E3A8A] bg-indigo-50/60"
                      : "border-slate-200 hover:border-slate-300 bg-white"
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

          {validationMsg && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs font-semibold text-amber-900">
              {validationMsg}
            </div>
          )}

          {/* Submit Bar */}
          <div className="rounded-2xl bg-white border border-slate-200 shadow-xs px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs text-slate-600">
              {selectedExams.length === 0
                ? lang === "HI"
                  ? "शुरू करने के लिए ऊपर कम से कम 1 परीक्षा चुनें"
                  : "Select at least 1 exam track above to launch your workspace"
                : lang === "HI"
                  ? `${selectedExams.length} परीक्षा यात्राएं सक्रिय करने हेतु तैयार`
                  : `${selectedExams.length} exam journey(s) ready to launch`}
            </span>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white font-bold px-7 py-3 text-sm shadow-sm transition disabled:opacity-60 cursor-pointer"
            >
              {saving
                ? lang === "HI"
                  ? "सहेजा जा रहा है..."
                  : "Saving Your Workspace..."
                : lang === "HI"
                  ? "सेटिंग्स सहेजें एवं डैशबोर्ड खोलें →"
                  : "Save & Open My Exam Workspace →"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};
