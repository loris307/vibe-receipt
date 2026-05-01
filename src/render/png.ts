import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import * as React from "react";
import type { Receipt } from "../data/receipt-schema.js";
import type { Strings } from "../i18n/index.js";
import { VibeCard } from "./card.js";
import { loadFonts } from "./theme.js";
import type { SizePreset } from "./sizes.js";
import { SIZES } from "./sizes.js";

export interface RenderPngOpts {
  receipt: Receipt;
  s: Strings;
  size: SizePreset;
}

export async function renderPng(opts: RenderPngOpts): Promise<Buffer> {
  const dim = SIZES[opts.size];
  const fonts = loadFonts();
  const element = React.createElement(VibeCard, {
    receipt: opts.receipt,
    s: opts.s,
    size: opts.size,
  });
  const svg = await satori(element, {
    width: dim.width,
    height: dim.height,
    fonts,
  });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      fontBuffers: fonts.map((f) => f.data),
      defaultFontFamily: "JetBrainsMono",
    },
  });
  const png = resvg.render().asPng();
  return Buffer.from(png);
}

export async function renderSvg(opts: RenderPngOpts): Promise<string> {
  const dim = SIZES[opts.size];
  const fonts = loadFonts();
  const element = React.createElement(VibeCard, {
    receipt: opts.receipt,
    s: opts.s,
    size: opts.size,
  });
  return satori(element, {
    width: dim.width,
    height: dim.height,
    fonts,
  });
}
