/**
 * Zornade Studio basemap flavors.
 *
 * Four neutral, editorial "moods" in the Positron family, built on top of the
 * canonical Protomaps flavors. Each is intentionally desaturated so that the
 * DATA layer (choropleth / points, which use the newsroom's brand color ramp)
 * stays the visual hero.
 *
 * The newsroom's brand color is NOT baked into these bases: it is layered on
 * top - tastefully and configurably - by {@link makeFlavor}. This keeps the
 * basemap legible while letting each redazione's identity come through on
 * admin borders, place labels and (optionally) water.
 */

import { type Flavor, WHITE, DARK } from "@protomaps/basemaps";
import { type Hex, mix, adjust } from "./colors";

export type VariantName = "positron" | "carta" | "ardesia" | "inchiostro";

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** positron - clean light grey-white. The default; the look you already use. */
const POSITRON: Flavor = {
  ...WHITE,
  earth: "#fbfbfb",
  water: "#d5dde0",
  park_a: "#eef2ee",
  park_b: "#e7eee8",
  wood_a: "#eef2ee",
  wood_b: "#e7eee8",
  scrub_a: "#eef1ee",
  scrub_b: "#e9efe9",
  buildings: "#ededed",
  boundaries: "#c2c8cc",
};

/** carta - warm off-white "paper", for editorial/print-feeling pieces. */
const CARTA: Flavor = {
  ...WHITE,
  earth: "#f7f4ee",
  water: "#dfe3e2",
  park_a: "#eef0e6",
  park_b: "#e6ebdd",
  wood_a: "#eef0e6",
  wood_b: "#e6ebdd",
  scrub_a: "#eef0e6",
  scrub_b: "#e8ecdf",
  buildings: "#efece5",
  boundaries: "#cfc7ba",
};

/** ardesia - cool slate grey, the greyer Positron cousin. */
const ARDESIA: Flavor = {
  ...WHITE,
  earth: "#eef1f2",
  water: "#cfd6d9",
  park_a: "#e6ebe8",
  park_b: "#dde6e0",
  wood_a: "#e6ebe8",
  wood_b: "#dde6e0",
  scrub_a: "#e6ebe8",
  scrub_b: "#dfe6e2",
  buildings: "#e3e6e8",
  boundaries: "#b7bfc4",
};

/** inchiostro - dark "ink" mode for newsrooms with a dark identity. */
const INCHIOSTRO: Flavor = {
  ...DARK,
  water: "#2b2f33",
  boundaries: "#5a5f66",
};

const VARIANTS: Record<VariantName, Flavor> = {
  positron: POSITRON,
  carta: CARTA,
  ardesia: ARDESIA,
  inchiostro: INCHIOSTRO,
};

/** Return a full, untinted base flavor by name. */
export function baseVariant(name: VariantName): Flavor {
  return VARIANTS[name];
}

export interface NewsroomBrand {
  /**
   * Primary brand color (hex). Drives the subtle basemap accents below and is
   * also the anchor color for the data layers and UI chrome elsewhere.
   */
  accent: Hex;
  /** Visual mood of the basemap. Default: "positron". */
  variant?: VariantName;
  /**
   * How strongly the brand color tints the basemap (admin borders, place
   * labels and - if enabled - water). Range [0, 1]. Default: 0.35 (subtle).
   */
  tintStrength?: number;
  /**
   * Tint the water toward the brand color. Default: false, so water stays
   * neutral and the data layer reads clearly on top.
   */
  tintWater?: boolean;
  /**
   * Font stack names. Must exist in the glyphs endpoint used by the style.
   * Default: Protomaps' bundled Noto Sans. Newsrooms will later supply their
   * own self-hosted fonts here.
   */
  fonts?: { regular: string; bold: string; italic: string };
}

/**
 * Build a brand-aware Protomaps flavor for a newsroom.
 *
 * Starts from a neutral editorial base and layers the newsroom's `accent`
 * onto a few carefully chosen elements only. Roads, buildings and landcover
 * stay neutral on purpose, so the choropleth/data layer remains the focus.
 */
export function makeFlavor(brand: NewsroomBrand): Flavor {
  const variant = brand.variant ?? "positron";
  const base = baseVariant(variant);
  const k = clamp01(brand.tintStrength ?? 0.35);
  const isDark = variant === "inchiostro";

  // A muted version of the accent for fills/lines, and a readable "ink" version
  // (lighter on dark backgrounds, darker on light) for label text.
  const softAccent = adjust(brand.accent, { desaturate: 0.25 });
  const inkAccent = adjust(brand.accent, {
    lighten: isDark ? 0.15 : -0.18,
    desaturate: 0.15,
  });

  const flavor: Flavor = {
    ...base,
    // Administrative borders pick up a hint of the brand color.
    boundaries: mix(base.boundaries, softAccent, k * 0.7),
    // Place labels get a subtle branded ink.
    city_label: mix(base.city_label, inkAccent, k * 0.5),
    state_label: mix(base.state_label, inkAccent, k * 0.4),
    country_label: mix(base.country_label, inkAccent, k * 0.4),
    regular: brand.fonts?.regular ?? base.regular ?? "Noto Sans Regular",
    bold: brand.fonts?.bold ?? base.bold ?? "Noto Sans Medium",
    italic: brand.fonts?.italic ?? base.italic ?? "Noto Sans Italic",
  };

  if (brand.tintWater) {
    flavor.water = mix(base.water, softAccent, k * 0.3);
  }

  return flavor;
}
