/**
 * Ready-made newsroom brand presets for Zornade Studio.
 *
 * `ZORNADE` uses Zornade's own brand color (the teal `--primary` from the main
 * site: hsl(185 55% 44%) = #32a4ae). Newsroom presets are added here as each
 * redazione onboards; until a client supplies official brand colors (and, later,
 * fonts), use a documented placeholder and flag it with a TODO.
 */

import { type NewsroomBrand } from "./flavors";

/** Zornade default - used for our own embeds and as the fallback theme. */
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
  accent: "#c8102e", // placeholder editorial red - confirm with the newsroom
  variant: "carta",
  tintStrength: 0.4,
  tintWater: false,
};

/**
 * Corriere della Sera - historic serif daily, black masthead.
 * TODO: confirm the official brand color with the newsroom.
 */
export const CORRIERE: NewsroomBrand = {
  accent: "#0a3d62", // placeholder deep navy - confirm with the newsroom
  variant: "carta",
  tintStrength: 0.35,
  tintWater: false,
};

/**
 * Internazionale - weekly with a bold red identity, clean layout.
 * TODO: confirm the official brand color with the newsroom.
 */
export const INTERNAZIONALE: NewsroomBrand = {
  accent: "#e2001a", // placeholder editorial red - confirm with the newsroom
  variant: "positron",
  tintStrength: 0.35,
  tintWater: false,
};

/**
 * L'Indipendente - independent outlet with a dark/red identity.
 * TODO: confirm the official brand color with the newsroom.
 */
export const INDIPENDENTE: NewsroomBrand = {
  accent: "#b01e2e", // placeholder crimson - confirm with the newsroom
  variant: "ardesia",
  tintStrength: 0.4,
  tintWater: false,
};

export const PRESETS = {
  zornade: ZORNADE,
  corriere: CORRIERE,
  internazionale: INTERNAZIONALE,
  indipendente: INDIPENDENTE,
  altreconomia: ALTRECONOMIA,
} as const;

export type PresetName = keyof typeof PRESETS;
