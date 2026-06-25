/**
 * Self-contained embed HTML generator for a published choropleth snapshot
 * (O1.5). Produces a single static HTML document that renders the map from its
 * spec, with the Zornade attribution baked in.
 *
 * "Works forever" choices:
 *  - MapLibre is loaded from a **version-pinned** CDN URL (immutable).
 *  - The spec is **inlined** as JSON (no runtime API dependency).
 *  - The geometry is fetched from a **pinned base URL** under our control
 *    (the published bucket), passed in as `geoBaseUrl`.
 *  - All user-controlled strings (title/subtitle/source) are **HTML-escaped**
 *    to prevent injection in the published artefact.
 */

import type { ChoroplethSpec, PointSpec, GeoSpec, ChartSpec, StorySpec, StoryBaseSpec, VizSpec } from "./spec";
import {
  computeBreaks,
  geoJoinFields,
  buildFillColorExpression,
  sampleColors,
  normaliseKey,
  DEFAULT_NO_DATA_COLOR,
  type ClassBreaks,
} from "./choropleth";
import { colorsForScale, resolveBasemap, BRAND_TEAL } from "../studio/palettes";
import { frameLabel } from "./temporal";
import {
  annotationsToGeoJson,
  markerAnnotations,
  sanitizeAnnotations,
} from "./annotations";
import { tercileClass, BIVARIATE_PALETTE } from "./bivariate";
import { buildHeatmapPaint } from "./heatmap";
import { hexbin } from "./hexbin";
import { buildPointColorExpression, buildPointRadiusExpression } from "./points";
import { accessibleTableHtml } from "./data-table";
import { skySpec, lightSpec } from "./map-style";
import type { AreaRender } from "./spec";

/**
 * Sky/light config inlined into every renderer, serialised once from the shared
 * map-style source so the published embed paints the exact same atmosphere and
 * lighting as the live editor preview.
 */
const SKY_GLOBE_JSON = JSON.stringify(skySpec(true));
const SKY_FLAT_JSON = JSON.stringify(skySpec(false));
const LIGHT_JSON = JSON.stringify(lightSpec());

/**
 * Inline-JS prelude shared by every renderer (injected once into each
 * `String.raw` template): a single security-critical HTML escaper plus the
 * Italian number formatter. Keeping one definition prevents the escaping logic
 * from drifting between the three renderers.
 */
const RENDER_PRELUDE = String.raw`
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
var NF=new Intl.NumberFormat("it-IT",{maximumFractionDigits:2});
function fmt(n){var s=NF.format(n);return E.valueUnit?(s+"\u00a0"+E.valueUnit):s;}
// Move every basemap label (symbol) layer above the data so place names stay
// readable on top of the overlay. 2D renders only (callers skip 3D extrusion).
function raiseLabels(){try{(map.getStyle().layers||[]).forEach(function(l){
  if(l.type==="symbol"&&l.id.indexOf("d-")!==0)map.moveLayer(l.id);});}catch(e){}}`;

/** Pinned MapLibre version for embeds (matches the app's maplibre-gl).
 *  Must be v5+: the globe projection (`setProjection`) and `setSky` used by
 *  the renderers only exist from MapLibre GL JS 5.0. */
export const EMBED_MAPLIBRE_VERSION = "5.24.0";

export interface EmbedOptions {
  /** Base URL where `{level}.geojson` geometries are served (no trailing /). */
  geoBaseUrl: string;
  /** Public URL of this embed (for the canonical/attribution link). */
  selfUrl?: string;
  /**
   * Class breaks computed by the canonical pipeline against the real geometry
   * (so the embed classifies on exactly the values the editor rendered). When
   * omitted, breaks are computed from the spec data as a fallback.
   */
  classes?: ClassBreaks;
}

