import { en } from "./en.js";
import { de } from "./de.js";
import type { Strings } from "./en.js";

export type Lang = "en" | "de";

export function pickLang(explicit?: string | null): Lang {
  if (explicit === "de" || explicit === "en") return explicit;
  const sys = process.env.LANG ?? "";
  if (sys.toLowerCase().startsWith("de")) return "de";
  return "en";
}

export function strings(lang: Lang): Strings {
  return lang === "de" ? de : en;
}

export type { Strings };
