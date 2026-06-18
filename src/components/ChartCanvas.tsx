import { useEffect, useMemo, useRef, useState } from "react";
import type * as Plot from "@observablehq/plot";
import { useStudio } from "../studio/StudioContext";
import { COLOR_SCALES } from "../studio/catalog";
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
          <TableView data={data} />
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
  };
  colors: string[];
}

function PlotView({ data, vizType, design, colors }: PlotViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
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

  // Render the Plot figure into the container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !plot || !prepared.ok) return;
    const { points, axes } = prepared;
    const hasSeries = points.some((p) => p.series != null);

    const yLabel = design.valueLabel || axes.y;
    const marks: unknown[] = [plot.ruleY([0])];
    const baseColor = colors[colors.length - 1] ?? "#01646f";

    if (vizType === "bar") {
      marks.push(
        plot.barY(points, {
          x: "x",
          y: "y",
          fill: hasSeries ? "series" : baseColor,
          tip: true,
        }),
      );
    } else if (vizType === "line") {
      marks.push(
        plot.line(points, {
          x: "x",
          y: "y",
          stroke: hasSeries ? "series" : baseColor,
          strokeWidth: 2,
          tip: true,
        }),
        plot.dot(points, { x: "x", y: "y", fill: hasSeries ? "series" : baseColor, r: 2.5 }),
      );
    } else if (vizType === "area") {
      marks.push(
        plot.areaY(points, {
          x: "x",
          y: "y",
          fill: hasSeries ? "series" : baseColor,
          fillOpacity: hasSeries ? 0.7 : 0.85,
          tip: true,
        }),
      );
    } else if (vizType === "scatter") {
      marks.push(
        plot.dot(points, {
          x: "x",
          y: "y",
          fill: hasSeries ? "series" : baseColor,
          r: 4,
          tip: true,
        }),
      );
    }

    const figure = plot.plot({
      width: size.w,
      height: size.h,
      marginLeft: 64,
      marginBottom: 56,
      style: { background: "transparent", fontFamily: "inherit", fontSize: "12px" },
      x: {
        label: axes.x,
        tickRotate: vizType === "bar" && points.length > 6 ? -35 : 0,
      },
      y: { label: yLabel, grid: true },
      color: hasSeries
        ? { legend: true, scheme: undefined, range: colors }
        : undefined,
      marks: marks as Plot.Markish[],
    });

    el.replaceChildren(figure);
    return () => {
      el.replaceChildren();
    };
  }, [plot, prepared, size, vizType, colors, design.valueLabel]);

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
  return <div ref={containerRef} className="h-full w-full" />;
}

/* ------------------------------- Table view ------------------------------- */

function TableView({
  data,
}: {
  data: { columns: string[]; rows: Record<string, string>[] };
}) {
  const MAX = 500;
  const shown = data.rows.slice(0, MAX);
  return (
    <div className="h-full overflow-auto rounded-lg ring-1 ring-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-slate-50">
          <tr>
            {data.columns.map((c) => (
              <th
                key={c}
                className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} className="odd:bg-white even:bg-slate-50/60">
              {data.columns.map((c) => (
                <td key={c} className="border-b border-slate-100 px-3 py-1.5 text-slate-600">
                  {row[c]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.rows.length > MAX && (
        <p className="px-3 py-2 text-[11px] text-slate-400">
          Mostrate le prime {MAX} righe di {data.rows.length}.
        </p>
      )}
    </div>
  );
}
