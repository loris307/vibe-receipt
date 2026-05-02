import satori, { type SatoriOptions } from "satori";
import { Resvg } from "@resvg/resvg-js";
import * as React from "react";
import type { Receipt } from "../data/receipt-schema.js";
import type { Strings } from "../i18n/index.js";
import { VibeCard } from "./card.js";
import { loadFonts } from "./theme.js";
import type { SizePreset } from "./sizes.js";
import { SIZES, resolveHeight } from "./sizes.js";

export interface RenderPngOpts {
  receipt: Receipt;
  s: Strings;
  size: SizePreset;
}

function satoriFonts(): SatoriOptions["fonts"] {
  return loadFonts().map((f) => ({
    name: f.name,
    data: f.data,
    weight: f.weight as 400 | 700,
    style: f.style,
  }));
}

export async function renderPng(opts: RenderPngOpts): Promise<Buffer> {
  const dim = SIZES[opts.size];
  const height = resolveHeight(opts.receipt, opts.size);
  const element = React.createElement(VibeCard, {
    receipt: opts.receipt,
    s: opts.s,
    size: opts.size,
    height,
  });
  const svg = await satori(element, {
    width: dim.width,
    height,
    fonts: satoriFonts(),
  });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      loadSystemFonts: false,
      defaultFontFamily: "JetBrainsMono",
    },
  });
  const png = resvg.render().asPng();
  return Buffer.from(png);
}

export async function renderSvg(opts: RenderPngOpts): Promise<string> {
  const dim = SIZES[opts.size];
  const height = resolveHeight(opts.receipt, opts.size);
  const element = React.createElement(VibeCard, {
    receipt: opts.receipt,
    s: opts.s,
    size: opts.size,
    height,
  });
  return satori(element, {
    width: dim.width,
    height,
    fonts: satoriFonts(),
  });
}