/** Escape a string for safe inclusion in HTML text/attribute context. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Embed the spec as JSON safe to sit inside a <script> block. */
function jsonForScript(value: unknown): string {
  // Prevent a literal </script> in data from closing the tag, and escape
  // line/paragraph separators that are invalid in JS string literals.
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Build the full embed HTML for any publishable spec. Dispatches to the area
 * (choropleth family) or point renderer. Both produce a single, self-contained
 * static document with MapLibre loaded from a pinned CDN.
 */
export function buildEmbedHtml(spec: VizSpec, opts: EmbedOptions): string {
  if (spec.type === "point") return buildPointEmbedHtml(spec, opts);
  if (spec.type === "geo") return buildGeoEmbedHtml(spec, opts);
  if (spec.type === "chart") return buildChartEmbedHtml(spec, opts);
  if (spec.type === "story") return buildStoryEmbedHtml(spec, opts);
  return buildAreaEmbedHtml(spec, opts);
}

/** Pinned Observable Plot version for chart embeds (matches the app's plot). */
export const EMBED_PLOT_VERSION = "0.6.17";

/** Pinned Scrollama version for scrollytelling story embeds. */
export const EMBED_SCROLLAMA_VERSION = "3.2.0";

/**
 * Build the full embed HTML for a **scrollytelling story** (O4.1). The base map
 * is rendered with its normal embed (forced non-interactive) inside a fixed
 * full-screen `<iframe srcdoc>`; a narrative column scrolls over it and, on each
 * step, flies the iframe's map to that step's camera (via Scrollama from a
 * pinned CDN). All step text is escaped. Self-contained — no separate publish.
 */
function buildStoryEmbedHtml(spec: StorySpec, opts: EmbedOptions): string {
  const mlVer = EMBED_MAPLIBRE_VERSION;
  const scrollamaVer = EMBED_SCROLLAMA_VERSION;
  const title = escapeHtml(spec.project.title || "Storia Zornade");
  const subtitle = escapeHtml(spec.project.subtitle || "");
  const titleFont = escapeHtml(spec.design.titleFont || "system-ui, sans-serif");
  const canonical = opts.selfUrl ? escapeHtml(opts.selfUrl) : "";

  let oembedLinks = "";
  if (opts.selfUrl) {
    try {
      const origin = new URL(opts.selfUrl).origin;
      const endpoint = `${origin}/api/oembed?url=${encodeURIComponent(opts.selfUrl)}`;
      oembedLinks =
        `<link rel="alternate" type="application/json+oembed" href="${endpoint}&amp;format=json" title="${title}">` +
        `<link rel="alternate" type="text/xml+oembed" href="${endpoint}&amp;format=xml" title="${title}">`;
    } catch {
      /* malformed selfUrl: discovery links are optional */
    }
  }

  // Render the base map embed, forced non-interactive (the scroll drives it),
  // and expose its map instance as a global so the story layer can fly it.
  const baseSpec = {
    ...spec.base,
    design: { ...spec.base.design, zoomPan: false },
  } as StoryBaseSpec;
  const rawBase = buildEmbedHtml(baseSpec, opts).replace(
    "map.addControl(new maplibregl.AttributionControl({compact:true}));",
    'map.addControl(new maplibregl.AttributionControl({compact:true}));try{window.__zmap=map;}catch(e){}',
  );
  // srcdoc lives in a double-quoted attribute → escape & and " only.
  const srcdoc = rawBase.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  const stepsHtml = spec.steps
    .map(
      (s, i) =>
        `<section class="step" data-i="${i}"><div class="card">` +
        (s.title ? `<h2>${escapeHtml(s.title)}</h2>` : "") +
        (s.body ? `<p>${escapeHtml(s.body)}</p>` : "") +
        `</div></section>`,
    )
    .join("");

  const embed = { cameras: spec.steps.map((s) => s.camera) };

  const css = `
  html,body{margin:0;font-family:system-ui,-apple-system,sans-serif;color:#0f172a}
  #sticky{position:fixed;inset:0;z-index:0;background:#eef2f5}
  #sticky iframe{width:100%;height:100%;border:0;display:block}
  .story{position:relative;z-index:1;pointer-events:none;max-width:780px;margin:0 auto;padding:0 16px}
  .intro{min-height:62vh;display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:8vh}
  .intro h1{font-size:30px;line-height:1.2;margin:0;align-self:flex-start;background:rgba(255,255,255,.92);
    padding:6px 12px;border-radius:10px;box-shadow:0 1px 8px rgba(0,0,0,.14)}
  .intro p{font-size:15px;color:#334155;align-self:flex-start;background:rgba(255,255,255,.92);
    margin:8px 0 0;padding:4px 10px;border-radius:8px}
  .step{min-height:92vh;display:flex;align-items:center}
  .card{pointer-events:auto;background:rgba(255,255,255,.95);border-radius:14px;padding:16px 18px;
    box-shadow:0 4px 18px rgba(15,23,42,.18);max-width:380px;opacity:.5;transform:translateY(8px);
    transition:opacity .35s,transform .35s}
  .card.active{opacity:1;transform:none}
  .card h2{margin:0 0 6px;font-size:18px}
  .card p{margin:0;font-size:14px;line-height:1.5;color:#334155}
  .end{min-height:40vh}
  .attr{position:fixed;right:8px;bottom:6px;z-index:2;font-size:11px;background:rgba(255,255,255,.85);
    padding:2px 6px;border-radius:6px}
  .attr a{color:#01646f;text-decoration:none}`;

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${canonical ? `<link rel="canonical" href="${canonical}">` : ""}
${oembedLinks}
<style>${css}</style>
</head>
<body>
<div id="sticky"><iframe id="mapframe" srcdoc="${srcdoc}" title="${title}" referrerpolicy="no-referrer"></iframe></div>
<div class="story">
  <div class="intro"><h1 style="font-family:${titleFont}">${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ""}</div>
  ${stepsHtml}
  <div class="end"></div>
</div>
<div class="attr"><a href="https://zornade.com/studio" target="_blank" rel="noopener">Fatto con Zornade Studio</a></div>
<script src="https://cdn.jsdelivr.net/npm/scrollama@${scrollamaVer}/build/scrollama.min.js"></script>
<script>
const EMBED = ${jsonForScript(embed)};
${STORY_RENDERER}
</script>
</body>
</html>`;
  void mlVer;
}

/**
 * Inline story renderer: wires Scrollama to fly the iframe's map to each step's
 * camera. Re-applies the latest camera once the iframe map is ready.
 */
const STORY_RENDERER = String.raw`
(function(){
var C=(EMBED.cameras)||[];
var frame=document.getElementById("mapframe");
var last=0;
function fly(i){
  if(C[i])last=i;
  var w=frame&&frame.contentWindow;
  if(w&&w.__zmap&&C[i]){
    w.__zmap.flyTo({center:C[i].center,zoom:C[i].zoom,pitch:C[i].pitch,
      bearing:C[i].bearing,duration:1400,essential:true});
  }
}
if(frame)frame.addEventListener("load",function(){setTimeout(function(){fly(last);},120);});
if(typeof scrollama!=="undefined"){
  var sc=scrollama();
  sc.setup({step:".step",offset:0.6}).onStepEnter(function(r){
    fly(+r.element.getAttribute("data-i"));
    var card=r.element.querySelector(".card");if(card)card.classList.add("active");
  }).onStepExit(function(r){
    var card=r.element.querySelector(".card");if(card)card.classList.remove("active");
  });
  window.addEventListener("resize",sc.resize);
}
})();`;

/**
 * Build the full embed HTML for a **chart** (O4 publish, phase 4). Not a map:
 * loads Observable Plot from a pinned CDN and renders the precomputed points
 * (bar/line/area/scatter) or an HTML table. All user text is escaped.
 */
function buildChartEmbedHtml(spec: ChartSpec, opts: EmbedOptions): string {
  const plotVer = EMBED_PLOT_VERSION;
  const d = spec.design;
  const title = escapeHtml(spec.project.title || "Grafico Zornade");
  const subtitle = escapeHtml(spec.project.subtitle || "");
  const source = escapeHtml(spec.project.source || "");
  const titleFont = escapeHtml(d.titleFont || "system-ui, sans-serif");
  const canonical = opts.selfUrl ? escapeHtml(opts.selfUrl) : "";

  let oembedLinks = "";
  if (opts.selfUrl) {
    try {
      const origin = new URL(opts.selfUrl).origin;
      const endpoint = `${origin}/api/oembed?url=${encodeURIComponent(opts.selfUrl)}`;
      oembedLinks =
        `<link rel="alternate" type="application/json+oembed" href="${endpoint}&amp;format=json" title="${title}">` +
        `<link rel="alternate" type="text/xml+oembed" href="${endpoint}&amp;format=xml" title="${title}">`;
    } catch {
      /* malformed selfUrl: discovery links are optional */
    }
  }

  // Accessible table: for the table render it IS the content; for charts it is a
  // visually-hidden representation of the plotted points.
  let dataTableHtml = "";
  if (spec.render === "table" && spec.table) {
    dataTableHtml = accessibleTableHtml(spec.table.columns, spec.table.rows, {
      caption: spec.project.title || "Dati",
    });
  } else if (spec.points && spec.points.length) {
    const xH = spec.axisX || "x";
    const yH = spec.axisY || "y";
    const tableFmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });
    dataTableHtml = accessibleTableHtml(
      spec.hasSeries ? [xH, "Serie", yH] : [xH, yH],
      spec.points.map((p) =>
        spec.hasSeries
          ? { [xH]: String(p.x), Serie: String(p.series ?? ""), [yH]: tableFmt.format(p.y) }
          : { [xH]: String(p.x), [yH]: tableFmt.format(p.y) },
      ),
      { caption: spec.project.title || "Dati del grafico" },
    );
  }

  const embed = {
    render: spec.render,
    points: spec.points ?? [],
    hasSeries: spec.hasSeries,
    axisX: spec.axisX,
    axisY: spec.axisY,
    table: spec.table ?? null,
    colors: spec.colors,
    showLegend: !!d.showLegend,
    tooltip: !!d.tooltip,
    valueUnit: d.valueUnit || "",
  };

  // The chart embed does not use MapLibre; it has its own column layout.
  const chartCss = `
  html,body{margin:0;height:100%;font-family:system-ui,-apple-system,sans-serif;color:#0f172a}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;padding:16px;box-sizing:border-box}
  .ttl h1{margin:0;font-size:18px}
  .ttl p{margin:2px 0 0;font-size:13px;color:#475569}
  #chart{flex:1;min-height:0;margin-top:8px}
  #chart table{width:100%;border-collapse:collapse;font-size:13px}
  #chart th,#chart td{border-bottom:1px solid #e2e8f0;padding:6px 10px;text-align:left}
  #chart thead th{position:sticky;top:0;background:#f8fafc;font-weight:600}
  .tablewrap{height:100%;overflow:auto;border:1px solid #e2e8f0;border-radius:8px}
  .src{font-size:11px;color:#475569;margin-top:8px}
  .attr{font-size:11px;color:#475569;margin-top:4px}
  .attr a{color:#01646f;text-decoration:none}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;
    overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`;

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${canonical ? `<link rel="canonical" href="${canonical}">` : ""}
${oembedLinks}
<style>${chartCss}</style>
</head>
<body>
<div class="wrap">
${spec.design.showTitle && title ? `<div class="ttl"><h1 style="font-family:${titleFont}">${title}</h1>${subtitle ? `<p style="font-family:${titleFont}">${subtitle}</p>` : ""}</div>` : ""}
<div id="chart"></div>
${spec.design.showSource && source ? `<div class="src">${source}</div>` : ""}
<div class="attr"><a href="https://zornade.com/studio" target="_blank" rel="noopener">Fatto con Zornade Studio</a></div>
</div>
${dataTableHtml ? `<div class="sr-only">${dataTableHtml}</div>` : ""}
<script src="https://cdn.jsdelivr.net/npm/@observablehq/plot@${plotVer}/dist/plot.umd.min.js"></script>
<script>
const EMBED = ${jsonForScript(embed)};
${CHART_RENDERER}
</script>
</body>
</html>`;
}

/**
 * Inline renderer for a chart embed: the precomputed points are inlined as
 * `EMBED`; this draws them with Observable Plot (bar/line/area/scatter) or
 * builds an HTML table. Re-renders responsively on resize.
 */
const CHART_RENDERER = String.raw`
(function(){
var E=EMBED;
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
var NF=new Intl.NumberFormat("it-IT",{maximumFractionDigits:2});
function nf(n){return NF.format(n);}
var el=document.getElementById("chart");
function table(){
  if(!E.table){el.textContent="";return;}
  var h="<div class=\"tablewrap\"><table><thead><tr>";
  E.table.columns.forEach(function(c){h+="<th>"+esc(c)+"</th>";});
  h+="</tr></thead><tbody>";
  E.table.rows.slice(0,2000).forEach(function(r){h+="<tr>";
    E.table.columns.forEach(function(c){h+="<td>"+esc(r[c])+"</td>";});h+="</tr>";});
  h+="</tbody></table></div>";el.innerHTML=h;
}
function chart(){
  if(typeof Plot==="undefined"){el.textContent="Impossibile caricare il motore grafici.";return;}
  var pts=E.points||[];var hs=E.hasSeries;var base=E.colors[E.colors.length-1]||"#01646f";
  var fill=hs?"series":base;var tip=E.tooltip;
  var marks=[Plot.ruleY([0])];
  if(E.render==="bar")marks.push(Plot.barY(pts,{x:"x",y:"y",fill:fill,tip:tip}));
  else if(E.render==="line"){marks.push(Plot.line(pts,{x:"x",y:"y",stroke:fill,strokeWidth:2,z:hs?"series":undefined,tip:tip}));
    marks.push(Plot.dot(pts,{x:"x",y:"y",fill:fill,r:2}));}
  else if(E.render==="area")marks.push(Plot.areaY(pts,{x:"x",y:"y",fill:fill,fillOpacity:hs?0.6:0.85,z:hs?"series":undefined,tip:tip}));
  else if(E.render==="scatter")marks.push(Plot.dot(pts,{x:"x",y:"y",fill:fill,r:4,tip:tip}));
  var w=el.clientWidth||640,h=el.clientHeight||400;
  var fig=Plot.plot({width:w,height:h,marginLeft:64,marginBottom:56,marginTop:16,
    style:{background:"transparent",fontFamily:"inherit",fontSize:"12px"},
    x:{label:E.axisX,tickRotate:(E.render==="bar"&&pts.length>6)?-35:0},
    y:{label:E.axisY,grid:true,tickFormat:function(d){return nf(d);}},
    color:hs?{legend:E.showLegend,range:E.colors}:undefined,
    marks:marks});
  el.replaceChildren(fig);
}
function render(){if(E.render==="table")table();else chart();}
render();
var t=null;
window.addEventListener("resize",function(){if(t)clearTimeout(t);t=setTimeout(render,150);});
})();`;

/**
 * Build the full embed HTML for a choropleth (area-family) spec. The renderer
 * script joins the spec data onto the geometry and paints the map; it is kept
 * dependency-light and inline so the document is self-contained.
 */
function buildAreaEmbedHtml(
  spec: ChoroplethSpec,
  opts: EmbedOptions,
): string {
  const mlVer = EMBED_MAPLIBRE_VERSION;
  const d = spec.design;
  const title = escapeHtml(spec.project.title || "Mappa Zornade");
  const subtitle = escapeHtml(spec.project.subtitle || "");
  const source = escapeHtml(spec.project.source || "");
  const titleFont = escapeHtml(d.titleFont || "system-ui, sans-serif");
  const geoUrl = `${opts.geoBaseUrl}/${spec.geo.level}.geojson`;
  const canonical = opts.selfUrl ? escapeHtml(opts.selfUrl) : "";

  // oEmbed discovery (O3.5): let WordPress (and other consumers) auto-embed the
  // pasted snapshot URL. The provider endpoint lives on the same origin as the
  // published page (`/api/oembed`). `&` is written as `&amp;` for valid HTML.
  let oembedLinks = "";
  if (opts.selfUrl) {
    try {
      const origin = new URL(opts.selfUrl).origin;
      const endpoint = `${origin}/api/oembed?url=${encodeURIComponent(opts.selfUrl)}`;
      oembedLinks =
        `<link rel="alternate" type="application/json+oembed" href="${endpoint}&amp;format=json" title="${title}">` +
        `<link rel="alternate" type="text/xml+oembed" href="${endpoint}&amp;format=xml" title="${title}">`;
    } catch {
      // Ignore a malformed selfUrl: discovery links are a progressive enhancement.
    }
  }

  // --- Render config, computed ONCE with the same canonical functions the
  // editor uses, so the published map is faithful to the live preview. The
  // renderer below only *applies* these values; it never re-derives them. ---
  const render: AreaRender = spec.render ?? "choropleth";
  // Maps that colour areas by a graduated numeric value (and put a number on
  // each feature's __value): choropleth + the symbol/spike/extrusion variants.
  const isNumeric =
    render === "choropleth" ||
    render === "symbol" ||
    render === "spike" ||
    render === "extrusion" ||
    render === "cartogram";
  const scaleColors = colorsForScale(d.colorScale, d.reverseScale);
  const noData = DEFAULT_NO_DATA_COLOR;
  const { fields, nameField } = geoJoinFields(spec.geo.level);
  const valueLabel = d.valueLabel || spec.geo.valueColumn || "Valore";

  // Value put on each feature's `__value` at runtime, keyed by normalised key.
  // Its meaning depends on `render`: a number (numeric maps), the category
  // label (category map), or the bivariate class index 0..8 (bivariate map).
  const keyed: Record<string, number | string> = {};
  // Extra columns referenced by a custom tooltip template, keyed by key.
  const extraByKey: Record<string, Record<string, string>> = {};
  for (const datum of spec.data) {
    if (!datum.extra) continue;
    const k = normaliseKey(datum.key);
    if (k !== "") extraByKey[k] = datum.extra;
  }

  // Per-render paint + legend descriptors.
  let classes: ClassBreaks = { breaks: [], min: 0, max: 0 };
  let fill: unknown;
  let legendColors: string[] = [];
  // Category map: the distinct categories with their colours (for the legend).
  let categoryLegend: { label: string; color: string }[] | null = null;
  // Bivariate map: the two raw values per key (for the tooltip).
  const bivA: Record<string, number> = {};
  const bivB: Record<string, number> = {};

  if (isNumeric) {
    for (const datum of spec.data) {
      const k = normaliseKey(datum.key);
      if (k === "" || datum.value == null) continue;
      keyed[k] = datum.value;
    }
    // Prefer the breaks computed against the real geometry; fall back to the
    // spec data. For a temporal map, classify over EVERY frame so colours are
    // comparable across periods (a value means the same colour over time).
    const fallbackValues = spec.frames
      ? spec.frames.flatMap((f) =>
          f.data.map((dd) => dd.value).filter((v): v is number => v != null),
        )
      : (Object.values(keyed) as number[]);
    classes =
      opts.classes ??
      computeBreaks(fallbackValues, d.classification, d.nClasses, d.manualBreaks);
    fill = buildFillColorExpression(classes, scaleColors, noData);
    legendColors = sampleColors(scaleColors, classes.breaks.length + 1);
  } else if (render === "category") {
    const categories: string[] = [];
    const seen = new Set<string>();
    for (const datum of spec.data) {
      const k = normaliseKey(datum.key);
      const cat = datum.category;
      if (k === "" || cat == null || cat === "") continue;
      keyed[k] = cat;
      if (!seen.has(cat)) {
        seen.add(cat);
        categories.push(cat);
      }
    }
    // Colour each category by palette[i % len], matched on __value (= the
    // category label). Mirrors the editor's buildPointColorExpression.
    const match: unknown[] = ["match", ["get", "__value"]];
    categories.forEach((cat, i) => match.push(cat, scaleColors[i % scaleColors.length]));
    match.push(noData);
    fill = categories.length > 0 ? match : noData;
    categoryLegend = categories.map((cat, i) => ({
      label: cat,
      color: scaleColors[i % scaleColors.length],
    }));
  } else {
    // bivariate: assign each area a class 0..8 from the terciles of A and B.
    const aVals: number[] = [];
    const bVals: number[] = [];
    for (const datum of spec.data) {
      if (datum.value != null) aVals.push(datum.value);
      if (datum.value2 != null) bVals.push(datum.value2);
    }
    const breaksA = computeBreaks(aVals, "quantile", 3).breaks;
    const breaksB = computeBreaks(bVals, "quantile", 3).breaks;
    for (const datum of spec.data) {
      const k = normaliseKey(datum.key);
      if (k === "" || datum.value == null || datum.value2 == null) continue;
      keyed[k] = tercileClass(datum.value2, breaksB) * 3 + tercileClass(datum.value, breaksA);
      bivA[k] = datum.value;
      bivB[k] = datum.value2;
    }
    const match: unknown[] = ["match", ["get", "__value"]];
    BIVARIATE_PALETTE.forEach((c, i) => match.push(i, c));
    match.push(noData);
    fill = match;
  }

  // Temporal frames (choropleth only): normalised key→value per period, with a
  // human label. The initial paint uses `keyed` (= newest frame); the slider
  // swaps in another frame's `keyed` at runtime, keeping the shared classes.
  const frames =
    isNumeric && spec.frames
      ? spec.frames.map((f) => {
          const k: Record<string, number> = {};
          for (const dd of f.data) {
            const nk = normaliseKey(dd.key);
            if (nk !== "" && dd.value != null) k[nk] = dd.value;
          }
          return { label: frameLabel(f.period), keyed: k };
        })
      : null;

  // Annotations (O3.4): precompute the GeoJSON (lines/areas) and the marker/
  // text descriptors at build time, so the inline renderer only has to add a
  // static source + create DOM markers (no geometry maths shipped to the
  // browser). Sanitised defensively against a hand-edited spec.
  const anns = spec.annotations ? sanitizeAnnotations(spec.annotations) : [];
  const annotGeo = annotationsToGeoJson(anns);
  const annotMarkers = markerAnnotations(anns);

  // Accessible data table (O3.5): a visually-hidden <table> so screen readers
  // can read the underlying data of the canvas-only (WebGL) map. Built from the
  // minimal spec data (key + value); for a temporal map this is the initial
  // (most recent) frame, matching the default visible map.
  const tableFmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });
  const keyHeader = spec.geo.keyColumn || "Area";
  const valueHeader = valueLabel + (d.valueUnit ? ` (${d.valueUnit})` : "");
  // Each cell shows the numeric value, or the category label for a category map.
  const cellFor = (dd: (typeof spec.data)[number]): string =>
    dd.value != null
      ? tableFmt.format(dd.value)
      : dd.category != null
        ? dd.category
        : "";
  const dataTableHtml = spec.data.length
    ? accessibleTableHtml(
        [keyHeader, valueHeader],
        spec.data.map((dd) => ({
          [keyHeader]: dd.key,
          [valueHeader]: cellFor(dd),
        })),
        { caption: spec.project.title || "Dati della mappa" },
      )
    : "";

  const embed = {
    geoUrl,
    fields,
    nameField,
    keyed,
    fill,
    render,
    cartogramKind: spec.cartogramKind ?? "noncontiguous",
    pointColor: d.pointColor || BRAND_TEAL,
    pointSize: d.pointSize || 7,
    valueRange: { min: classes.min, max: classes.max },
    legendColors,
    breaks: classes.breaks,
    categoryLegend,
    bivA,
    bivB,
    bivPalette: BIVARIATE_PALETTE,
    basemapStyle: resolveBasemap(d.basemap, d.customBasemapUrl ?? ""),
    center: (spec.camera?.center ?? (spec.globe ? [0, 20] : [12.5, 42])) as [number, number],
    zoom: spec.camera?.zoom ?? (spec.globe ? 1.5 : 4.4),
    pitch: spec.camera?.pitch ?? (render === "extrusion" ? 50 : 0),
    bearing: spec.camera?.bearing ?? 0,
    hasCamera: !!spec.camera,
    bounds: spec.camera?.bounds ?? null,
    globe: spec.globe ?? false,
    interactive: !!d.zoomPan,
    showLegend: !!d.showLegend,
    legendType: d.legendType,
    readerFilters: !!d.readerFilters,
    scaleColors,
    min: classes.min,
    max: classes.max,
    noData,
    valueLabel,
    valueUnit: d.valueUnit || "",
    noDataLabel: "Dato non disponibile",
    tooltip: !!d.tooltip,
    tooltipTemplate: d.tooltipTemplate || "",
    extraByKey,
    frames,
    initialFrame: frames ? frames.length - 1 : 0,
    annotGeo,
    annotMarkers,
  };

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${canonical ? `<link rel="canonical" href="${canonical}">` : ""}
${oembedLinks}
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@${mlVer}/dist/maplibre-gl.css">
<style>${EMBED_CSS}</style>
</head>
<body>
<div id="map"></div>
<div id="tip"></div>
${spec.design.showTitle && title ? `<div class="ttl"><h1 style="font-family:${titleFont}">${title}</h1>${subtitle ? `<p style="font-family:${titleFont}">${subtitle}</p>` : ""}</div>` : ""}
${spec.design.showSource && source ? `<div class="src">${source}</div>` : ""}
<div class="attr"><a href="https://zornade.com/studio" target="_blank" rel="noopener">Fatto con Zornade Studio</a> · Dati © OpenStreetMap</div>
${dataTableHtml ? `<div class="sr-only">${dataTableHtml}</div>` : ""}
<script src="https://unpkg.com/maplibre-gl@${mlVer}/dist/maplibre-gl.js"></script>
<script>
const EMBED = ${jsonForScript(embed)};
${EMBED_RENDERER}
</script>
</body>
</html>`;
}

/** Shared embed CSS (area + point renderers). */
const EMBED_CSS = `
  html,body{margin:0;height:100%;background:transparent;font-family:system-ui,-apple-system,sans-serif}
  #map{position:absolute;inset:0;background:transparent}
  .ttl{position:absolute;left:12px;top:12px;max-width:70%;background:rgba(255,255,255,.92);
    padding:8px 12px;border-radius:10px;box-shadow:0 1px 6px rgba(0,0,0,.12);z-index:2}
  .ttl h1{margin:0;font-size:16px;color:#0f172a}
  .ttl p{margin:2px 0 0;font-size:13px;color:#475569}
  .src{position:absolute;left:12px;bottom:12px;font-size:11px;color:#475569;z-index:2}
  .lgd{position:absolute;left:12px;bottom:46px;background:rgba(255,255,255,.92);
    padding:8px 12px;border-radius:10px;box-shadow:0 1px 6px rgba(0,0,0,.12);z-index:2;font-size:11px}
  .lgd-t{margin:0 0 6px;font-size:11px;font-weight:600;text-transform:uppercase;
    letter-spacing:.04em;color:#64748b}
  .lgd-bar{display:flex;height:10px;width:160px;overflow:hidden;border-radius:999px}
  .lgd-mm{display:flex;justify-content:space-between;margin-top:4px;color:#64748b;font-size:10px}
  .lgd-nd{display:flex;align-items:center;gap:6px;margin-top:6px;color:#94a3b8;font-size:10px}
  .lgd-sw{display:inline-block;width:10px;height:10px;border-radius:3px}
  .lgd-row{display:flex;align-items:center;gap:6px;width:100%;border:0;background:none;
    padding:2px 2px;cursor:pointer;font-size:10px;color:#475569;text-align:left;border-radius:4px}
  .lgd-row:hover{background:#f1f5f9}
  .lgd-sw2{display:inline-block;width:16px;height:10px;border-radius:3px;flex-shrink:0}
  .attr{position:absolute;right:8px;bottom:6px;font-size:11px;z-index:2;
    background:rgba(255,255,255,.85);padding:2px 6px;border-radius:6px}
  .attr a{color:#01646f;text-decoration:none}
  .studio-tooltip .maplibregl-popup-content{padding:8px 10px;border-radius:10px;
    box-shadow:0 4px 14px rgba(15,23,42,.18);font-family:system-ui,-apple-system,sans-serif}
  .studio-tooltip .maplibregl-popup-tip{display:none}
  .studio-tooltip-name{font-weight:600;font-size:13px;color:#0f172a}
  .studio-tooltip-value{margin-top:2px;font-size:12px;color:#334155}
  .studio-tooltip-value span{color:#64748b;text-transform:capitalize}
  /* Cursor-following tooltip (area embed): screen-anchored so it never drifts
     behind tall bars on a pitched/globe 3D extrusion. */
  #tip{position:absolute;top:0;left:0;z-index:4;pointer-events:none;max-width:220px;
    padding:8px 10px;border-radius:10px;background:#fff;opacity:0;
    box-shadow:0 4px 14px rgba(15,23,42,.18);font-family:system-ui,-apple-system,sans-serif;
    transition:opacity .12s ease}
  .tsl{position:absolute;left:50%;bottom:46px;transform:translateX(-50%);
    width:min(440px,82%);display:flex;align-items:center;gap:10px;
    background:rgba(255,255,255,.92);padding:7px 12px;border-radius:12px;
    box-shadow:0 2px 10px rgba(0,0,0,.14);z-index:3}
  .tsl-btn{flex-shrink:0;width:30px;height:30px;border:0;border-radius:999px;
    background:#01646f;color:#fff;cursor:pointer;font-size:13px;line-height:1;
    display:flex;align-items:center;justify-content:center}
  .tsl-btn:hover{background:#024e57}
  .tsl input[type=range]{flex:1;accent-color:#01646f;cursor:pointer}
  .tsl-lbl{flex-shrink:0;width:52px;text-align:right;font-size:12px;
    font-weight:600;color:#334155;font-variant-numeric:tabular-nums}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;
    overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
`;

/**
 * The inline renderer is a **dumb applier**: it fetches the geometry, joins the
 * pre-computed values by normalised key, and paints the choropleth using the
 * breaks/colours/fill-expression already computed by the canonical functions in
 * choropleth.ts (injected as `EMBED`). It never re-derives classes, so the
 * published map is identical to the editor preview. Kept as a string so it ships
 * inside the static embed with no build step.
 *
 * NOTE: `nk()` must stay byte-identical to `normaliseKey()` in choropleth.ts —
 * it is the only logic duplicated here, because geometry keys are normalised in
 * the browser at runtime (the geometry is fetched, not bundled).
 */
const EMBED_RENDERER = String.raw`
(function(){
var E=EMBED;
function nk(v){if(v==null)return"";var s=String(v).trim().toLowerCase();
  if(/^\d$/.test(s))s="0"+s;s=s.split("/")[0].trim();
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"");}
${RENDER_PRELUDE}
// Insertion point for the data layers: above every basemap geometry layer
// (roads, buildings, boundaries) but below the first label. The naive "first
// symbol" is wrong for OpenMapTiles styles (an early water_name symbol precedes
// the roads), which buries the data under the roads. A raster background counts
// as basemap geometry too, so the data stays above a satellite/WMS basemap.
function beforeId(){var ls=(map.getStyle().layers||[]),lg=-1,i,t;
  for(i=0;i<ls.length;i++){if(ls[i].id.indexOf("d-")===0)continue;t=ls[i].type;
    if(t==="fill"||t==="line"||t==="fill-extrusion"||t==="raster")lg=i;}
  for(i=lg+1;i<ls.length;i++){if(ls[i].id.indexOf("d-")!==0)return ls[i].id;}
  return undefined;}
// Subtle sky + atmospheric haze, serialised from the shared map-style source.
function sky(){try{map.setSky(E.globe?${SKY_GLOBE_JSON}:${SKY_FLAT_JSON});}catch(e){}}
// Directional light anchored to the map: shades the sides of the 3D extrusion
// so the shapes read as solid volumes. Only fill-extrusion layers react to it.
function light(){try{map.setLight(${LIGHT_JSON});}catch(e){}}
var map=new maplibregl.Map({container:"map",
  style:E.basemapStyle||{version:8,sources:{},layers:[]},
  center:E.center,zoom:E.zoom,pitch:E.pitch,bearing:E.bearing,attributionControl:false,interactive:E.interactive});
map.addControl(new maplibregl.AttributionControl({compact:true}));
var GEO=null,ready=false;
map.on("load",function(){ready=true;if(E.globe){try{map.setProjection({type:"globe"});}catch(e){}}sky();light();if(GEO)build();});
fetch(E.geoUrl).then(function(r){return r.json();}).then(function(g){GEO=g;if(ready)build();});
function build(){
  var noData=paint(E.keyed);
  map.addSource("d",{type:"geojson",data:GEO,generateId:true});
  var before=beforeId();
  if(E.render==="extrusion"){
    map.addLayer({id:"d-fill",type:"fill-extrusion",source:"d",
      paint:{"fill-extrusion-color":E.fill,
        "fill-extrusion-height":["interpolate",["linear"],
          ["coalesce",["to-number",["get","__value"]],E.min],E.min,4800*(E.extrusionScale||1),E.max,120000*(E.extrusionScale||1)],
        "fill-extrusion-base":0,"fill-extrusion-opacity":0.95,
        "fill-extrusion-vertical-gradient":true}},before);
  }else if(E.render==="symbol"||E.render==="spike"){
    map.addLayer({id:"d-line",type:"line",source:"d",
      paint:{"line-color":"#cbd5e1","line-width":0.5}},before);
    map.addSource("dm",{type:"geojson",data:marks(E.render)});
    if(E.render==="symbol"){
      map.addLayer({id:"d-fill",type:"circle",source:"dm",
        paint:{"circle-color":E.pointColor,
          "circle-radius":["interpolate",["linear"],["to-number",["get","__value"],E.min],
            E.min,Math.max(2,E.pointSize*0.6),E.max,E.pointSize*2.8],
          "circle-stroke-color":"#fff","circle-stroke-width":1,"circle-opacity":0.9}});
    }else{
      map.addLayer({id:"d-fill",type:"fill",source:"dm",
        paint:{"fill-color":E.pointColor,"fill-opacity":0.85}});
    }
  }else if(E.render==="cartogram"){
    var carto=cartogram();
    map.addSource("dm",{type:"geojson",data:carto});
    map.addLayer({id:"d-fill",type:"fill",source:"dm",
      paint:{"fill-color":E.fill,"fill-opacity":0.85}},before);
    map.addLayer({id:"d-line",type:"line",source:"dm",
      paint:{"line-color":"#fff","line-width":0.5}},before);
  }else{
    map.addLayer({id:"d-fill",type:"fill",source:"d",
      paint:{"fill-color":E.fill,
        "fill-opacity":["case",["boolean",["feature-state","hover"],false],0.95,0.82]}},before);
    map.addLayer({id:"d-line",type:"line",source:"d",
      paint:{"line-color":"#fff",
        "line-width":["case",["boolean",["feature-state","hover"],false],1.6,0.6],
        "line-opacity":0.55}},before);
    hoverFx();
  }
  if(E.render!=="extrusion")raiseLabels();
  if(!E.hasCamera&&!E.globe){fit();}else if(E.bounds){map.fitBounds(E.bounds,{pitch:E.pitch,bearing:E.bearing,duration:0,padding:0});}
  if(E.showLegend)legend(noData);
  if(E.tooltip)tooltip();
  if(E.frames&&E.frames.length>1)timeUI();
  annotations();
}
// Build the cartogram geometry from the painted GEO (non-contiguous scaling or
// Dorling circles), mirroring lib/cartogram. Tooltip reads __value/__name.
function cartogram(){
  var mx=E.max||1;var KM=110.574,D2R=Math.PI/180;
  function ring(lng,lat,rkm){var out=[];var kx=KM*Math.cos(lat*D2R)||KM;
    for(var i=0;i<=40;i++){var a=i/40*2*Math.PI;
      out.push([lng+rkm*Math.cos(a)/kx,lat+rkm*Math.sin(a)/KM]);}return out;}
  if(E.cartogramKind==="dorling"){
    var lat0=0,nn=0;GEO.features.forEach(function(f){var p=f.properties||{};if(p.__value==null)return;
      var c=centroid(f.geometry);if(c){lat0+=c[1];nn++;}});lat0=nn?lat0/nn:42;
    var kx=KM*Math.cos(lat0*D2R)||KM;
    var nodes=[];GEO.features.forEach(function(f){var p=f.properties||{};if(typeof p.__value!=="number"||p.__value<=0)return;
      var c=centroid(f.geometry);if(!c)return;
      var r=Math.max(2,Math.sqrt(p.__value/mx)*45);
      var nm=E.nameField&&p[E.nameField]!=null?p[E.nameField]:undefined;
      nodes.push({x:c[0]*kx,y:c[1]*KM,hx:c[0]*kx,hy:c[1]*KM,r:r,v:p.__value,name:nm});});
    if(nodes.length<=1200){for(var it=0;it<60;it++){
      for(var i=0;i<nodes.length;i++)for(var j=i+1;j<nodes.length;j++){
        var a=nodes[i],b=nodes[j];var dx=b.x-a.x,dy=b.y-a.y;var dist=Math.hypot(dx,dy);var md=a.r+b.r;
        if(dist===0){dx=(i-j)||1;dy=1;dist=Math.hypot(dx,dy);}
        if(dist<md){var push=(md-dist)/2,ux=dx/dist,uy=dy/dist;a.x-=ux*push;a.y-=uy*push;b.x+=ux*push;b.y+=uy*push;}}
      for(var k2=0;k2<nodes.length;k2++){var n=nodes[k2];n.x+=(n.hx-n.x)*0.02;n.y+=(n.hy-n.y)*0.02;}}}
    var df=nodes.map(function(n){var lng=n.x/kx,lat=n.y/KM;var props={__value:n.v};if(n.name!=null)props.__name=n.name;
      return {type:"Feature",properties:props,geometry:{type:"Polygon",coordinates:[ring(lng,lat,n.r)]}};});
    return {type:"FeatureCollection",features:df};
  }
  // non-contiguous: scale each polygon around its centroid by sqrt(value/max).
  function scalePt(pt,cx,cy,fa){return [cx+(pt[0]-cx)*fa,cy+(pt[1]-cy)*fa];}
  var feats=GEO.features.map(function(f){var p=f.properties||{};var g=f.geometry;
    if(typeof p.__value!=="number"||!g||(g.type!=="Polygon"&&g.type!=="MultiPolygon"))return f;
    var c=centroid(g);if(!c)return f;var fa=Math.max(0.08,Math.sqrt(p.__value/mx));
    var ng=g.type==="Polygon"
      ?{type:"Polygon",coordinates:g.coordinates.map(function(r){return r.map(function(pt){return scalePt(pt,c[0],c[1],fa);});})}
      :{type:"MultiPolygon",coordinates:g.coordinates.map(function(po){return po.map(function(r){return r.map(function(pt){return scalePt(pt,c[0],c[1],fa);});});})};
    return {type:"Feature",properties:p,geometry:ng};});
  return {type:"FeatureCollection",features:feats};
}
// Area-weighted centroid of a polygon's largest ring (mirrors lib/centroid).
function centroid(g){if(!g)return null;
  var polys=g.type==="Polygon"?[g.coordinates]:g.type==="MultiPolygon"?g.coordinates:null;
  if(!polys)return null;var best=null,bestA=-1;
  polys.forEach(function(poly){var r=poly[0];if(!r)return;
    var a=0;for(var i=0,n=r.length,j=n-1;i<n;j=i++){a+=r[j][0]*r[i][1]-r[i][0]*r[j][1];}
    if(Math.abs(a)>bestA){bestA=Math.abs(a);best=r;}});
  if(!best)return null;
  var a2=0;for(var i=0,n=best.length,j=n-1;i<n;j=i++){a2+=best[j][0]*best[i][1]-best[i][0]*best[j][1];}
  if(a2===0){var sx=0,sy=0;best.forEach(function(p){sx+=p[0];sy+=p[1];});
    return [sx/best.length,sy/best.length];}
  var cx=0,cy=0;for(var i2=0,n2=best.length,j2=n2-1;i2<n2;j2=i2++){
    var cr=best[j2][0]*best[i2][1]-best[i2][0]*best[j2][1];
    cx+=(best[j2][0]+best[i2][0])*cr;cy+=(best[j2][1]+best[i2][1])*cr;}
  return [cx/(3*a2),cy/(3*a2)];}
// Build the symbol/spike marks at area centroids from the painted geometry.
function marks(render){var feats=[];var mx=E.max||1;
  GEO.features.forEach(function(f){var p=f.properties||{};if(p.__value==null)return;
    var c=centroid(f.geometry);if(!c)return;
    var props={__value:p.__value};
    if(E.nameField&&p[E.nameField]!=null)props.__name=p[E.nameField];
    for(var k in p){if(k.indexOf("col:")===0)props[k]=p[k];}
    if(render==="spike"){var w=0.14/Math.max(0.2,Math.cos(c[1]*Math.PI/180));
      var hd=(p.__value/mx)*1.6;
      feats.push({type:"Feature",properties:props,geometry:{type:"Polygon",
        coordinates:[[[c[0]-w,c[1]],[c[0]+w,c[1]],[c[0],c[1]+hd],[c[0]-w,c[1]]]]}});
    }else{feats.push({type:"Feature",properties:props,
      geometry:{type:"Point",coordinates:c}});}});
  return {type:"FeatureCollection",features:feats};}
// Render custom annotations (O3.4): lines/areas come pre-built as GeoJSON
// (drawn above the data), markers/text as DOM markers. All user text is escaped.
function annotations(){
  if(E.annotGeo&&E.annotGeo.features&&E.annotGeo.features.length){
    map.addSource("annot",{type:"geojson",data:E.annotGeo});
    map.addLayer({id:"annot-fill",type:"fill",source:"annot",
      filter:["==",["geometry-type"],"Polygon"],
      paint:{"fill-color":["get","__color"],"fill-opacity":["get","__opacity"]}});
    map.addLayer({id:"annot-line",type:"line",source:"annot",
      layout:{"line-cap":"round","line-join":"round"},
      paint:{"line-color":["get","__color"],"line-width":["get","__width"]}});
  }
  (E.annotMarkers||[]).forEach(function(m){
    var el=document.createElement("div");el.style.pointerEvents="none";
    if(m.type==="marker"){el.style.position="relative";
      var lbl=m.text?'<div style="position:absolute;bottom:38px;left:50%;transform:translateX(-50%);'+
        'white-space:nowrap;background:rgba(255,255,255,.92);color:#0f172a;padding:2px 7px;'+
        'border-radius:6px;font-size:12px;font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.2)">'+
        esc(m.text)+'</div>':"";
      el.innerHTML=lbl+pin(m.color);
      new maplibregl.Marker({element:el,anchor:"bottom"}).setLngLat([m.lng,m.lat]).addTo(map);
    }else{
      el.style.cssText="background:rgba(255,255,255,.85);padding:3px 8px;border-radius:6px;"+
        "font-weight:600;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.2);color:"+esc(m.color);
      el.textContent=m.text||"Testo";
      new maplibregl.Marker({element:el,anchor:"center"}).setLngLat([m.lng,m.lat]).addTo(map);
    }
  });
}
function pin(c){return '<svg width="24" height="34" viewBox="0 0 24 34" '+
  'style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">'+
  '<path d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 22 12 22s12-13.6 12-22C24 5.4 18.6 0 12 0z" '+
  'fill="'+esc(c)+'" stroke="#fff" stroke-width="2"/>'+
  '<circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>';}
// Apply a frame's values (key→value) onto the geometry; returns the no-data
// count. Shared by the first paint and by the time slider.
function paint(keyed){
  var noData=0;
  GEO.features.forEach(function(f){var p=f.properties||(f.properties={});var val,mk="";
    for(var i=0;i<E.fields.length;i++){var k=nk(p[E.fields[i]]);
      if(k&&Object.prototype.hasOwnProperty.call(keyed,k)){val=keyed[k];mk=k;break;}}
    if(val!=null){p.__value=val;
      if(E.bivA&&E.bivA[mk]!=null)p.__a=E.bivA[mk];
      if(E.bivB&&E.bivB[mk]!=null)p.__b=E.bivB[mk];
      if(E.extraByKey&&E.extraByKey[mk]){var ex=E.extraByKey[mk];
        for(var c in ex){if(Object.prototype.hasOwnProperty.call(ex,c))p["col:"+c]=ex[c];}}
    }else{delete p.__value;noData++;}});
  return noData;
}
function setFrame(i){if(!E.frames||!E.frames[i])return;
  paint(E.frames[i].keyed);var src=map.getSource("d");if(src)src.setData(GEO);}
// Time slider + play button for a temporal map. The fill expression / classes
// are shared across frames, so only the per-feature __value changes per period.
function timeUI(){
  var idx=E.initialFrame||0;
  var box=document.createElement("div");box.className="tsl";
  var btn=document.createElement("button");btn.className="tsl-btn";
  btn.innerHTML="\u25B6";btn.title="Riproduci l'animazione";
  var rng=document.createElement("input");rng.type="range";rng.min=0;
  rng.max=E.frames.length-1;rng.value=idx;rng.setAttribute("aria-label","Periodo");
  var lbl=document.createElement("span");lbl.className="tsl-lbl";lbl.textContent=E.frames[idx].label;
  box.appendChild(btn);box.appendChild(rng);box.appendChild(lbl);document.body.appendChild(box);
  var timer=null;
  function show(i){idx=i;rng.value=i;lbl.textContent=E.frames[i].label;setFrame(i);}
  function stop(){if(timer){clearInterval(timer);timer=null;btn.innerHTML="\u25B6";btn.title="Riproduci l'animazione";}}
  function play(){btn.innerHTML="\u2759\u2759";btn.title="Pausa";
    timer=setInterval(function(){show(idx+1>=E.frames.length?0:idx+1);},900);}
  btn.onclick=function(){if(timer)stop();else play();};
  rng.oninput=function(){stop();show(parseInt(rng.value,10));};
}
function fit(){try{var b=new maplibregl.LngLatBounds();
  GEO.features.forEach(function(f){var g=f.geometry;if(!g)return;
    var cc=g.type==="Polygon"?[g.coordinates]:g.type==="MultiPolygon"?g.coordinates:null;
    if(!cc)return;cc.forEach(function(poly){poly[0].forEach(function(pt){b.extend(pt);});});});
  if(!b.isEmpty())map.fitBounds(b,{padding:48,duration:0,maxZoom:9});}catch(e){}}
function legend(noData){
  var box=document.createElement("div");box.className="lgd";
  var t=document.createElement("p");t.className="lgd-t";t.textContent=E.valueLabel||"Legenda";box.appendChild(t);
  // Category map: one swatch per category.
  if(E.render==="category"&&E.categoryLegend){
    E.categoryLegend.forEach(function(it){
      var row=document.createElement("div");row.className="lgd-row";
      row.innerHTML='<span class="lgd-sw2" style="background:'+esc(it.color)+'"></span>'+
        '<span class="lgd-lbl">'+esc(it.label)+'</span>';
      box.appendChild(row);});
    document.body.appendChild(box);return;
  }
  // Bivariate map: a 3×3 colour matrix.
  if(E.render==="bivariate"&&E.bivPalette){
    var grid=document.createElement("div");
    grid.style.cssText="display:grid;grid-template-columns:repeat(3,14px);grid-template-rows:repeat(3,14px);gap:2px";
    [2,1,0].forEach(function(r){[0,1,2].forEach(function(c){
      var sp=document.createElement("span");
      sp.style.cssText="width:14px;height:14px;background:"+E.bivPalette[r*3+c];
      grid.appendChild(sp);});});
    box.appendChild(grid);document.body.appendChild(box);return;
  }
  // Reader-facing clickable legend: each class toggles its visibility.
  if(E.readerFilters&&E.legendType==="steps"&&E.breaks){
    var hidden={};
    function applyFilter(){
      var hid=[];for(var k in hidden){if(hidden[k])hid.push(parseInt(k,10));}
      map.setFilter("d-fill",classFilter(hid));map.setFilter("d-line",classFilter(hid));
    }
    E.legendColors.forEach(function(c,i){
      var row=document.createElement("button");row.className="lgd-row";
      row.title="Mostra/Nascondi questa classe";
      row.innerHTML='<span class="lgd-sw2" style="background:'+esc(c)+'"></span>'+
        '<span class="lgd-lbl">'+esc(classLabel(i))+'</span>';
      row.onclick=function(){hidden[i]=!hidden[i];row.style.opacity=hidden[i]?"0.35":"1";applyFilter();};
      box.appendChild(row);
    });
  }else{
    var bar=document.createElement("div");bar.className="lgd-bar";
    if(E.legendType==="steps"){E.legendColors.forEach(function(c){
      var sp=document.createElement("span");sp.style.background=c;sp.style.flex="1";bar.appendChild(sp);});}
    else{bar.style.background="linear-gradient(to right,"+E.scaleColors.join(",")+")";}
    box.appendChild(bar);
    var mm=document.createElement("div");mm.className="lgd-mm";
    mm.innerHTML="<span>"+esc(fmt(E.min))+"</span><span>"+esc(fmt(E.max))+"</span>";box.appendChild(mm);
  }
  if(noData>0){var nd=document.createElement("div");nd.className="lgd-nd";
    nd.innerHTML='<span class="lgd-sw" style="background:'+esc(E.noData)+'"></span>'+esc(E.noDataLabel)+" ("+noData+")";
    box.appendChild(nd);}
  document.body.appendChild(box);
}
function classBounds(i){var b=E.breaks||[];
  return [i===0?-Infinity:b[i-1], i>=b.length?Infinity:b[i]];}
function classLabel(i){var bb=classBounds(i);
  if(bb[0]===-Infinity)return "< "+fmt(bb[1]);
  if(bb[1]===Infinity)return "\u2265 "+fmt(bb[0]);
  return fmt(bb[0])+" \u2013 "+fmt(bb[1]);}
function classFilter(hid){if(!hid.length)return null;
  var v=["to-number",["get","__value"]];
  var tests=hid.map(function(i){var bb=classBounds(i);
    if(bb[0]===-Infinity)return ["<",v,bb[1]];
    if(bb[1]===Infinity)return [">=",v,bb[0]];
    return ["all",[">=",v,bb[0]],["<",v,bb[1]]];});
  var any=tests.length===1?tests[0]:["any"].concat(tests);
  return ["!",["all",["has","__value"],any]];}
// Hover highlight: move a "hover" feature-state to the polygon under the cursor
// (read by the fill-opacity / line-width paint of the standard choropleth).
function hoverFx(){var hid=null;
  map.on("mousemove","d-fill",function(e){var f=e.features&&e.features[0];if(!f||f.id==null)return;
    if(hid!==null)map.setFeatureState({source:"d",id:hid},{hover:false});
    hid=f.id;map.setFeatureState({source:"d",id:hid},{hover:true});});
  map.on("mouseleave","d-fill",function(){if(hid!==null)map.setFeatureState({source:"d",id:hid},{hover:false});hid=null;});}
function tooltip(){
  var tip=document.getElementById("tip");
  function tplRender(tpl,vals){return tpl.replace(/\{([^{}]+)\}/g,function(_,t){
    var v=vals[String(t).replace(/^\s+|\s+$/g,"")];return v==null?"":esc(String(v));});}
  function hide(){if(tip)tip.style.opacity="0";map.getCanvas().style.cursor="";}
  // A single map-level handler with queryRenderedFeatures + a cursor-following
  // div (not a geo-anchored popup): on a pitched/globe 3D extrusion the ground
  // lngLat under the cursor projects far from the tall bar, so a popup drifts
  // and the per-layer mouseleave fires across the gaps between bars, flickering.
  map.on("mousemove",function(e){
    if(!map.getLayer("d-fill")){hide();return;}
    var f=map.queryRenderedFeatures(e.point,{layers:["d-fill"]})[0];
    if(!f){hide();return;}
    var p=f.properties||{};if(p.__value==null){hide();return;}
    var nm=(p.__name!=null?p.__name:p[E.nameField])||"";var html;
    // The painted value, formatted per render: a number, a category string, or
    // the two raw values of a bivariate map.
    var vtxt;
    if(E.render==="bivariate"){vtxt=fmt(p.__a)+" \u00b7 "+fmt(p.__b);}
    else if(typeof p.__value==="number"){vtxt=fmt(p.__value);}
    else{vtxt=String(p.__value);}
    if(E.tooltipTemplate){var vals={nome:nm,valore:vtxt};
      for(var k in p){if(k.indexOf("col:")===0)vals[k.slice(4)]=p[k];}
      html=tplRender(E.tooltipTemplate,vals);}
    else{html='<div class="studio-tooltip-name">'+esc(nm)+'</div>'+
      '<div class="studio-tooltip-value"><span>'+esc(E.valueLabel)+'</span> '+esc(vtxt)+'</div>';}
    if(tip){tip.innerHTML=html;
      var x=e.point.x,y=e.point.y,flip=x>map.getCanvas().clientWidth-180;
      tip.style.left=(flip?x-14:x+14)+"px";tip.style.top=(y+14)+"px";
      tip.style.transform=flip?"translateX(-100%)":"none";tip.style.opacity="1";}
    map.getCanvas().style.cursor="pointer";});
  map.on("mouseout",hide);
}
})();`;

/**
 * Build the full embed HTML for a **point** map (O4 publish, phase 2). All the
 * render-specific work (category colours, size scale, heatmap paint, hexbin
 * aggregation + classification) is precomputed here at build time, so the
 * inline renderer is a dumb applier with the coordinates inlined (no fetch).
 */
function buildPointEmbedHtml(spec: PointSpec, opts: EmbedOptions): string {
  const mlVer = EMBED_MAPLIBRE_VERSION;
  const d = spec.design;
  const title = escapeHtml(spec.project.title || "Mappa Zornade");
  const subtitle = escapeHtml(spec.project.subtitle || "");
  const source = escapeHtml(spec.project.source || "");
  const titleFont = escapeHtml(d.titleFont || "system-ui, sans-serif");
  const canonical = opts.selfUrl ? escapeHtml(opts.selfUrl) : "";

  let oembedLinks = "";
  if (opts.selfUrl) {
    try {
      const origin = new URL(opts.selfUrl).origin;
      const endpoint = `${origin}/api/oembed?url=${encodeURIComponent(opts.selfUrl)}`;
      oembedLinks =
        `<link rel="alternate" type="application/json+oembed" href="${endpoint}&amp;format=json" title="${title}">` +
        `<link rel="alternate" type="text/xml+oembed" href="${endpoint}&amp;format=xml" title="${title}">`;
    } catch {
      /* malformed selfUrl: discovery links are optional */
    }
  }

  const scaleColors = colorsForScale(d.colorScale, d.reverseScale);
  const noData = DEFAULT_NO_DATA_COLOR;
  const valueLabel = d.valueLabel || spec.fields.value || "Valore";

  // Distinct categories (first-seen) and the numeric value range.
  const categories: string[] = [];
  const seenCat = new Set<string>();
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of spec.points) {
    if (p.category != null && p.category !== "" && !seenCat.has(p.category)) {
      seenCat.add(p.category);
      categories.push(p.category);
    }
    if (typeof p.value === "number") {
      if (p.value < vMin) vMin = p.value;
      if (p.value > vMax) vMax = p.value;
    }
  }
  const valueRange =
    Number.isFinite(vMin) && Number.isFinite(vMax) ? { min: vMin, max: vMax } : undefined;
  const hasCategory = categories.length > 0;

  // The GeoJSON the embed renders + the per-render layer type/paint + legend.
  let layerType: "circle" | "heatmap" | "fill";
  let paint: Record<string, unknown>;
  let geojson: GeoJSON.FeatureCollection;
  let legendKind: "category" | "size" | "gradient" | "steps" | "none" = "none";
  let categoryLegend: { label: string; color: string }[] | null = null;
  let legendColors: string[] = [];
  let breaks: number[] = [];
  let rangeMin = valueRange?.min ?? 0;
  let rangeMax = valueRange?.max ?? 0;

  // Points as a FeatureCollection (shared by every render except hexbin).
  const pointFc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: spec.points.map((p) => {
      const props: Record<string, unknown> = {};
      if (typeof p.value === "number") props.__value = p.value;
      if (p.category != null) props.__cat = p.category;
      if (p.name != null) props.__name = p.name;
      return {
        type: "Feature",
        properties: props,
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      };
    }),
  };

  const circleColor = hasCategory
    ? buildPointColorExpression(categories, scaleColors, d.pointColor)
    : d.pointColor;

  if (spec.render === "heatmap") {
    layerType = "heatmap";
    geojson = pointFc;
    paint = buildHeatmapPaint({
      valueRange,
      colors: scaleColors,
      radius: Math.max(10, d.pointSize * 2.4),
    });
    legendKind = "gradient";
  } else if (spec.render === "hexbin") {
    layerType = "fill";
    const result = hexbin(
      spec.points.map((p) => ({ lng: p.lng, lat: p.lat })),
      { targetCols: 22 },
    );
    geojson = result.geojson;
    const classes = computeBreaks(
      result.counts,
      d.classification,
      d.nClasses,
      d.manualBreaks,
    );
    paint = {
      "fill-color": buildFillColorExpression(classes, scaleColors, noData),
      "fill-opacity": 0.78,
      "fill-outline-color": "rgba(255,255,255,0.4)",
    };
    legendKind = "steps";
    legendColors = sampleColors(scaleColors, classes.breaks.length + 1);
    breaks = classes.breaks;
    rangeMin = classes.min;
    rangeMax = classes.max;
  } else if (spec.render === "dotdensity") {
    layerType = "circle";
    geojson = pointFc;
    paint = {
      "circle-color": circleColor,
      "circle-radius": Math.max(2, d.pointSize * 0.45),
      "circle-opacity": 0.55,
    };
    legendKind = hasCategory ? "category" : "none";
  } else {
    // points / locator
    layerType = "circle";
    geojson = pointFc;
    const radius =
      spec.render === "points" && valueRange
        ? buildPointRadiusExpression(
            valueRange,
            Math.max(2, d.pointSize * 0.6),
            d.pointSize * 2.6,
            d.pointSize,
          )
        : Math.max(4, d.pointSize);
    paint = {
      "circle-color": circleColor,
      "circle-radius": radius,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
      "circle-opacity": 0.9,
    };
    legendKind = hasCategory ? "category" : valueRange ? "size" : "none";
  }

  if (legendKind === "category") {
    categoryLegend = categories.map((cat, i) => ({
      label: cat,
      color: scaleColors[i % scaleColors.length],
    }));
  }

  // Annotations (O3.4): same precompute as the area embed.
  const anns = spec.annotations ? sanitizeAnnotations(spec.annotations) : [];
  const annotGeo = annotationsToGeoJson(anns);
  const annotMarkers = markerAnnotations(anns);

  // Accessible data table: name + value (or category) per point.
  const tableFmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });
  const nameHeader = spec.fields.name || "Punto";
  const valueHeader = hasCategory
    ? spec.fields.category || "Categoria"
    : valueLabel + (d.valueUnit ? ` (${d.valueUnit})` : "");
  const dataTableHtml = spec.points.length
    ? accessibleTableHtml(
        [nameHeader, valueHeader],
        spec.points.map((p, i) => ({
          [nameHeader]: p.name || `#${i + 1}`,
          [valueHeader]: hasCategory
            ? p.category ?? ""
            : p.value != null
              ? tableFmt.format(p.value)
              : "",
        })),
        { caption: spec.project.title || "Dati della mappa" },
      )
    : "";

  const embed = {
    render: spec.render,
    geojson,
    layerType,
    paint,
    showLabels: spec.render === "locator",
    nameField: "__name",
    basemapStyle: resolveBasemap(d.basemap, d.customBasemapUrl ?? ""),
    center: (spec.camera?.center ?? (spec.globe ? [0, 20] : [12.5, 42])) as [number, number],
    zoom: spec.camera?.zoom ?? (spec.globe ? 1.5 : 5),
    pitch: spec.camera?.pitch ?? 0,
    bearing: spec.camera?.bearing ?? 0,
    hasCamera: !!spec.camera,
    bounds: spec.camera?.bounds ?? null,
    globe: spec.globe ?? false,
    interactive: !!d.zoomPan,
    tooltip: !!d.tooltip && spec.render !== "heatmap",
    showLegend: !!d.showLegend,
    legendKind,
    categoryLegend,
    legendColors,
    breaks,
    scaleColors,
    min: rangeMin,
    max: rangeMax,
    noData,
    valueLabel,
    valueUnit: d.valueUnit || "",
    tooltipTemplate: d.tooltipTemplate || "",
    annotGeo,
    annotMarkers,
  };

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${canonical ? `<link rel="canonical" href="${canonical}">` : ""}
${oembedLinks}
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@${mlVer}/dist/maplibre-gl.css">
<style>${EMBED_CSS}</style>
</head>
<body>
<div id="map"></div>
${spec.design.showTitle && title ? `<div class="ttl"><h1 style="font-family:${titleFont}">${title}</h1>${subtitle ? `<p style="font-family:${titleFont}">${subtitle}</p>` : ""}</div>` : ""}
${spec.design.showSource && source ? `<div class="src">${source}</div>` : ""}
<div class="attr"><a href="https://zornade.com/studio" target="_blank" rel="noopener">Fatto con Zornade Studio</a> · Dati © OpenStreetMap</div>
${dataTableHtml ? `<div class="sr-only">${dataTableHtml}</div>` : ""}
<script src="https://unpkg.com/maplibre-gl@${mlVer}/dist/maplibre-gl.js"></script>
<script>
const EMBED = ${jsonForScript(embed)};
${POINT_RENDERER}
</script>
</body>
</html>`;
}

/**
 * Inline renderer for a point embed: the coordinates and the per-render paint
 * are precomputed and inlined as `EMBED`, so this just adds the source + layer,
 * fits the camera, and wires the legend/tooltip. Self-contained, no fetch.
 */
const POINT_RENDERER = String.raw`
(function(){
var E=EMBED;
${RENDER_PRELUDE}
function sky(){try{map.setSky(E.globe?${SKY_GLOBE_JSON}:${SKY_FLAT_JSON});}catch(e){}}
var map=new maplibregl.Map({container:"map",
  style:E.basemapStyle||{version:8,sources:{},layers:[]},
  center:E.center,zoom:E.zoom,pitch:E.pitch,bearing:E.bearing,attributionControl:false,interactive:E.interactive});
map.addControl(new maplibregl.AttributionControl({compact:true}));
map.on("load",function(){if(E.globe){try{map.setProjection({type:"globe"});}catch(e){}}sky();build();});
function build(){
  map.addSource("d",{type:"geojson",data:E.geojson});
  map.addLayer({id:"d-fill",type:E.layerType,source:"d",paint:E.paint});
  if(E.showLabels){
    var firstSym=(map.getStyle().layers||[]).filter(function(l){return l.type==="symbol";})[0];
    var tf=["Noto Sans Regular"];
    if(firstSym){var f=map.getLayoutProperty(firstSym.id,"text-font");if(Array.isArray(f)&&f.length)tf=f;}
    map.addLayer({id:"d-label",type:"symbol",source:"d",
      layout:{"text-field":["get",E.nameField],"text-font":tf,"text-size":12,
        "text-anchor":"top","text-offset":[0,0.8],"text-max-width":10},
      paint:{"text-color":"#0f172a","text-halo-color":"#fff","text-halo-width":1.4}});
  }
  raiseLabels();
  if(!E.hasCamera&&!E.globe){fit();}else if(E.bounds){map.fitBounds(E.bounds,{pitch:E.pitch,bearing:E.bearing,duration:0,padding:0});}
  if(E.showLegend)legend();
  if(E.tooltip)tooltip();
  annotations();
}
function fit(){try{var b=new maplibregl.LngLatBounds();
  (E.geojson.features||[]).forEach(function(f){var g=f.geometry;if(!g)return;
    if(g.type==="Point")b.extend(g.coordinates);
    else if(g.type==="Polygon")g.coordinates[0].forEach(function(pt){b.extend(pt);});});
  if(!b.isEmpty())map.fitBounds(b,{padding:48,duration:0,maxZoom:9});}catch(e){}}
function legend(){
  if(E.legendKind==="none")return;
  var box=document.createElement("div");box.className="lgd";
  var t=document.createElement("p");t.className="lgd-t";t.textContent=E.valueLabel||"Legenda";box.appendChild(t);
  if(E.legendKind==="category"&&E.categoryLegend){
    E.categoryLegend.forEach(function(it){var row=document.createElement("div");row.className="lgd-row";
      row.innerHTML='<span class="lgd-sw2" style="background:'+esc(it.color)+'"></span>'+
        '<span>'+esc(it.label)+'</span>';box.appendChild(row);});
  }else if(E.legendKind==="steps"){
    var bar=document.createElement("div");bar.className="lgd-bar";
    E.legendColors.forEach(function(c){var sp=document.createElement("span");
      sp.style.background=c;sp.style.flex="1";bar.appendChild(sp);});
    box.appendChild(bar);
    var mm=document.createElement("div");mm.className="lgd-mm";
    mm.innerHTML="<span>"+esc(fmt(E.min))+"</span><span>"+esc(fmt(E.max))+"</span>";box.appendChild(mm);
  }else if(E.legendKind==="gradient"){
    var bar2=document.createElement("div");bar2.className="lgd-bar";
    bar2.style.background="linear-gradient(to right,transparent,"+E.scaleColors.join(",")+")";
    box.appendChild(bar2);
    var mm2=document.createElement("div");mm2.className="lgd-mm";
    mm2.innerHTML="<span>meno</span><span>pi\u00f9</span>";box.appendChild(mm2);
  }else if(E.legendKind==="size"){
    var wrap=document.createElement("div");wrap.style.cssText="display:flex;align-items:flex-end;gap:8px";
    [6,12].forEach(function(r){var sp=document.createElement("span");
      sp.style.cssText="display:inline-block;border-radius:50%;background:#94a3b8;width:"+r+"px;height:"+r+"px";
      wrap.appendChild(sp);});
    var lab=document.createElement("span");lab.style.cssText="font-size:10px;color:#64748b";
    lab.textContent=fmt(E.min)+" \u2013 "+fmt(E.max);wrap.appendChild(lab);box.appendChild(wrap);
  }
  document.body.appendChild(box);
}
function tooltip(){
  var pop=new maplibregl.Popup({closeButton:false,closeOnClick:false,className:"studio-tooltip"});
  function tpl(t,vals){return t.replace(/\{([^{}]+)\}/g,function(_,k){
    var v=vals[String(k).replace(/^\s+|\s+$/g,"")];return v==null?"":esc(String(v));});}
  map.on("mousemove","d-fill",function(e){var f=e.features&&e.features[0];if(!f)return;
    var p=f.properties||{};var nm=p.__name!=null?p.__name:"";
    var vtxt=p.__cat!=null?String(p.__cat):(p.__value!=null?fmt(Number(p.__value)):"");
    var html;
    if(E.tooltipTemplate){var vals={nome:nm,valore:vtxt};
      for(var k in p){if(k.indexOf("col:")===0)vals[k.slice(4)]=p[k];}html=tpl(E.tooltipTemplate,vals);}
    else{html='<div class="studio-tooltip-name">'+esc(nm)+'</div>'+
      (vtxt!==""?'<div class="studio-tooltip-value"><span>'+esc(E.valueLabel)+'</span> '+esc(vtxt)+'</div>':"");}
    pop.setLngLat(e.lngLat).setHTML(html).addTo(map);map.getCanvas().style.cursor="pointer";});
  map.on("mouseleave","d-fill",function(){pop.remove();map.getCanvas().style.cursor="";});
}
function annotations(){
  if(E.annotGeo&&E.annotGeo.features&&E.annotGeo.features.length){
    map.addSource("annot",{type:"geojson",data:E.annotGeo});
    map.addLayer({id:"annot-fill",type:"fill",source:"annot",
      filter:["==",["geometry-type"],"Polygon"],
      paint:{"fill-color":["get","__color"],"fill-opacity":["get","__opacity"]}});
    map.addLayer({id:"annot-line",type:"line",source:"annot",
      layout:{"line-cap":"round","line-join":"round"},
      paint:{"line-color":["get","__color"],"line-width":["get","__width"]}});
  }
  (E.annotMarkers||[]).forEach(function(m){
    var el=document.createElement("div");el.style.pointerEvents="none";
    if(m.type==="marker"){el.style.position="relative";
      var lbl=m.text?'<div style="position:absolute;bottom:38px;left:50%;transform:translateX(-50%);'+
        'white-space:nowrap;background:rgba(255,255,255,.92);color:#0f172a;padding:2px 7px;'+
        'border-radius:6px;font-size:12px;font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.2)">'+
        esc(m.text)+'</div>':"";
      el.innerHTML=lbl+pin(m.color);
      new maplibregl.Marker({element:el,anchor:"bottom"}).setLngLat([m.lng,m.lat]).addTo(map);
    }else{el.style.cssText="background:rgba(255,255,255,.85);padding:3px 8px;border-radius:6px;"+
      "font-weight:600;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.2);color:"+esc(m.color);
      el.textContent=m.text||"Testo";
      new maplibregl.Marker({element:el,anchor:"center"}).setLngLat([m.lng,m.lat]).addTo(map);}
  });
}
function pin(c){return '<svg width="24" height="34" viewBox="0 0 24 34" '+
  'style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">'+
  '<path d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 22 12 22s12-13.6 12-22C24 5.4 18.6 0 12 0z" '+
  'fill="'+esc(c)+'" stroke="#fff" stroke-width="2"/>'+
  '<circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>';}
})();`;

/**
 * Build the full embed HTML for a **custom-geometry** map (O4 publish, phase 3).
 * The user's geometry is inlined (already prepared with `__value`/`__cat`/
 * `__name`); the graduated/categorical colour expression + legend are computed
 * here at build time, so the inline renderer just draws the layers.
 */
function buildGeoEmbedHtml(spec: GeoSpec, opts: EmbedOptions): string {
  const mlVer = EMBED_MAPLIBRE_VERSION;
  const d = spec.design;
  const title = escapeHtml(spec.project.title || "Mappa Zornade");
  const subtitle = escapeHtml(spec.project.subtitle || "");
  const source = escapeHtml(spec.project.source || "");
  const titleFont = escapeHtml(d.titleFont || "system-ui, sans-serif");
  const canonical = opts.selfUrl ? escapeHtml(opts.selfUrl) : "";

  let oembedLinks = "";
  if (opts.selfUrl) {
    try {
      const origin = new URL(opts.selfUrl).origin;
      const endpoint = `${origin}/api/oembed?url=${encodeURIComponent(opts.selfUrl)}`;
      oembedLinks =
        `<link rel="alternate" type="application/json+oembed" href="${endpoint}&amp;format=json" title="${title}">` +
        `<link rel="alternate" type="text/xml+oembed" href="${endpoint}&amp;format=xml" title="${title}">`;
    } catch {
      /* malformed selfUrl: discovery links are optional */
    }
  }

  const scaleColors = colorsForScale(d.colorScale, d.reverseScale);
  const noData = DEFAULT_NO_DATA_COLOR;
  const valueLabel = spec.valueLabel || "Valore";

  // Colour: graduated by value, else categorical, else a single brand colour.
  let fillColor: unknown = d.pointColor;
  let lineColor: unknown = "#01646f";
  let circleColor: unknown = d.pointColor;
  let legendKind: "steps" | "category" | "none" = "none";
  let legendColors: string[] = [];
  let categoryLegend: { label: string; color: string }[] | null = null;
  let breaks: number[] = [];
  let rangeMin = 0;
  let rangeMax = 0;

  if (spec.hasValue) {
    const values: number[] = [];
    for (const f of spec.geojson.features) {
      const v = (f.properties as Record<string, unknown>)?.__value;
      if (typeof v === "number") values.push(v);
    }
    const classes = computeBreaks(values, d.classification, d.nClasses, d.manualBreaks);
    fillColor = buildFillColorExpression(classes, scaleColors, noData);
    legendKind = "steps";
    legendColors = sampleColors(scaleColors, classes.breaks.length + 1);
    breaks = classes.breaks;
    rangeMin = classes.min;
    rangeMax = classes.max;
  } else if (spec.hasCategory) {
    const expr = buildPointColorExpression(spec.categories, scaleColors, d.pointColor);
    fillColor = expr;
    lineColor = expr;
    circleColor = expr;
    legendKind = "category";
    categoryLegend = spec.categories.map((cat, i) => ({
      label: cat,
      color: scaleColors[i % scaleColors.length],
    }));
  }

  // Annotations (O3.4).
  const anns = spec.annotations ? sanitizeAnnotations(spec.annotations) : [];
  const annotGeo = annotationsToGeoJson(anns);
  const annotMarkers = markerAnnotations(anns);

  // Accessible table: __name + __value/__cat per feature.
  const tableFmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });
  const valueHeader = spec.hasCategory
    ? "Categoria"
    : valueLabel + (d.valueUnit ? ` (${d.valueUnit})` : "");
  const rowsForTable = spec.geojson.features.map((f, i) => {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const name = typeof p.__name === "string" && p.__name ? p.__name : `#${i + 1}`;
    const cell = spec.hasCategory
      ? typeof p.__cat === "string"
        ? p.__cat
        : ""
      : typeof p.__value === "number"
        ? tableFmt.format(p.__value)
        : "";
    return { Elemento: name, [valueHeader]: cell };
  });
  const dataTableHtml = rowsForTable.length
    ? accessibleTableHtml(["Elemento", valueHeader], rowsForTable, {
        caption: spec.project.title || "Dati della mappa",
      })
    : "";

  const embed = {
    geojson: spec.geojson,
    geometryKinds: spec.geometryKinds,
    fillColor,
    lineColor,
    circleColor,
    circleRadius: d.pointSize,
    nameField: "__name",
    basemapStyle: resolveBasemap(d.basemap, d.customBasemapUrl ?? ""),
    center: (spec.camera?.center ?? (spec.globe ? [0, 20] : [12.5, 42])) as [number, number],
    zoom: spec.camera?.zoom ?? (spec.globe ? 1.5 : 5),
    pitch: spec.camera?.pitch ?? 0,
    bearing: spec.camera?.bearing ?? 0,
    hasCamera: !!spec.camera,
    bounds: spec.camera?.bounds ?? null,
    globe: spec.globe ?? false,
    interactive: !!d.zoomPan,
    tooltip: !!d.tooltip,
    showLegend: !!d.showLegend,
    legendKind,
    categoryLegend,
    legendColors,
    breaks,
    scaleColors,
    min: rangeMin,
    max: rangeMax,
    noData,
    valueLabel,
    valueUnit: d.valueUnit || "",
    tooltipTemplate: d.tooltipTemplate || "",
    annotGeo,
    annotMarkers,
  };

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${canonical ? `<link rel="canonical" href="${canonical}">` : ""}
${oembedLinks}
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@${mlVer}/dist/maplibre-gl.css">
<style>${EMBED_CSS}</style>
</head>
<body>
<div id="map"></div>
${spec.design.showTitle && title ? `<div class="ttl"><h1 style="font-family:${titleFont}">${title}</h1>${subtitle ? `<p style="font-family:${titleFont}">${subtitle}</p>` : ""}</div>` : ""}
${spec.design.showSource && source ? `<div class="src">${source}</div>` : ""}
<div class="attr"><a href="https://zornade.com/studio" target="_blank" rel="noopener">Fatto con Zornade Studio</a> · Dati © OpenStreetMap</div>
${dataTableHtml ? `<div class="sr-only">${dataTableHtml}</div>` : ""}
<script src="https://unpkg.com/maplibre-gl@${mlVer}/dist/maplibre-gl.js"></script>
<script>
const EMBED = ${jsonForScript(embed)};
${GEO_RENDERER}
</script>
</body>
</html>`;
}

/**
 * Inline renderer for a custom-geometry embed: the prepared geometry and the
 * colour expressions are inlined as `EMBED`; this adds a fill layer (polygons),
 * a line layer (polygons outline + lines) and a circle layer (points), then
 * wires the legend/tooltip. Self-contained, no fetch.
 */
const GEO_RENDERER = String.raw`
(function(){
var E=EMBED;
${RENDER_PRELUDE}
// Insert above all basemap geometry (roads/buildings/boundaries), below labels.
// A raster background counts as geometry too, so the data stays above it.
function beforeId(){var ls=(map.getStyle().layers||[]),lg=-1,i,t;
  for(i=0;i<ls.length;i++){if(ls[i].id.indexOf("d-")===0)continue;t=ls[i].type;
    if(t==="fill"||t==="line"||t==="fill-extrusion"||t==="raster")lg=i;}
  for(i=lg+1;i<ls.length;i++){if(ls[i].id.indexOf("d-")!==0)return ls[i].id;}
  return undefined;}
function sky(){try{map.setSky(E.globe?${SKY_GLOBE_JSON}:${SKY_FLAT_JSON});}catch(e){}}
var map=new maplibregl.Map({container:"map",
  style:E.basemapStyle||{version:8,sources:{},layers:[]},
  center:E.center,zoom:E.zoom,pitch:E.pitch,bearing:E.bearing,attributionControl:false,interactive:E.interactive});
map.addControl(new maplibregl.AttributionControl({compact:true}));
map.on("load",function(){if(E.globe){try{map.setProjection({type:"globe"});}catch(e){}}sky();build();});
function build(){
  map.addSource("d",{type:"geojson",data:E.geojson});
  var before=beforeId();
  map.addLayer({id:"d-fill",type:"fill",source:"d",
    paint:{"fill-color":E.fillColor,"fill-opacity":0.7}},before);
  map.addLayer({id:"d-line",type:"line",source:"d",
    paint:{"line-color":E.lineColor,"line-width":1.2}},before);
  map.addLayer({id:"d-point",type:"circle",source:"d",
    paint:{"circle-color":E.circleColor,"circle-radius":E.circleRadius||5,
      "circle-stroke-color":"#fff","circle-stroke-width":1,"circle-opacity":0.9}},before);
  raiseLabels();
  if(!E.hasCamera&&!E.globe){fit();}else if(E.bounds){map.fitBounds(E.bounds,{pitch:E.pitch,bearing:E.bearing,duration:0,padding:0});}
  if(E.showLegend)legend();
  if(E.tooltip)tooltip();
  annotations();
}
function fit(){try{var b=new maplibregl.LngLatBounds();
  function ext(c){if(typeof c[0]==="number"){b.extend(c);}else{c.forEach(ext);}}
  (E.geojson.features||[]).forEach(function(f){if(f.geometry&&f.geometry.coordinates)ext(f.geometry.coordinates);});
  if(!b.isEmpty())map.fitBounds(b,{padding:48,duration:0,maxZoom:9});}catch(e){}}
function legend(){
  if(E.legendKind==="none")return;
  var box=document.createElement("div");box.className="lgd";
  var t=document.createElement("p");t.className="lgd-t";t.textContent=E.valueLabel||"Legenda";box.appendChild(t);
  if(E.legendKind==="category"&&E.categoryLegend){
    E.categoryLegend.forEach(function(it){var row=document.createElement("div");row.className="lgd-row";
      row.innerHTML='<span class="lgd-sw2" style="background:'+esc(it.color)+'"></span><span>'+esc(it.label)+'</span>';
      box.appendChild(row);});
  }else if(E.legendKind==="steps"){
    var bar=document.createElement("div");bar.className="lgd-bar";
    E.legendColors.forEach(function(c){var sp=document.createElement("span");sp.style.background=c;sp.style.flex="1";bar.appendChild(sp);});
    box.appendChild(bar);
    var mm=document.createElement("div");mm.className="lgd-mm";
    mm.innerHTML="<span>"+esc(fmt(E.min))+"</span><span>"+esc(fmt(E.max))+"</span>";box.appendChild(mm);
  }
  document.body.appendChild(box);
}
function tooltip(){
  var pop=new maplibregl.Popup({closeButton:false,closeOnClick:false,className:"studio-tooltip"});
  function tpl(t,vals){return t.replace(/\{([^{}]+)\}/g,function(_,k){
    var v=vals[String(k).replace(/^\s+|\s+$/g,"")];return v==null?"":esc(String(v));});}
  function show(e){var f=e.features&&e.features[0];if(!f)return;var p=f.properties||{};
    var nm=p.__name!=null?p.__name:"";
    var vtxt=p.__cat!=null?String(p.__cat):(p.__value!=null?fmt(Number(p.__value)):"");
    var html;
    if(E.tooltipTemplate){var vals={nome:nm,valore:vtxt};
      for(var k in p){if(k.indexOf("col:")===0)vals[k.slice(4)]=p[k];}html=tpl(E.tooltipTemplate,vals);}
    else{html='<div class="studio-tooltip-name">'+esc(nm)+'</div>'+
      (vtxt!==""?'<div class="studio-tooltip-value"><span>'+esc(E.valueLabel)+'</span> '+esc(vtxt)+'</div>':"");}
    pop.setLngLat(e.lngLat).setHTML(html).addTo(map);map.getCanvas().style.cursor="pointer";}
  function hide(){pop.remove();map.getCanvas().style.cursor="";}
  ["d-fill","d-line","d-point"].forEach(function(id){
    map.on("mousemove",id,show);map.on("mouseleave",id,hide);});
}
function annotations(){
  if(E.annotGeo&&E.annotGeo.features&&E.annotGeo.features.length){
    map.addSource("annot",{type:"geojson",data:E.annotGeo});
    map.addLayer({id:"annot-fill",type:"fill",source:"annot",
      filter:["==",["geometry-type"],"Polygon"],
      paint:{"fill-color":["get","__color"],"fill-opacity":["get","__opacity"]}});
    map.addLayer({id:"annot-line",type:"line",source:"annot",
      layout:{"line-cap":"round","line-join":"round"},
      paint:{"line-color":["get","__color"],"line-width":["get","__width"]}});
  }
  (E.annotMarkers||[]).forEach(function(m){
    var el=document.createElement("div");el.style.pointerEvents="none";
    if(m.type==="marker"){el.style.position="relative";
      var lbl=m.text?'<div style="position:absolute;bottom:38px;left:50%;transform:translateX(-50%);'+
        'white-space:nowrap;background:rgba(255,255,255,.92);color:#0f172a;padding:2px 7px;'+
        'border-radius:6px;font-size:12px;font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.2)">'+
        esc(m.text)+'</div>':"";
      el.innerHTML=lbl+pin(m.color);
      new maplibregl.Marker({element:el,anchor:"bottom"}).setLngLat([m.lng,m.lat]).addTo(map);
    }else{el.style.cssText="background:rgba(255,255,255,.85);padding:3px 8px;border-radius:6px;"+
      "font-weight:600;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.2);color:"+esc(m.color);
      el.textContent=m.text||"Testo";
      new maplibregl.Marker({element:el,anchor:"center"}).setLngLat([m.lng,m.lat]).addTo(map);}
  });
}
function pin(c){return '<svg width="24" height="34" viewBox="0 0 24 34" '+
  'style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">'+
  '<path d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 22 12 22s12-13.6 12-22C24 5.4 18.6 0 12 0z" '+
  'fill="'+esc(c)+'" stroke="#fff" stroke-width="2"/>'+
  '<circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>';}
})();`;

