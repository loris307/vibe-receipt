export type SizePreset = "portrait" | "story" | "og";

export interface SizeSpec {
  width: number;
  height: number;
  /** Padding overrides for very-narrow OG card. */
  paddingX?: number;
  paddingY?: number;
}

export const SIZES: Record<SizePreset, SizeSpec> = {
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  og: { width: 1200, height: 630, paddingX: 48, paddingY: 36 },
};

export function parseSizeFlag(input: string | undefined): SizePreset[] {
  if (!input) return ["portrait"];
  const tokens = input
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.includes("all")) return ["portrait", "story", "og"];
  const out: SizePreset[] = [];
  for (const t of tokens) {
    if (t === "portrait" || t === "story" || t === "og") out.push(t as SizePreset);
  }
  return out.length > 0 ? out : ["portrait"];
}
