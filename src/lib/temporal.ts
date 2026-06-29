/**
 * Temporal dimension for area datasets (ROADMAP O3.3 - time slider).
 *
 * A *temporal* choropleth is an ordinary {@link AreaDataset} whose rows carry a
 * **period column** (long/tidy form: one row per entity×period). The editor and
 * the published embed scrub the distinct periods with a slider (and a play
 * button), recolouring the same geometry per frame. Wide tables (one column per
 * year) are first melted to long form by {@link ./reshape} before they get here.
 *
 * This module is the pure, tested core: detect the period column, order the
 * frames chronologically, label them for humans, and slice the rows per frame.
 * It deliberately knows nothing about geometry or rendering.
 */

import { parsePeriod } from "./profile";

/**
 * A chronologically comparable number for a period label, or null if the label
 * is not a recognised period. Granularities are folded onto a single year-based
 * scale (year + month/12 + day/372) so that "2015_1" < "2015_2" < "2016",
 * "2024-03" < "2024-07", etc. all order correctly even when mixed.
 */
export function periodSortKey(label: string): number | null {
  const s = (label ?? "").trim();
  if (s === "") return null;

  // OMI-style semester: "2015_1" / "2015_2" (underscore breaks \b, handle first).
  let m = s.match(/^(\d{4})_([12])$/);
  if (m) return Number(m[1]) + (Number(m[2]) - 1) * 0.5;

  // ISO date: yyyy-mm-dd or yyyy-mm (optionally with time).
  m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (m) return year(m[1]) + mon(m[2]) + day(m[3]);

  // yyyy/mm.
  m = s.match(/^(\d{4})[/](\d{1,2})$/);
  if (m) return year(m[1]) + mon(m[2]);

  // dd/mm/yyyy or dd-mm-yyyy (2- or 4-digit year).
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return y + mon(m[2]) + day(m[1]);
  }

  // Semester / quarter with an embedded year ("2024 S1", "I semestre 2024").
  const yMatch = s.match(/(19|20)\d{2}/);
  if (yMatch) {
    const y = Number(yMatch[0]);
    if (/trim|\bQ[1-4]\b/i.test(s)) {
      const q = s.match(/\bQ([1-4])\b/i) || s.match(/\b(I{1,3}V?|IV)\b/);
      const qn = q ? romanOrNum(q[1]) : null;
      if (qn) return y + (qn - 1) * 0.25;
    }
    const sem = s.match(/(?:_|\bS|sem(?:estre)?\.?\s*)([12])\b/i) || s.match(/\b(I{1,2})\b/);
    if (sem && /sem|\bS[12]\b|\bI{1,2}\b/i.test(s)) {
      const h = sem[1] === "II" || sem[1] === "2" ? 2 : 1;
      return y + (h - 1) * 0.5;
    }
  }

  // Year only.
  if (/^\d{4}$/.test(s)) {
    const y = Number(s);
    if (y >= 1850 && y <= 2100) return y;
  }
  return null;
}

function year(y: string): number {
  return Number(y);
}
function mon(mm: string | undefined): number {
  if (!mm) return 0;
  const m = Math.min(12, Math.max(1, Number(mm)));
  return (m - 1) / 12;
}
function day(dd: string | undefined): number {
  if (!dd) return 0;
  const d = Math.min(31, Math.max(1, Number(dd)));
  return (d - 1) / 372;
}
function romanOrNum(token: string): number | null {
  const map: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };
  if (map[token]) return map[token];
  const n = Number(token);
  return n >= 1 && n <= 4 ? n : null;
}

/**
 * Order distinct period labels chronologically (oldest → newest). Recognised
 * periods sort by their {@link periodSortKey}; anything unrecognised sorts after
 * them, alphabetically, so the result is always deterministic.
 */
export function orderFrames(frames: Iterable<string>): string[] {
  const distinct = [...new Set([...frames].map((f) => f.trim()).filter((f) => f !== ""))];
  return distinct.sort((a, b) => {
    const ka = periodSortKey(a);
    const kb = periodSortKey(b);
    if (ka != null && kb != null) return ka - kb || a.localeCompare(b);
    if (ka != null) return -1;
    if (kb != null) return 1;
    return a.localeCompare(b);
  });
}

/**
 * Human label for a period: OMI-style "2015_1" → "2015 S1"; everything else is
 * returned trimmed as-is (ISO dates, plain years, month names stay readable).
 */
export function frameLabel(label: string): string {
  const s = (label ?? "").trim();
  const sem = s.match(/^(\d{4})_([12])$/);
  if (sem) return `${sem[1]} S${sem[2]}`;
  return s;
}

/** Distinct, chronologically ordered period values present in a column. */
export function framesOf(rows: Record<string, string>[], timeColumn: string): string[] {
  return orderFrames(rows.map((r) => r[timeColumn] ?? ""));
}

/** Rows belonging to one frame (period value matches, trimmed). */
export function rowsForFrame(
  rows: Record<string, string>[],
  timeColumn: string,
  frame: string,
): Record<string, string>[] {
  const f = frame.trim();
  return rows.filter((r) => (r[timeColumn] ?? "").trim() === f);
}

/**
 * Detect a period column suitable for a time slider: most of its values parse
 * as a period AND it has ≥2 distinct frames (otherwise a slider is pointless).
 * Columns in `exclude` (e.g. the geo key / value column) are skipped. Returns
 * the best column name (the one with the most distinct frames) or null.
 */
export function detectTimeColumn(
  columns: string[],
  rows: Record<string, string>[],
  exclude: string[] = [],
): string | null {
  const skip = new Set(exclude);
  const sample = rows.slice(0, 2000);
  let best: { col: string; frames: number } | null = null;

  for (const col of columns) {
    if (skip.has(col)) continue;
    let parsed = 0;
    let nonEmpty = 0;
    const distinct = new Set<string>();
    for (const r of sample) {
      const v = (r[col] ?? "").trim();
      if (v === "") continue;
      nonEmpty += 1;
      if (parsePeriod(v) != null) {
        parsed += 1;
        distinct.add(v);
      }
    }
    if (nonEmpty === 0) continue;
    // Require a strong majority of period-like values and ≥2 frames.
    if (parsed / nonEmpty >= 0.8 && distinct.size >= 2) {
      if (!best || distinct.size > best.frames) best = { col, frames: distinct.size };
    }
  }
  return best?.col ?? null;
}
