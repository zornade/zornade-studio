/**
 * Ready-made newsroom brand presets for Zornade Studio.
 *
 * `ZORNADE` uses Zornade's own brand color (the teal `--primary` from the main
 * site: hsl(185 55% 44%) = #32a4ae). Newsroom presets are added here as each
 * redazione onboards; until a client supplies official brand colors (and, later,
 * fonts), use a documented placeholder and flag it with a TODO.
 */

import { type NewsroomBrand } from "./flavors";

/** Zornade default — used for our own embeds and as the fallback theme. */
export const ZORNADE: NewsroomBrand = {
  accent: "#32a4ae",
  variant: "positron",
  tintStrength: 0.35,
  tintWater: false,
};

/**
 * Altreconomia (pilot newsroom).
 * TODO: replace `accent` with the official Altreconomia brand color and add the
 * `fonts` stack once the newsroom provides its self-hosted fonts.
 */
export const ALTRECONOMIA: NewsroomBrand = {
  accent: "#c8102e", // placeholder editorial red — confirm with the newsroom
  variant: "carta",
  tintStrength: 0.4,
  tintWater: false,
};

export const PRESETS = {
  zornade: ZORNADE,
  altreconomia: ALTRECONOMIA,
} as const;

export type PresetName = keyof typeof PRESETS;
