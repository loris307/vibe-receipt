import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the bundled fonts dir. After tsdown build, the package layout is:
 *   dist/cli.mjs
 *   assets/fonts/*.ttf
 * In dev (tsx) the structure is:
 *   src/render/theme.ts
 *   assets/fonts/*.ttf
 * We try a couple of relative paths and pick the first that resolves.
 */
function resolveFontDir(): string {
  const candidates = [
    resolve(__dirname, "../../assets/fonts"),
    resolve(__dirname, "../assets/fonts"),
    resolve(process.cwd(), "assets/fonts"),
  ];
  for (const c of candidates) {
    try {
      readFileSync(resolve(c, "JetBrainsMono-Regular.ttf"));
      return c;
    } catch {
      // try next
    }
  }
  throw new Error(`vibe-receipt: bundled fonts not found. Looked in: ${candidates.join(", ")}`);
}

let _fonts: { name: string; data: Buffer; weight: number; style: "normal" | "italic" }[] | null =
  null;

export function loadFonts() {
  if (_fonts) return _fonts;
  const dir = resolveFontDir();
  _fonts = [
    {
      name: "JetBrainsMono",
      data: readFileSync(resolve(dir, "JetBrainsMono-Regular.ttf")),
      weight: 400,
      style: "normal",
    },
    {
      name: "JetBrainsMono",
      data: readFileSync(resolve(dir, "JetBrainsMono-Bold.ttf")),
      weight: 700,
      style: "normal",
    },
  ];
  return _fonts;
}

export function fontBuffersForResvg() {
  return loadFonts().map((f) => f.data);
}

export const theme = {
  bg: "#FAFAF7",
  ink: "#111111",
  inkSoft: "#444444",
  inkMuted: "#9A9A9A",
  divider: "#1A1A1A",
  accent: "#FF3D7F",
  accent2: "#FFB74A",
  accentGradient: "linear-gradient(90deg, #FF3D7F 0%, #FFB74A 100%)",
  scanlineColor: "rgba(0,0,0,0.04)",
  paddingX: 60,
  paddingY: 56,
  monoFamily: "JetBrainsMono",
  headingFamily: "JetBrainsMono",
} as const;
