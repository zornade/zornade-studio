/**
 * Reset column-dependent design settings when a NEW dataset replaces an
 * existing one (Studio's "cambia dati" flow - roadmap 2026-07-07).
 *
 * Rationale (confirmed against how Datawrapper/Flourish handle re-uploaded
 * data, DuckDuckGo research 2026-07-07): a chart's column *bindings* only
 * remain valid if the referenced column still exists in the new data -
 * Flourish's own binding functions error out ("Error if column names don't
 * exist") rather than silently keep a stale reference, and Datawrapper
 * explicitly re-checks column mappings whenever the underlying table
 * changes. We apply the same principle here: a design field that stores a
 * COLUMN NAME (chartX, flowFromLat, bivariateColumn2...) is cleared if that
 * column doesn't exist in the new dataset, but kept unchanged if a column of
 * the same name is still present (e.g. re-uploading a corrected version of
 * the same file) - exactly the "keep matching bindings, drop the rest"
 * behaviour those tools implement.
 *
 * `manualBreaks` is a special case: it stores raw NUMERIC thresholds derived
 * from the old dataset's value distribution, not a column name - keeping the
 * column name mapped to the same "valueColumn" tells us nothing about
 * whether the old thresholds still make sense for the new values (e.g.
 * population counts vs. house prices, or the same "popolazione" column
 * across two very different territories). It is therefore ALWAYS cleared on
 * a real replacement, never preserved. `classification` itself is left
 * untouched even when set to "manual": `computeBreaks` already degrades
 * gracefully to "no classes (single colour)" for empty thresholds (see
 * lib/choropleth.ts manualBreaks()), so nothing breaks - the operator just
 * sees a single-colour map and can pick new breaks or a different method.
 *
 * Purely stylistic fields (colours, fonts, basemap, legend type, toggles...)
 * are never touched here - see the classification table in
 * /memories/repo/zornade-studio-oss-own-project-2026-07-06.md-adjacent
 * research notes for the full field-by-field rationale.
 */

import type { DatasetState, DesignSettings } from "./types";
import { templateColumns } from "../lib/tooltip";

/** The single numeric column a dataset is mapped/sized by, if any (kind-dependent). */
function primaryValueColumn(data: DatasetState | null): string | null {
  if (!data) return null;
  if (data.kind === "area" || data.kind === "point" || data.kind === "geo") {
    return data.valueColumn || null;
  }
  return null; // "table" has no single value column (charts pick columns freely)
}

/**
 * Recompute `design` after `nextData` replaces `prevData`. Returns `design`
 * unchanged (same reference) when `prevData` is null - i.e. the very first
 * dataset load, nothing to clean up yet.
 */
export function resetDesignForNewData(
  design: DesignSettings,
  prevData: DatasetState | null,
  nextData: DatasetState | null,
): DesignSettings {
  if (!prevData) return design;

  const nextColumns = new Set(nextData?.columns ?? []);
  /** A column reference is still valid if empty (unset) or present in the new data. */
  const stillValid = (column: string) => column === "" || nextColumns.has(column);

  const valueColumnChanged = primaryValueColumn(prevData) !== primaryValueColumn(nextData);

  const bivariateColumn2 = stillValid(design.bivariateColumn2) ? design.bivariateColumn2 : "";
  const bivariateCleared = bivariateColumn2 !== design.bivariateColumn2;

  const tooltipStillValid =
    design.tooltipTemplate === "" ||
    templateColumns(design.tooltipTemplate).every((col) => nextColumns.has(col));

  return {
    ...design,
    // Always invalid: thresholds computed from the OLD value distribution.
    manualBreaks: [],
    chartX: stillValid(design.chartX) ? design.chartX : "",
    chartY: stillValid(design.chartY) ? design.chartY : "",
    chartSeries: stillValid(design.chartSeries) ? design.chartSeries : "",
    bivariateColumn2,
    flowFromLat: stillValid(design.flowFromLat) ? design.flowFromLat : "",
    flowFromLon: stillValid(design.flowFromLon) ? design.flowFromLon : "",
    flowToLat: stillValid(design.flowToLat) ? design.flowToLat : "",
    flowToLon: stillValid(design.flowToLon) ? design.flowToLon : "",
    flowValue: stillValid(design.flowValue) ? design.flowValue : "",
    tooltipTemplate: tooltipStillValid ? design.tooltipTemplate : "",
    // valueLabel/Unit describe whichever column is mapped: keep them only if
    // that column itself didn't change (free-typed by the user, e.g. "Popolazione").
    valueLabel: valueColumnChanged ? "" : design.valueLabel,
    valueUnit: valueColumnChanged ? "" : design.valueUnit,
    // The bivariate SECOND column/label travel together.
    valueLabel2: bivariateCleared ? "" : design.valueLabel2,
    valueUnit2: bivariateCleared ? "" : design.valueUnit2,
  };
}
