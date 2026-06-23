import { useEffect, useMemo, useRef, useState } from "react";
import type * as Plot from "@observablehq/plot";
import { useStudio } from "../studio/StudioContext";
import { COLOR_SCALES } from "../studio/catalog";
import { DataTableView } from "./DataTableView";
import {
  chartColumnRoles,
  resolveChartAxes,
  buildChartPoints,
  aggregatePoints,
  sortPointsByValue,
  isChartType,
  type ChartPoint,
} from "../lib/chart-data";

/** Observable Plot is loaded lazily so it stays out of the initial bundle. */
type PlotModule = typeof import("@observablehq/plot");
let plotPromise: Promise<PlotModule> | null = null;
function loadPlot(): Promise<PlotModule> {
  if (!plotPromise) plotPromise = import("@observablehq/plot");
  return plotPromise;
}

/** Italian number formatting — identical to the choropleth tooltip/legend. */
const fmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

/** Minimal HTML escaping for tooltip content (mirrors MapPreview). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Format a numeric value the choropleth way: IT number + optional unit. */
function formatValue(n: number, unit: string): string {
  return `${fmt.format(n)}${unit ? `\u00a0${unit}` : ""}`;
}

/**
 * Central canvas for chart visualisations (bar/line/area/scatter) and the rich
 * table. Mirrors `MapCanvas`'s role for maps: reads the Studio context, prepares
 * the data with the pure `lib/chart-data` core, and renders. Charts use
 * Observable Plot (lazy); the table is plain HTML. The title/subtitle overlay
 * matches the map for a consistent editor look, and the root node is exposed via
 * `exportNodeRef` for PNG export.
 */
