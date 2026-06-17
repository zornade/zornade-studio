/**
 * Reader-facing class filter for choropleths (ROADMAP O2.8 — reader controls).
 *
 * When the operator enables reader filters, the published legend becomes
 * clickable: the reader hides/shows value classes. This module turns the set of
 * hidden class indices into a MapLibre filter expression applied to the data
 * layers, so the interaction works identically in the editor and the embed.
 *
 * A choropleth with `breaks` of length B has B+1 classes; class `i` covers
 * `[lo_i, hi_i)` where `lo_0 = -∞` and `hi_B = +∞`. A feature is hidden when it
 * has a numeric `__value` that falls in a hidden class. Features without a value
 * (no-data) are always kept — they are context, not a class.
 *
 * Pure & dependency-free → unit-tested and reusable.
 */

/** Lower/upper bound of class `i` given the break thresholds. */
function classBounds(breaks: number[], i: number): [number, number] {
  const lo = i === 0 ? -Infinity : breaks[i - 1];
  const hi = i >= breaks.length ? Infinity : breaks[i];
  return [lo, hi];
}

/** MapLibre test expression "value is in class i" for the given bounds. */
function inClass(lo: number, hi: number): unknown {
  const v = ["to-number", ["get", "__value"]];
  if (lo === -Infinity) return ["<", v, hi];
  if (hi === Infinity) return [">=", v, lo];
  return ["all", [">=", v, lo], ["<", v, hi]];
}

/**
 * Build a MapLibre filter that **hides** the given class indices. Returns
 * `null` when nothing is hidden (caller should clear the filter). Features
 * without `__value` are always shown.
 *
 * @param breaks strictly-ascending class thresholds (length = nClasses - 1)
 * @param hidden class indices to hide (0 = lowest class)
 */
export function buildClassVisibilityFilter(
  breaks: number[],
  hidden: Iterable<number>,
): unknown | null {
  const hiddenList = [...hidden].filter(
    (i) => Number.isInteger(i) && i >= 0 && i <= breaks.length,
  );
  if (hiddenList.length === 0) return null;

  const hiddenTests = hiddenList.map((i) => {
    const [lo, hi] = classBounds(breaks, i);
    return inClass(lo, hi);
  });
  const inAnyHidden =
    hiddenTests.length === 1 ? hiddenTests[0] : ["any", ...hiddenTests];

  // Show a feature unless it has a value that lands in a hidden class.
  return ["!", ["all", ["has", "__value"], inAnyHidden]];
}

/** Human label for class `i`, e.g. "< 10", "10 – 20", "≥ 90". */
export function classLabel(
  breaks: number[],
  i: number,
  fmt: (n: number) => string,
): string {
  const [lo, hi] = classBounds(breaks, i);
  if (lo === -Infinity) return `< ${fmt(hi)}`;
  if (hi === Infinity) return `≥ ${fmt(lo)}`;
  return `${fmt(lo)} – ${fmt(hi)}`;
}
