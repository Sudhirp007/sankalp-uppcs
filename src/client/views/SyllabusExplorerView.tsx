import React, { useState } from "react";
import { BookOpen, CheckSquare, ChevronDown, ChevronRight, Play, Search, Sparkles } from "lucide-react";
import type { SyllabusTreeResponse } from "../lib/api";
import type { LangCode } from "../lib/i18n";

interface SyllabusExplorerViewProps {
  lang: LangCode;
  data: SyllabusTreeResponse;
  startingSession: boolean;
  onStartCustomSession: (params: {
    topicIds: string[];
    origins: string[];
    mode: "EXAM" | "TUTOR";
    limit: number;
  }) => void;
  onOpenCheatSheet: (artifactId: string) => void;
}

export const SyllabusExplorerView: React.FC<SyllabusExplorerViewProps> = ({
  lang,
  data,
  startingSession,
  onStartCustomSession,
  onOpenCheatSheet,
}) => {
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    data.tree.slice(0, 2).forEach((d) => {
      init[d.id] = true;
    });
    return init;
  });
  const [selectedTopics, setSelectedTopics] = useState<string[]>(["top-polity-panchayat"]);
  const [origins, setOrigins] = useState<string[]>(["PYQ", "CONCEPT_BUILDER", "NCERT_DRILL"]);
  const [mode, setMode] = useState<"EXAM" | "TUTOR">("EXAM");
  const [limit, setLimit] = useState<number>(15);
  const [search, setSearch] = useState("");

  const toggleTopic = (id: string) => {
    setSelectedTopics((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleOrigin = (code: string) => {
    setOrigins((prev) => {
      if (prev.includes(code)) {
        return prev.length === 1 ? prev : prev.filter((x) => x !== code);
      }
      return [...prev, code];
    });
  };

  const qLower = search.trim().toLowerCase();

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-12 gap-6 ${lang === "HI" ? "lang-hi" : ""}`}>
      {/* Left 8 Columns: 3-Tier Syllabus Accordion */}
      <div className="lg:col-span-8 space-y-4">
        <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              {lang === "HI"
                ? "त्रि-स्तरीय पाठ्यक्रम वृक्ष एवं प्रश्न बैंक (PYQ + Concept + NCERT)"
                : "3-Tier Syllabus Explorer & Multi-Source Question Bank"}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === "HI"
                ? "सूक्ष्म-विषय चुनें, 3-मिनट चीट शीट पढ़ें या लक्षित अभ्यास सत्र शुरू करें।"
                : "Select micro-topics to build custom drills combining Commission PYQs, Concept-Builders, and NCERT Drills."}
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === "HI" ? "विषय या अनुच्छेद खोजें..." : "Filter topics, articles..."}
              className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-1.5 text-xs focus:outline-none focus:border-[#1E3A8A]"
            />
          </div>
        </div>

        {data.tree.map((dom) => {
          const filteredModules = dom.modules
            .map((m) => ({
              ...m,
              microTopics: m.microTopics.filter(
                (mt) =>
                  !qLower ||
                  mt.name.toLowerCase().includes(qLower) ||
                  mt.description.toLowerCase().includes(qLower)
              ),
            }))
            .filter((m) => m.microTopics.length > 0);

          if (filteredModules.length === 0) return null;
          const isOpen = expandedDomains[dom.id] ?? Boolean(qLower);

          return (
            <div
              key={dom.id}
              className="rounded-2xl bg-white border border-slate-200 shadow-xs overflow-hidden"
            >
              <button
                type="button"
                onClick={() =>
                  setExpandedDomains((prev) => ({ ...prev, [dom.id]: !isOpen }))
                }
                className="w-full px-5 py-4 flex items-center justify-between bg-slate-50/70 hover:bg-slate-50 transition cursor-pointer"
              >
                <div className="flex items-center gap-3 text-left">
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-[#1E3A8A]" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-500" />
                  )}
                  <div>
                    <div className="font-bold text-sm text-slate-900">{dom.name}</div>
                    <div className="text-xs text-slate-500">{dom.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono-metric text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-[#1E3A8A] font-semibold">
                    {dom.weightPct}% {lang === "HI" ? "भार" : "Weight"}
                  </span>
                  <span className="font-mono-metric text-xs font-bold text-slate-800">
                    {dom.masteryScore}%
                  </span>
                </div>
              </button>

              {isOpen && (
                <div className="p-5 space-y-4 border-t border-slate-200">
                  {filteredModules.map((mod) => (
                    <div key={mod.id} className="space-y-2.5">
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        {mod.name}
                      </div>
                      <div className="space-y-2">
                        {mod.microTopics.map((mt) => {
                          const isChecked = selectedTopics.includes(mt.id);
                          return (
                            <div
                              key={mt.id}
                              onClick={() => toggleTopic(mt.id)}
                              className={`cursor-pointer rounded-xl border p-3.5 transition ${
                                isChecked
                                  ? "border-[#1E3A8A] bg-indigo-50/40"
                                  : "border-slate-200 hover:border-slate-300"
                              }`}
                            >
                              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                                <div className="flex items-start gap-2.5">
                                  <CheckSquare
                                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                                      isChecked ? "text-[#1E3A8A]" : "text-slate-300"
                                    }`}
                                  />
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-bold text-sm text-slate-900">
                                        {mt.name}
                                      </span>
                                      {mt.isHighYield && (
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900">
                                          HIGH YIELD
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-slate-600 mt-0.5">
                                      {mt.description}
                                    </p>

                                    <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-slate-600 font-mono-metric">
                                      <span>PYQs: {mt.questionCounts.pyq}</span>
                                      <span>•</span>
                                      <span>
                                        Concept/NCERT:{" "}
                                        {mt.questionCounts.concept + mt.questionCounts.ncert}
                                      </span>
                                      {mt.artifact && (
                                        <>
                                          <span>•</span>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onOpenCheatSheet(mt.artifact!.id);
                                            }}
                                            className="inline-flex items-center gap-1 font-sans font-bold text-[#1E3A8A] hover:underline cursor-pointer"
                                          >
                                            <BookOpen className="w-3 h-3" />
                                            {lang === "HI" ? "चीट शीट" : "Cheat Sheet"}
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <span
                                  className={`font-mono-metric text-xs font-bold px-2 py-0.5 rounded shrink-0 self-start ${
                                    mt.masteryScore >= 75
                                      ? "bg-emerald-100 text-emerald-800"
                                      : mt.masteryScore >= 55
                                        ? "bg-slate-100 text-slate-800"
                                        : "bg-rose-100 text-rose-800"
                                  }`}
                                >
                                  {mt.masteryScore}%
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right 4 Columns: Sticky Custom Practice Builder */}
      <div className="lg:col-span-4">
        <div className="sticky top-20 rounded-2xl bg-white border border-slate-200 shadow-sm p-5 space-y-5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#1E3A8A]" />
            <h2 className="font-bold text-base text-slate-900">
              {lang === "HI" ? "कस्टम अभ्यास निर्माता" : "Custom Practice Configurator"}
            </h2>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700">
            <span className="font-bold text-slate-900">{selectedTopics.length}</span>{" "}
            {lang === "HI"
              ? "सूक्ष्म-विषय चयनित (0 होने पर संपूर्ण पाठ्यक्रम अनुकूली चयन)"
              : "micro-topics selected (leave empty for full-syllabus mix)"}
          </div>

          {/* Question Source Mix (PYQ + Concept Builder + NCERT) */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-800 block">
              {lang === "HI" ? "प्रश्न स्रोत मिश्रण चुनें:" : "Question Source Mix:"}
            </label>
            {[
              { code: "PYQ", en: "Official Commission PYQs (2015–2025)", hi: "आयोग के पूर्व वर्षों के प्रश्न (PYQs)" },
              { code: "CONCEPT_BUILDER", en: "Concept-Builder Trap Drills", hi: "अवधारणा एवं ट्रैप अभ्यास प्रश्न" },
              { code: "NCERT_DRILL", en: "NCERT & Laxmikanth Foundation", hi: "NCERT एवं मानक पुस्तक आधार" },
            ].map((src) => {
              const active = origins.includes(src.code);
              return (
                <button
                  key={src.code}
                  type="button"
                  onClick={() => toggleOrigin(src.code)}
                  className={`w-full text-left rounded-xl border px-3 py-2 text-xs font-semibold flex items-center justify-between transition cursor-pointer ${
                    active
                      ? "border-[#1E3A8A] bg-indigo-50/60 text-[#1E3A8A]"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  <span>{lang === "HI" ? src.hi : src.en}</span>
                  <span>{active ? "✓" : ""}</span>
                </button>
              );
            })}
          </div>

          {/* Session Mode */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-800 block">
              {lang === "HI" ? "अभ्यास मोड:" : "Practice Mode:"}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("EXAM")}
                className={`rounded-xl border py-2 px-2.5 text-xs font-semibold transition cursor-pointer ${
                  mode === "EXAM"
                    ? "border-[#1E3A8A] bg-[#1E3A8A] text-white"
                    : "border-slate-200 text-slate-700"
                }`}
              >
                {lang === "HI" ? "परीक्षा सिमुलेशन" : "Exam Simulation"}
              </button>
              <button
                type="button"
                onClick={() => setMode("TUTOR")}
                className={`rounded-xl border py-2 px-2.5 text-xs font-semibold transition cursor-pointer ${
                  mode === "TUTOR"
                    ? "border-[#1E3A8A] bg-[#1E3A8A] text-white"
                    : "border-slate-200 text-slate-700"
                }`}
              >
                {lang === "HI" ? "त्वरित ट्यूटर मोड" : "Instant Tutor"}
              </button>
            </div>
          </div>

          {/* Question Count Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-800">
                {lang === "HI" ? "प्रश्नों की संख्या:" : "Number of Questions:"}
              </span>
              <span className="font-mono-metric font-bold text-[#1E3A8A]">{limit} Qs</span>
            </div>
            <input
              type="range"
              min={5}
              max={30}
              step={5}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full accent-[#1E3A8A]"
            />
          </div>

          <button
            type="button"
            disabled={startingSession}
            onClick={() =>
              onStartCustomSession({
                topicIds: selectedTopics,
                origins,
                mode,
                limit,
              })
            }
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white font-bold py-3 text-sm shadow-xs transition disabled:opacity-60 cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            {startingSession
              ? "..."
              : lang === "HI"
                ? "लक्षित अभ्यास प्रारंभ करें"
                : "Launch Targeted Drill"}
          </button>
        </div>
      </div>
    </div>
  );
};
