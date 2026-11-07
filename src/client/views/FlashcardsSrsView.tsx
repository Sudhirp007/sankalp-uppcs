import React, { useEffect, useState } from "react";
import {
  AlertOctagon,
  CheckCircle2,
  Layers,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { api, type FlashcardItemDTO } from "../lib/api";
import type { LangCode } from "../lib/i18n";

interface FlashcardsSrsViewProps {
  lang: LangCode;
  onReviewedCountChange: () => void;
}

export const FlashcardsSrsView: React.FC<FlashcardsSrsViewProps> = ({
  lang,
  onReviewedCountChange,
}) => {
  const [deck, setDeck] = useState<string>("ALL");
  const [cards, setCards] = useState<FlashcardItemDTO[]>([]);
  const [mistakeCount, setMistakeCount] = useState<number>(0);
  const [personalCount, setPersonalCount] = useState<number>(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastScheduledMsg, setLastScheduledMsg] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFront, setNewFront] = useState("");
  const [newBack, setNewBack] = useState("");
  const [newMnemonic, setNewMnemonic] = useState("");
  const [savingNewCard, setSavingNewCard] = useState(false);

  const loadDeck = async (selectedDeck: string) => {
    setLoading(true);
    try {
      const res = await api.getDueFlashcards(selectedDeck);
      setCards(res.cards);
      setMistakeCount(res.mistakeCount);
      setPersonalCount(res.personalCount);
      setCurrentIndex(0);
      setFlipped(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDeck(deck);
  }, [deck, lang]);

  const activeCard = cards[currentIndex];

  const handleRate = async (rating: 1 | 2 | 3 | 4) => {
    if (!activeCard) return;
    const res = await api.reviewFlashcard(activeCard.flashcardId, rating);
    const daysLabel =
      res.nextIntervalDays < 1
        ? lang === "HI"
          ? "10 मिनट बाद पुनः"
          : "10 mins"
        : `${res.nextIntervalDays} ${lang === "HI" ? "दिन" : "days"}`;
    setLastScheduledMsg(
      lang === "HI"
        ? `अगली समीक्षा अंतराल: ${daysLabel}`
        : `Scheduled next review in ${daysLabel}`
    );
    onReviewedCountChange();
    setFlipped(false);
    setCurrentIndex((prev) => prev + 1);
  };

  const handleCreateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFront.trim() || !newBack.trim() || savingNewCard) return;
    setSavingNewCard(true);
    try {
      await api.createPersonalFlashcard({
        front: newFront.trim(),
        back: newBack.trim(),
        mnemonic: newMnemonic.trim() || undefined,
        originContext: lang === "HI" ? "व्यक्तिगत फ्लैशकार्ड डेक" : "Created in Flashcards Studio",
      });
      setNewFront("");
      setNewBack("");
      setNewMnemonic("");
      setShowCreateForm(false);
      setDeck("MY_CARDS");
      await loadDeck("MY_CARDS");
      onReviewedCountChange();
    } finally {
      setSavingNewCard(false);
    }
  };

  const handleDeletePersonalCard = async (cardId: string) => {
    await api.deletePersonalFlashcard(cardId);
    await loadDeck(deck);
    onReviewedCountChange();
  };

  return (
    <div className={`max-w-4xl mx-auto space-y-6 ${lang === "HI" ? "lang-hi" : ""}`}>
      {/* Deck Selector Pills */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#1E3A8A]" />
            <h1 className="font-bold text-lg text-slate-900">
              {lang === "HI"
                ? "सक्रिय-स्मरण फ्लैशकार्ड्स (FSRS अंतराल पुनरावृत्ति)"
                : "Active-Recall Flashcards (FSRS Spaced Repetition)"}
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {lang === "HI"
              ? "आपके गलत टेस्ट प्रश्न, कमज़ोर विषय (<60% दक्षता) और व्यक्तिगत कार्ड प्राथमिकता क्रम में दिखते हैं।"
              : "Curated by your performance: Test Mistakes, Personal Cards & Weak Topics (<60% mastery) surface first."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {lastScheduledMsg && (
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              {lastScheduledMsg}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white px-3.5 py-2 text-xs font-bold transition cursor-pointer"
          >
            {showCreateForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {lang === "HI" ? "नया व्यक्तिगत कार्ड" : "Create Personal Card"}
          </button>
        </div>
      </div>

      {showCreateForm && (
        <form
          onSubmit={handleCreateCard}
          className="rounded-2xl bg-white border-2 border-indigo-200 shadow-xs p-5 space-y-3"
        >
          <div className="font-bold text-sm text-slate-900">
            {lang === "HI"
              ? "अपना निजी सक्रिय-स्मरण फ्लैशकार्ड बनाएं (केवल आपको दृश्य)"
              : "Create Private Active-Recall Flashcard (Visible Only to Your Account)"}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={newFront}
              onChange={(e) => setNewFront(e.target.value)}
              placeholder={
                lang === "HI"
                  ? "प्रश्न / संकेत (Front Prompt)..."
                  : "Front Prompt (e.g., FRBM Act 2003 Fiscal Deficit Target)..."
              }
              className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#1E3A8A]"
            />
            <input
              type="text"
              required
              value={newBack}
              onChange={(e) => setNewBack(e.target.value)}
              placeholder={
                lang === "HI"
                  ? "सटीक उत्तर / मुख्य तथ्य (Back Answer)..."
                  : "Back Canonical Answer / Fact..."
              }
              className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#1E3A8A]"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={newMnemonic}
              onChange={(e) => setNewMnemonic(e.target.value)}
              placeholder={
                lang === "HI"
                  ? "वैकल्पिक ट्रिक / स्मृति सूत्र (Mnemonic)..."
                  : "Optional Mnemonic or Examiner Trap Warning..."
              }
              className="flex-1 rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#1E3A8A]"
            />
            <button
              type="submit"
              disabled={savingNewCard}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2 text-xs transition cursor-pointer"
            >
              {savingNewCard ? "..." : lang === "HI" ? "सहेजें" : "Save to My Deck"}
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: "ALL", en: "For You (Smart Queue)", hi: "स्मार्ट प्राथमिकता क्यू" },
          {
            key: "MISTAKE_DECK",
            en: `Test Mistake Deck (${mistakeCount})`,
            hi: `टेस्ट त्रुटि डेक (${mistakeCount})`,
          },
          {
            key: "MY_CARDS",
            en: `My Personal Cards (${personalCount})`,
            hi: `मेरे व्यक्तिगत कार्ड्स (${personalCount})`,
          },
          { key: "ARTICLES_COMMITTEES", en: "Polity & Articles", hi: "संविधान एवं समितियां" },
          { key: "ECONOMY_CONCEPTS", en: "Fiscal & Economy", hi: "अर्थव्यवस्था सूत्र" },
          { key: "UP_SPECIAL", en: "UP Special & Ramsar", hi: "उ.प्र. विशेष" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setDeck(tab.key)}
            className={`rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
              deck === tab.key
                ? "bg-[#1E3A8A] text-white shadow-xs"
                : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {lang === "HI" ? tab.hi : tab.en}
          </button>
        ))}
      </div>

      {/* Flashcard Stage */}
      {loading ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-12 text-center text-sm text-slate-500">
          Loading active-recall cards...
        </div>
      ) : !activeCard ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-12 text-center space-y-3">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
          <h2 className="font-bold text-lg text-slate-900">
            {lang === "HI" ? "इस डेक के सभी कार्ड पूरे हुए!" : "All Cards in This Queue Reviewed!"}
          </h2>
          <p className="text-xs text-slate-500">
            {lang === "HI"
              ? "आपकी स्मृति अंतराल तालिका Neon डेटाबेस में अपडेट कर दी गई है।"
              : "Your FSRS retention intervals have been persisted to Neon Postgres."}
          </p>
          <button
            type="button"
            onClick={() => setCurrentIndex(0)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E3A8A] text-white font-semibold px-4 py-2 text-xs cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {lang === "HI" ? "पुनः अभ्यास करें" : "Replay Deck"}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-500">{activeCard.topicBreadcrumb}</div>
              <span
                className={`inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                  activeCard.originType === "TEST_MISTAKE"
                    ? "bg-rose-100 text-rose-800"
                    : activeCard.isPersonal
                      ? "bg-amber-100 text-amber-900"
                      : "bg-indigo-50 text-[#1E3A8A]"
                }`}
              >
                {activeCard.originLabel}
              </span>
            </div>

            <div className="text-right flex items-center gap-2.5">
              <div>
                <span className="font-mono-metric text-xs font-bold text-slate-700">
                  {currentIndex + 1} / {cards.length}
                </span>
                {activeCard.askedInLabel && (
                  <div className="text-[11px] text-amber-800 font-semibold mt-0.5">
                    {activeCard.askedInLabel}
                  </div>
                )}
              </div>
              {activeCard.isPersonal && (
                <button
                  type="button"
                  title="Delete Personal Card"
                  onClick={() => handleDeletePersonalCard(activeCard.flashcardId)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Prompt Front */}
          <div className="py-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#1E3A8A] mb-2">
              {activeCard.cardTypeLabel}
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 leading-relaxed">
              {activeCard.front}
            </h2>
          </div>

          {!flipped ? (
            <div className="pt-4">
              <button
                type="button"
                onClick={() => setFlipped(true)}
                className="w-full rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white font-bold py-3.5 text-sm shadow-xs transition cursor-pointer"
              >
                {lang === "HI" ? "उत्तर एवं परीक्षक ट्रैप देखें (Reveal Answer)" : "Reveal Canonical Answer & Examiner Trap"}
              </button>
            </div>
          ) : (
            <div className="space-y-4 pt-4 border-t border-slate-200">
              <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-4">
                <div className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800 mb-1">
                  {lang === "HI" ? "सटीक उत्तर" : "Canonical Answer"}
                </div>
                <p className="text-sm font-semibold text-slate-900 leading-relaxed">
                  {activeCard.back}
                </p>
              </div>

              {activeCard.trapWarning && (
                <div className="rounded-xl bg-rose-50/70 border border-rose-200 p-3.5 flex items-start gap-2.5">
                  <AlertOctagon className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-950 font-medium">{activeCard.trapWarning}</p>
                </div>
              )}

              {activeCard.mnemonic && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-950 font-semibold">{activeCard.mnemonic}</p>
                </div>
              )}

              {/* FSRS 4-Rating Scheduling Controls */}
              <div className="pt-2">
                <div className="text-xs text-slate-500 text-center mb-2.5">
                  {lang === "HI"
                    ? "स्मरण कितना सहज था? (अगला रिवीजन अंतराल चुनें)"
                    : "Rate recall effort to schedule your optimal FSRS interval:"}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleRate(1)}
                    className="rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-900 py-2.5 px-3 text-xs font-bold cursor-pointer"
                  >
                    <div>1 • {lang === "HI" ? "भूल गए (Again)" : "Again"}</div>
                    <div className="font-mono-metric text-[11px] font-normal opacity-80">10m</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRate(2)}
                    className="rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900 py-2.5 px-3 text-xs font-bold cursor-pointer"
                  >
                    <div>2 • {lang === "HI" ? "कठिन (Hard)" : "Hard"}</div>
                    <div className="font-mono-metric text-[11px] font-normal opacity-80">2d</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRate(3)}
                    className="rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 py-2.5 px-3 text-xs font-bold cursor-pointer"
                  >
                    <div>3 • {lang === "HI" ? "अच्छा (Good)" : "Good"}</div>
                    <div className="font-mono-metric text-[11px] font-normal opacity-80">6d</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRate(4)}
                    className="rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-[#1E3A8A] py-2.5 px-3 text-xs font-bold cursor-pointer"
                  >
                    <div>4 • {lang === "HI" ? "अति सरल (Easy)" : "Easy"}</div>
                    <div className="font-mono-metric text-[11px] font-normal opacity-80">15d</div>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