export function ChartCanvas() {
  const { project, vizType, design, data, exportNodeRef } = useStudio();

  const scale =
    COLOR_SCALES.find((s) => s.id === design.colorScale) ?? COLOR_SCALES[0];
  const scaleColors = design.reverseScale
    ? [...scale.colors].reverse()
    : scale.colors;

  if (!data) return null;

  return (
    <div
      ref={(node) => {
        exportNodeRef.current = node;
      }}
      className="relative flex h-full w-full flex-col overflow-hidden bg-white"
    >
      {design.showTitle && (
        <div className="flex-shrink-0 px-6 pt-5">
          <h2
            className="text-lg font-semibold leading-tight text-slate-900"
            style={{ fontFamily: design.titleFont }}
          >
            {project.title || "Grafico senza titolo"}
          </h2>
          {project.subtitle && (
            <p
              className="mt-1 text-sm text-slate-600"
              style={{ fontFamily: design.titleFont }}
            >
              {project.subtitle}
            </p>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 p-6">
        {vizType === "table" ? (
          <DataTableView columns={data.columns} rows={data.rows} />
        ) : isChartType(vizType) ? (
          <PlotView
            data={data}
            vizType={vizType}
            design={design}
            colors={scaleColors}
          />
        ) : (
          <p className="grid h-full place-items-center text-center text-sm text-slate-400">
            Scegli un grafico (barre, linee, aree, dispersione) o la tabella
            nel passo “Visualizza”.
          </p>
        )}
      </div>

      {design.showSource && project.source && (
        <div className="flex-shrink-0 px-6 pb-4">
          <p className="text-[11px] text-slate-400">{project.source}</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Plot view -------------------------------- */

interface PlotViewProps {
  data: { columns: string[]; rows: Record<string, string>[] };
  vizType: string;
  design: {
    chartX: string;
    chartY: string;
    chartSeries: string;
    chartSortByValue: boolean;
    valueLabel: string;
    valueUnit: string;
    tooltip: boolean;
    showLegend: boolean;
  };
  colors: string[];
}

function PlotView({ data, vizType, design, colors }: PlotViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 640, h: 400 });
  const [plot, setPlot] = useState<PlotModule | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load Plot once.
  useEffect(() => {
    let cancelled = false;
    loadPlot()
      .then((m) => !cancelled && setPlot(m))
      .catch(() => !cancelled && setError("Impossibile caricare il motore grafici."));
    return () => {
      cancelled = true;
    };
  }, []);

  // Track the container size so the chart fills the available area responsively.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: Math.max(200, r.width), h: Math.max(160, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Prepare the typed, aggregated points for the chosen axes.
  const prepared = useMemo(() => {
    const roles = chartColumnRoles(data.columns, data.rows);
    const axes = resolveChartAxes(vizType, roles, design);
    if (!axes.x || !axes.y) {
      return { axes, points: [] as ChartPoint[], ok: false };
    }
    const isScatter = vizType === "scatter";
    let points = buildChartPoints(data.rows, axes, { numericX: isScatter });
    if (!isScatter) {
      points = aggregatePoints(points);
      if (design.chartSortByValue && !axes.series) points = sortPointsByValue(points);
    }
    return { axes, points, ok: points.length > 0 };
  }, [data, vizType, design]);

  // Render the Plot figure into the host, with a custom tooltip identical to
  // the choropleth (name + value, IT number + unit).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !plot || !prepared.ok) return;
    const { points, axes } = prepared;
    const isScatter = vizType === "scatter";
    const hasSeries = points.some((p) => p.series != null);
    const baseColor = colors[colors.length - 1] ?? "#01646f";

    const xLabel = axes.x;
    const yLabel = design.valueLabel || axes.y;
    const unit = design.valueUnit;
    const yAxisLabel = unit ? `${yLabel} (${unit})` : yLabel;

    const marks: unknown[] = [plot.ruleY([0])];

    if (vizType === "bar") {
      marks.push(
        plot.barY(points, { x: "x", y: "y", fill: hasSeries ? "series" : baseColor }),
      );
    } else if (vizType === "line") {
      marks.push(
        plot.line(points, {
          x: "x",
          y: "y",
          stroke: hasSeries ? "series" : baseColor,
          strokeWidth: 2,
          z: hasSeries ? "series" : undefined,
        }),
        plot.dot(points, {
          x: "x",
          y: "y",
          fill: hasSeries ? "series" : baseColor,
          r: 2,
        }),
      );
    } else if (vizType === "area") {
      marks.push(
        plot.areaY(points, {
          x: "x",
          y: "y",
          fill: hasSeries ? "series" : baseColor,
          fillOpacity: hasSeries ? 0.6 : 0.85,
          z: hasSeries ? "series" : undefined,
        }),
      );
    } else if (vizType === "scatter") {
      marks.push(
        plot.dot(points, { x: "x", y: "y", fill: hasSeries ? "series" : baseColor, r: 4 }),
      );
    }

    // Pointer-driven highlight that also makes `figure.value` track the nearest
    // datum, which we read to drive the custom HTML tooltip. 2D nearest for
    // scatter/multi-series, x-nearest for single-series bar/line/area.
    if (design.tooltip) {
      const pointer = isScatter || hasSeries ? plot.pointer : plot.pointerX;
      marks.push(
        plot.dot(
          points,
          pointer({
            x: "x",
            y: "y",
            fill: hasSeries ? "series" : baseColor,
            stroke: "white",
            strokeWidth: 1.5,
            r: 5,
          }),
        ),
      );
    }

    const figure = plot.plot({
      width: size.w,
      height: size.h,
      marginLeft: 64,
      marginBottom: 56,
      marginTop: 16,
      style: { background: "transparent", fontFamily: "inherit", fontSize: "12px" },
      x: {
        label: xLabel,
        tickRotate: vizType === "bar" && points.length > 6 ? -35 : 0,
        tickFormat: isScatter ? (d: number) => fmt.format(d) : undefined,
      },
      y: { label: yAxisLabel, grid: true, tickFormat: (d: number) => fmt.format(d) },
      color: hasSeries ? { legend: design.showLegend, range: colors } : undefined,
      marks: marks as Plot.Markish[],
    });

    host.replaceChildren(figure);

    // Custom tooltip wiring (only when tooltips are enabled).
    if (design.tooltip) {
      const tip = tipRef.current;
      const container = containerRef.current;
      const fig = figure as HTMLElement & { value?: ChartPoint | null };

      const showTip = () => {
        const d = fig.value;
        if (!tip || !d) {
          if (tip) tip.style.opacity = "0";
          return;
        }
        const name = isScatter
          ? d.series != null
            ? escapeHtml(String(d.series))
            : ""
          : d.series != null
            ? `${escapeHtml(String(d.x))} · ${escapeHtml(String(d.series))}`
            : escapeHtml(String(d.x));
        let html = name ? `<div class="studio-tooltip-name">${name}</div>` : "";
        if (isScatter) {
          html +=
            `<div class="studio-tooltip-value"><span>${escapeHtml(xLabel)}</span> ${escapeHtml(formatValue(Number(d.x), ""))}</div>` +
            `<div class="studio-tooltip-value"><span>${escapeHtml(yLabel)}</span> ${escapeHtml(formatValue(d.y, unit))}</div>`;
        } else {
          html += `<div class="studio-tooltip-value"><span>${escapeHtml(yLabel)}</span> ${escapeHtml(formatValue(d.y, unit))}</div>`;
        }
        tip.innerHTML = html;
        tip.style.opacity = "1";
      };
      const moveTip = (e: PointerEvent) => {
        if (!tip || !container) return;
        const r = container.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        // Flip to the left near the right edge to avoid overflow.
        const flip = x > r.width - 160;
        tip.style.left = `${flip ? x - 14 : x + 14}px`;
        tip.style.top = `${y + 14}px`;
        tip.style.transform = flip ? "translateX(-100%)" : "none";
      };
      const hideTip = () => {
        if (tip) tip.style.opacity = "0";
      };
      fig.addEventListener("input", showTip);
      figure.addEventListener("pointermove", moveTip as EventListener);
      figure.addEventListener("pointerleave", hideTip);
      return () => {
        fig.removeEventListener("input", showTip);
        figure.removeEventListener("pointermove", moveTip as EventListener);
        figure.removeEventListener("pointerleave", hideTip);
        host.replaceChildren();
      };
    }

    return () => {
      host.replaceChildren();
    };
  }, [plot, prepared, size, vizType, colors, design.valueLabel, design.valueUnit, design.tooltip, design.showLegend]);

  if (error) {
    return <p className="text-sm text-amber-700">{error}</p>;
  }
  if (!prepared.ok) {
    return (
      <p className="grid h-full place-items-center text-sm text-slate-400">
        Scegli le colonne per gli assi nel passo “Design”.
      </p>
    );
  }
  return (
    <div ref={containerRef} className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      <div ref={tipRef} className="studio-chart-tip" style={{ opacity: 0 }} />
    </div>
  );
}
