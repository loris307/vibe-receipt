import { de } from "./de.js";
import { en } from "./en.js";
import type { Strings } from "./en.js";

export type Lang = "en" | "de";

/**
 * Pick output language. An explicit `--lang` flag wins; otherwise auto-detect
 * from the user's locale env vars (LANG, LC_ALL, LC_MESSAGES). Anything
 * starting with `de` (de_DE.UTF-8, de_AT, de_CH, etc.) → German; else English.
 */
export function pickLang(explicit?: string | null): Lang {
  if (explicit === "de" || explicit === "en") return explicit;
  const envLocale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "";
  const norm = envLocale.toLowerCase();
  if (norm.startsWith("de") || norm.startsWith("de_")) return "de";
  return "en";
}

export function strings(lang: Lang): Strings {
  return lang === "de" ? de : en;
}

export type { Strings };
