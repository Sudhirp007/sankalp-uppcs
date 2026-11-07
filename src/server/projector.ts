import type { CheatSheetContent, LocalizedOption } from "../db/schema";

export type LangCode = "EN" | "HI";

export function normalizeLang(raw?: string | null): LangCode {
  return String(raw || "EN").toUpperCase() === "HI" ? "HI" : "EN";
}

export function pickText(lang: LangCode, en?: string | null, hi?: string | null): string {
  if (lang === "HI") {
    return (hi && hi.trim().length > 0 ? hi : en) || "";
  }
  return (en && en.trim().length > 0 ? en : hi) || "";
}

export function pickOptions(
  lang: LangCode,
  optionsEn: LocalizedOption[],
  optionsHi?: LocalizedOption[] | null
): LocalizedOption[] {
  if (lang === "HI" && Array.isArray(optionsHi) && optionsHi.length === 4) {
    return optionsHi;
  }
  return optionsEn;
}

export function pickArtifactContent(
  lang: LangCode,
  contentEn: CheatSheetContent,
  contentHi: CheatSheetContent
): CheatSheetContent {
  return lang === "HI" ? contentHi : contentEn;
}
