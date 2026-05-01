import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  outDir: "dist",
  target: "node20",
  clean: true,
  shims: true,
  sourcemap: true,
  external: [
    "@resvg/resvg-js",
    "ccusage",
    "@ccusage/codex",
  ],
});
