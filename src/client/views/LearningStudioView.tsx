import React, { useEffect, useState } from "react";
import { BookOpen, Check, Clock, Layers, NotebookPen, Play, ShieldCheck, Sparkles } from "lucide-react";
import { api, type StudioSheet } from "../lib/api";
import type { LangCode } from "../lib/i18n";

interface LearningStudioViewProps {
  lang: LangCode;
  sheets: StudioSheet[];
  selectedSheetId: string | null;
  onSelectSheet: (id: string) => void;
  onStartTopicDrill: (topicId: string) => void;
  onOpenFlashcards: () => void;
}

export const LearningStudioView: React.FC<LearningStudioViewProps> = ({
  lang,
  sheets,
  selectedSheetId,
  onSelectSheet,
  onStartTopicDrill,
  onOpenFlashcards,
}) => {
  const activeSheet = sheets.find((s) => s.id === selectedSheetId) || sheets[0];
  const [note, setNote] = useState(activeSheet?.scratchpadNote || "");
  const [savingNote, setSavingNote] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    setNote(activeSheet?.scratchpadNote || "");
    setSavedToast(false);
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
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } finally {
      setSavingNote(false);
    }
  };

  const { content } = activeSheet;

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-12 gap-6 ${lang === "HI" ? "lang-hi" : ""}`}>
      {/* Left Sidebar (3 cols): High-Yield Cheat Sheets & Comparison Matrices */}
      <aside className="lg:col-span-3 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500 px-1">
          {lang === "HI" ? "उच्च-उपयोगी चीट शीट्स" : "High-Yield Revision Studio"}
        </div>
        {sheets.map((s) => {
          const isSelected = s.id === activeSheet.id;
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
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-100 text-[#1E3A8A]">
                  {s.artifactType.replace("_", " ")}
                </span>
                <span className="font-mono-metric text-[11px] text-slate-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {s.estReadMins}m
                </span>
              </div>
              <div className="font-bold text-xs text-slate-900 leading-snug">{s.title}</div>
              <div className="mt-2 text-[11px] text-emerald-700 font-semibold">
                {lang === "HI"
                  ? `${s.pyqCoverageCount} आयोग प्रश्नों (PYQs) का कवरेज`
                  : `Covers ${s.pyqCoverageCount} Commission PYQs`}
              </div>
            </button>
          );
        })}
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
