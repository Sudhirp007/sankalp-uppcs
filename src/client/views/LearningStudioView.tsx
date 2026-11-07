import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  Clock,
  Layers,
  NotebookPen,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, type StudioSheet } from "../lib/api";
import type { LangCode } from "../lib/i18n";

interface LearningStudioViewProps {
  lang: LangCode;
  sheets: StudioSheet[];
  selectedSheetId: string | null;
  onSelectSheet: (id: string) => void;
  onStartTopicDrill: (topicId: string) => void;
  onOpenFlashcards: () => void;
  onRefreshStudio?: () => Promise<void> | void;
}

export const LearningStudioView: React.FC<LearningStudioViewProps> = ({
  lang,
  sheets,
  selectedSheetId,
  onSelectSheet,
  onStartTopicDrill,
  onOpenFlashcards,
  onRefreshStudio,
}) => {
  const [studioFilter, setStudioFilter] = useState<"FOR_YOU" | "MY_NOTES" | "ALL">("FOR_YOU");

  const visibleSheets = useMemo(() => {
    if (studioFilter === "MY_NOTES") {
      return sheets.filter((s) => s.hasPersonalNote);
    }
    if (studioFilter === "FOR_YOU") {
      // Weakest performance topics + personally annotated sheets prioritized first
      return [...sheets].sort((a, b) => {
        const aBoost = a.curationTier === "PRIORITY_GAP" ? -20 : a.hasPersonalNote ? -10 : 0;
        const bBoost = b.curationTier === "PRIORITY_GAP" ? -20 : b.hasPersonalNote ? -10 : 0;
        return a.topicMasteryPct + aBoost - (b.topicMasteryPct + bBoost);
      });
    }
    return sheets;
  }, [sheets, studioFilter]);

  const activeSheet =
    visibleSheets.find((s) => s.id === selectedSheetId) ||
    sheets.find((s) => s.id === selectedSheetId) ||
    visibleSheets[0] ||
    sheets[0];

  const [note, setNote] = useState(activeSheet?.scratchpadNote || "");
  const [savingNote, setSavingNote] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [creatingCard, setCreatingCard] = useState(false);
  const [cardCreatedToast, setCardCreatedToast] = useState(false);

  useEffect(() => {
    setNote(activeSheet?.scratchpadNote || "");
    setSavedToast(false);
    setCardCreatedToast(false);
  }, [activeSheet?.id, activeSheet?.scratchpadNote]);

  if (!activeSheet) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
        No cheat sheets available.
      </div>
    );
  }

  const handleSaveNote = async () => {
    setSavingNote(true);
    try {
      await api.saveScratchpad(activeSheet.id, note);
      await onRefreshStudio?.();
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } finally {
      setSavingNote(false);
    }
  };

  const handleConvertNoteToFlashcard = async () => {
    const trimmed = note.trim();
    if (!trimmed || creatingCard) return;
    setCreatingCard(true);
    try {
      await api.saveScratchpad(activeSheet.id, trimmed);
      await api.createPersonalFlashcard({
        topicId: activeSheet.topicId,
        front:
          lang === "HI"
            ? `${activeSheet.title} — आपके व्यक्तिगत रिवीजन नोट्स के मुख्य बिंदु क्या हैं?`
            : `${activeSheet.title} — Recall your personal revision trigger / note:`,
        back: trimmed,
        mnemonic: activeSheet.content.chronologyLock?.chain,
        originContext: `From Studio Note (${activeSheet.topicName || activeSheet.subjectKey})`,
      });
      await onRefreshStudio?.();
      setCardCreatedToast(true);
      setTimeout(() => setCardCreatedToast(false), 3000);
    } finally {
      setCreatingCard(false);
    }
  };

  const { content } = activeSheet;

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-12 gap-6 ${lang === "HI" ? "lang-hi" : ""}`}>
      {/* Left Sidebar (3 cols): Performance-Curated Cheat Sheets & Personal Notes Filter */}
      <aside className="lg:col-span-3 space-y-3">
        <div className="space-y-2 px-1">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {lang === "HI" ? "आपके प्रदर्शन अनुसार चयनित" : "Curated Revision Studio"}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { key: "FOR_YOU", en: "For You", hi: "आपके लिए" },
                {
                  key: "MY_NOTES",
                  en: `My Notes (${sheets.filter((x) => x.hasPersonalNote).length})`,
                  hi: `मेरे नोट्स (${sheets.filter((x) => x.hasPersonalNote).length})`,
                },
                { key: "ALL", en: "All", hi: "सभी" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStudioFilter(tab.key)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                  studioFilter === tab.key
                    ? "bg-[#1E3A8A] text-white"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {lang === "HI" ? tab.hi : tab.en}
              </button>
            ))}
          </div>
        </div>

        {visibleSheets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-xs text-slate-500">
            {lang === "HI"
              ? "अभी किसी चीट शीट में व्यक्तिगत नोट्स नहीं जोड़े गए हैं।"
              : "No personal scratchpad notes saved yet. Add a note on the right panel to pin sheets here."}
          </div>
        ) : (
          visibleSheets.map((s) => {
            const isSelected = s.id === activeSheet.id;
            const badgeStyle =
              s.curationTier === "PRIORITY_GAP"
                ? "bg-rose-50 text-rose-800 border border-rose-200"
                : s.hasPersonalNote
                  ? "bg-amber-50 text-amber-900 border border-amber-200"
                  : "bg-emerald-50 text-emerald-800 border border-emerald-200";
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSheet(s.id)}
                className={`w-full text-left rounded-2xl border p-4 transition cursor-pointer ${
                  isSelected
                    ? "border-[#1E3A8A] bg-indigo-50/60 shadow-xs"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-100 text-[#1E3A8A]">
                    {s.artifactType.replace("_", " ")}
                  </span>
                  <span className="font-mono-metric text-[11px] text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {s.estReadMins}m
                  </span>
                </div>
                <div className="font-bold text-xs text-slate-900 leading-snug">{s.title}</div>
                <div className={`mt-2 inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeStyle}`}>
                  {s.curatedReason}
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-emerald-700 font-semibold">
                  <span>
                    {lang === "HI"
                      ? `${s.pyqCoverageCount} आयोग प्रश्नों का कवरेज`
                      : `Covers ${s.pyqCoverageCount} Commission PYQs`}
                  </span>
                  {s.hasPersonalNote && <NotebookPen className="w-3.5 h-3.5 text-amber-700" />}
                </div>
              </button>
            );
          })
        )}
      </aside>

      {/* Center Canvas (6 cols): Comparison Matrix, Constitutional Articles & Chronology Lock */}
      <main className="lg:col-span-6 space-y-5">
        <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-6 space-y-5">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-2">
              <span className="font-semibold text-[#1E3A8A]">{activeSheet.subjectKey}</span>
              <span>•</span>
              <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" />
                {activeSheet.canonicalSource}
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-900">{activeSheet.title}</h1>
            {content.summary && (
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{content.summary}</p>
            )}
          </div>

          {/* Structured Master Comparison Matrix */}
          {content.matrixRows && content.matrixHeaders && (
            <div className="space-y-2.5">
              <h2 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[#1E3A8A]" />
                {content.matrixTitle}
              </h2>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                      {content.matrixHeaders.map((h, i) => (
                        <th key={i} className="p-3 font-bold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {content.matrixRows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50/70">
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className={`p-3 align-top ${
                              cIdx === 0
                                ? "font-bold text-slate-900 whitespace-nowrap"
                                : cIdx === row.length - 1
                                  ? "font-mono-metric font-semibold text-[#1E3A8A] whitespace-nowrap"
                                  : "text-slate-700"
                            }`}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* High-Recall Article / Statutory Anchor Cards */}
          {content.keyArticles && content.keyArticles.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {content.keyArticles.map((art, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono-metric text-xs font-extrabold text-[#1E3A8A]">
                      {art.badge}
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-900">
                      {art.tag}
                    </span>
                  </div>
                  <div className="font-bold text-xs text-slate-900">{art.title}</div>
                  <p className="text-xs text-slate-600 leading-relaxed">{art.detail}</p>
                </div>
              ))}
            </div>
          )}

          {/* Chronology / Formula Memory Lock */}
          {content.chronologyLock && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-900 uppercase">
                <Sparkles className="w-4 h-4" />
                {content.chronologyLock.title}
              </div>
              <div className="font-mono-metric text-xs font-bold text-slate-900 bg-white/80 rounded-lg px-3 py-2 border border-amber-200/70">
                {content.chronologyLock.chain}
              </div>
              <p className="text-xs text-amber-950">{content.chronologyLock.rule}</p>
            </div>
          )}
        </div>
      </main>

      {/* Right Column (3 cols): Aspirant Personal Scratchpad + Linked Active Recall */}
      <aside className="lg:col-span-3 space-y-4">
        <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900">
              <NotebookPen className="w-4 h-4 text-[#1E3A8A]" />
              {lang === "HI" ? "व्यक्तिगत नोट्स (Scratchpad)" : "Personal Revision Notes"}
            </div>
            {savedToast && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                <Check className="w-3 h-3" /> Saved
              </span>
            )}
          </div>

          <textarea
            rows={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              lang === "HI"
                ? "यहाँ अपनी ट्रिक या मुख्य बिंदु लिखें..."
                : "Write your own mnemonic or mistake trigger..."
            }
            className="w-full rounded-xl border border-slate-200 bg-amber-50/30 p-3 text-xs text-slate-800 focus:outline-none focus:border-[#1E3A8A]"
          />

          <button
            type="button"
            disabled={savingNote}
            onClick={handleSaveNote}
            className="w-full rounded-xl border border-slate-300 hover:bg-slate-50 py-2 text-xs font-semibold text-slate-800 transition cursor-pointer"
          >
            {savingNote
              ? "..."
              : lang === "HI"
                ? "नोट्स क्लाउड में सहेजें"
                : "Save Note to Neon Cloud"}
          </button>

          <button
            type="button"
            disabled={creatingCard || !note.trim()}
            onClick={handleConvertNoteToFlashcard}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 py-2 text-xs font-bold text-amber-950 transition disabled:opacity-50 cursor-pointer"
          >
            {cardCreatedToast ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" />
                {lang === "HI" ? "फ्लैशकार्ड डेक में जोड़ा गया!" : "Added to My Flashcards!"}
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                {creatingCard
                  ? "..."
                  : lang === "HI"
                    ? "इस नोट से फ्लैशकार्ड बनाएं"
                    : "Turn Note into Personal Flashcard"}
              </>
            )}
          </button>
        </div>

        {/* Immediate Active-Recall Loop */}
        <div className="rounded-2xl bg-[#1E3A8A] text-white p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-indigo-200">
            {lang === "HI" ? "तुरंत परीक्षण करें" : "Lock Into Long-Term Memory"}
          </div>
          <p className="text-xs text-indigo-100">
            {lang === "HI"
              ? `वर्तमान विषय दक्षता: ${activeSheet.topicMasteryPct}%। इस चीट शीट पर आधारित प्रश्न हल करें:`
              : `Current Topic Mastery: ${activeSheet.topicMasteryPct}%. Verify retention immediately:`}
          </p>
          <button
            type="button"
            onClick={() => onStartTopicDrill(activeSheet.topicId)}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-white text-[#1E3A8A] hover:bg-indigo-50 font-bold py-2.5 text-xs transition cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {lang === "HI" ? "इस विषय का 10-प्रश्न अभ्यास" : "Test This Topic (10 PYQs)"}
          </button>
          <button
            type="button"
            onClick={onOpenFlashcards}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white font-semibold py-2 text-xs transition cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5" />
            {lang === "HI" ? "संबद्ध फ्लैशकार्ड्स खोलें" : "Review Linked Flashcards"}
          </button>
        </div>
      </aside>
    </div>
  );
};
