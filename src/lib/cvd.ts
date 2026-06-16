/**
 * Colour-vision-deficiency (CVD) simulation (ROADMAP O2.7).
 *
 * Uses the matrices of **Machado, Oliveira & Fernandes (2009)**, "A
 * Physiologically-based Model for Simulation of Color Vision Deficiency"
 * (severity 1.0), the de-facto standard embedded in many tools. The matrices'
 * rows sum to 1, so achromatic (grey) colours are preserved. This is an
 * **approximation** meant to *preview* how a palette reads to colour-blind
 * viewers — not a clinical tool.
 *
 * Design note: we deliberately do **not** auto-classify a palette as
 * "safe/unsafe" from a runtime metric. Empirically (redmean distance) no single
 * threshold separates documented-safe palettes (Okabe–Ito) from risky ones —
 * they overlap. So the editor's "colour-blind-safe" badge is driven by a
 * **curated flag** sourced from the published palettes (palettes.ts
 * `cvdSafe`), and this module provides the **visual simulation** so the operator
 * can verify with their own eyes. Honest > a fragile auto-verdict.
 *
 * Pure & dependency-free → unit-tested and reusable anywhere.
 */

export type CvdType = "protanopia" | "deuteranopia" | "tritanopia";

export interface CvdInfo {
  type: CvdType;
  label: string;
}

export const CVD_TYPES: CvdInfo[] = [
  { type: "protanopia", label: "Protanopia (rosso)" },
  { type: "deuteranopia", label: "Deuteranopia (verde)" },
  { type: "tritanopia", label: "Tritanopia (blu)" },
];

/** Machado et al. (2009) severity-1.0 matrices, applied to sRGB [0,1]. */
const MATRICES: Record<CvdType, number[]> = {
  protanopia: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882,
    -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182,
    0.04294, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733,
    0.691367, 0.3039,
  ],
};

type Rgb = [number, number, number];

/** Parse a #rrggbb hex into an [r,g,b] triple (0–255), or null. */
export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Format an [r,g,b] triple back to #rrggbb. */
export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Simulate how a single colour appears under the given CVD type. */
export function simulateCvd(hex: string, type: CvdType): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const m = MATRICES[type];
  const [r, g, b] = rgb;
  return rgbToHex([
    m[0] * r + m[1] * g + m[2] * b,
    m[3] * r + m[4] * g + m[5] * b,
    m[6] * r + m[7] * g + m[8] * b,
  ]);
}

/** Simulate a whole palette under one CVD type. */
export function simulatePalette(colors: string[], type: CvdType): string[] {
  return colors.map((c) => simulateCvd(c, type));
}

/**
 * Perceptual-ish colour distance ("redmean"): a cheap weighted-RGB metric that
 * tracks human perception better than plain Euclidean RGB. Range ~0..765.
 * Exposed for callers that want a rough difference (not used to auto-classify
 * palettes — see the design note above).
 */
export function colorDistance(a: string, b: string): number {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return 0;
  const rmean = (ca[0] + cb[0]) / 2;
  const dr = ca[0] - cb[0];
  const dg = ca[1] - cb[1];
  const db = ca[2] - cb[2];
  return Math.sqrt(
    (2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db,
  );
}

