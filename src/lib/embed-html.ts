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

import type { ChoroplethSpec } from "./spec";
import {
  computeBreaks,
  geoJoinFields,
  buildFillColorExpression,
  sampleColors,
  normaliseKey,
  DEFAULT_NO_DATA_COLOR,
  type ClassBreaks,
} from "./choropleth";
import { colorsForScale, basemapStyleUrl } from "../studio/palettes";

/** Pinned MapLibre version for embeds (matches the app's maplibre-gl). */
export const EMBED_MAPLIBRE_VERSION = "4.7.1";

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
 * Build the full embed HTML for a choropleth spec. The renderer script joins
 * the spec data onto the geometry and paints a MapLibre choropleth; it is kept
 * dependency-light and inline so the document is self-contained.
 */
export function buildEmbedHtml(
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

  // --- Render config, computed ONCE with the same canonical functions the
  // editor uses, so the published map is faithful to the live preview. The
  // renderer below only *applies* these values; it never re-derives breaks. ---
  // Values keyed by normalised key, mirroring joinChoropleth's valueByKey
  // (last value wins for duplicate keys); breaks come from these values.
  const keyed: Record<string, number> = {};
  for (const datum of spec.data) {
    const k = normaliseKey(datum.key);
    if (k === "") continue;
    keyed[k] = datum.value;
  }
  // Extra columns referenced by a custom tooltip template, keyed by normalised
  // key (only present when the spec carries them).
  const extraByKey: Record<string, Record<string, string>> = {};
  for (const datum of spec.data) {
    if (!datum.extra) continue;
    const k = normaliseKey(datum.key);
    if (k !== "") extraByKey[k] = datum.extra;
  }
  // Prefer the breaks computed against the real geometry (matched values only);
  // fall back to classifying the raw spec data when none were supplied.
  const classes =
    opts.classes ??
    computeBreaks(Object.values(keyed), d.classification, d.nClasses, d.manualBreaks);
  const scaleColors = colorsForScale(d.colorScale, d.reverseScale);
  const noData = DEFAULT_NO_DATA_COLOR;
  const fill = buildFillColorExpression(classes, scaleColors, noData);
  const legendColors = sampleColors(scaleColors, classes.breaks.length + 1);
  const { fields, nameField } = geoJoinFields(spec.geo.level);
  const valueLabel = d.valueLabel || spec.geo.valueColumn || "Valore";

  const embed = {
    geoUrl,
    fields,
    nameField,
    keyed,
    fill,
    basemapStyle: basemapStyleUrl(d.basemap),
    center: [12.5, 42] as [number, number],
    zoom: 4.4,
    interactive: !!d.zoomPan,
    tooltip: !!d.tooltip,
    showLegend: !!d.showLegend,
    legendType: d.legendType,
    legendColors,
    scaleColors,
    min: classes.min,
    max: classes.max,
    noData,
    valueLabel,
    valueUnit: d.valueUnit || "",
    noDataLabel: "Dato non disponibile",
    tooltipTemplate: d.tooltipTemplate || "",
    extraByKey,
  };

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${canonical ? `<link rel="canonical" href="${canonical}">` : ""}
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@${mlVer}/dist/maplibre-gl.css">
<style>
  html,body{margin:0;height:100%;font-family:system-ui,-apple-system,sans-serif}
  #map{position:absolute;inset:0}
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
  .attr{position:absolute;right:8px;bottom:6px;font-size:11px;z-index:2;
    background:rgba(255,255,255,.85);padding:2px 6px;border-radius:6px}
  .attr a{color:#01646f;text-decoration:none}
  .studio-tooltip .maplibregl-popup-content{padding:8px 10px;border-radius:10px;
    box-shadow:0 4px 14px rgba(15,23,42,.18);font-family:system-ui,-apple-system,sans-serif}
  .studio-tooltip .maplibregl-popup-tip{display:none}
  .studio-tooltip-name{font-weight:600;font-size:13px;color:#0f172a}
  .studio-tooltip-value{margin-top:2px;font-size:12px;color:#334155}
  .studio-tooltip-value span{color:#64748b;text-transform:capitalize}
</style>
</head>
<body>
<div id="map"></div>
${spec.design.showTitle && title ? `<div class="ttl"><h1 style="font-family:${titleFont}">${title}</h1>${subtitle ? `<p style="font-family:${titleFont}">${subtitle}</p>` : ""}</div>` : ""}
${spec.design.showSource && source ? `<div class="src">${source}</div>` : ""}
<div class="attr"><a href="https://zornade.com/studio" target="_blank" rel="noopener">Fatto con Zornade Studio</a> · Dati © OpenStreetMap</div>
<script src="https://unpkg.com/maplibre-gl@${mlVer}/dist/maplibre-gl.js"></script>
<script>
const EMBED = ${jsonForScript(embed)};
${EMBED_RENDERER}
</script>
</body>
</html>`;
}

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
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
var NF=new Intl.NumberFormat("it-IT",{maximumFractionDigits:2});
function fmt(n){var s=NF.format(n);return E.valueUnit?(s+"\u00a0"+E.valueUnit):s;}
var map=new maplibregl.Map({container:"map",
  style:E.basemapStyle||{version:8,sources:{},layers:[]},
  center:E.center,zoom:E.zoom,attributionControl:false,interactive:E.interactive});
map.addControl(new maplibregl.AttributionControl({compact:true}));
var GEO=null,ready=false;
map.on("load",function(){ready=true;if(GEO)build();});
fetch(E.geoUrl).then(function(r){return r.json();}).then(function(g){GEO=g;if(ready)build();});
function build(){
  var noData=0;
  GEO.features.forEach(function(f){var p=f.properties||(f.properties={});var val,mk="";
    for(var i=0;i<E.fields.length;i++){var k=nk(p[E.fields[i]]);
      if(k&&Object.prototype.hasOwnProperty.call(E.keyed,k)){val=E.keyed[k];mk=k;break;}}
    if(val!=null){p.__value=val;
      if(E.extraByKey&&E.extraByKey[mk]){var ex=E.extraByKey[mk];
        for(var c in ex){if(Object.prototype.hasOwnProperty.call(ex,c))p["col:"+c]=ex[c];}}
    }else{delete p.__value;noData++;}});
  map.addSource("d",{type:"geojson",data:GEO});
  var firstSym=(map.getStyle().layers||[]).filter(function(l){return l.type==="symbol";})[0];
  var before=firstSym&&firstSym.id;
  map.addLayer({id:"d-fill",type:"fill",source:"d",
    paint:{"fill-color":E.fill,"fill-opacity":0.82}},before);
  map.addLayer({id:"d-line",type:"line",source:"d",
    paint:{"line-color":"#fff","line-width":0.6}},before);
  fit();
  if(E.showLegend)legend(noData);
  if(E.tooltip)tooltip();
}
function fit(){try{var b=new maplibregl.LngLatBounds();
  GEO.features.forEach(function(f){var g=f.geometry;if(!g)return;
    var cc=g.type==="Polygon"?[g.coordinates]:g.type==="MultiPolygon"?g.coordinates:null;
    if(!cc)return;cc.forEach(function(poly){poly[0].forEach(function(pt){b.extend(pt);});});});
  if(!b.isEmpty())map.fitBounds(b,{padding:24,duration:0,maxZoom:9});}catch(e){}}
function legend(noData){
  var box=document.createElement("div");box.className="lgd";
  var t=document.createElement("p");t.className="lgd-t";t.textContent=E.valueLabel||"Legenda";box.appendChild(t);
  var bar=document.createElement("div");bar.className="lgd-bar";
  if(E.legendType==="steps"){E.legendColors.forEach(function(c){
    var sp=document.createElement("span");sp.style.background=c;sp.style.flex="1";bar.appendChild(sp);});}
  else{bar.style.background="linear-gradient(to right,"+E.scaleColors.join(",")+")";}
  box.appendChild(bar);
  var mm=document.createElement("div");mm.className="lgd-mm";
  mm.innerHTML="<span>"+esc(fmt(E.min))+"</span><span>"+esc(fmt(E.max))+"</span>";box.appendChild(mm);
  if(noData>0){var nd=document.createElement("div");nd.className="lgd-nd";
    nd.innerHTML='<span class="lgd-sw" style="background:'+esc(E.noData)+'"></span>'+esc(E.noDataLabel)+" ("+noData+")";
    box.appendChild(nd);}
  document.body.appendChild(box);
}
function tooltip(){
  var pop=new maplibregl.Popup({closeButton:false,closeOnClick:false,className:"studio-tooltip"});
  function tplRender(tpl,vals){return tpl.replace(/\{([^{}]+)\}/g,function(_,t){
    var v=vals[String(t).replace(/^\s+|\s+$/g,"")];return v==null?"":esc(String(v));});}
  map.on("mousemove","d-fill",function(e){var f=e.features&&e.features[0];if(!f)return;
    var p=f.properties||{};if(p.__value==null){pop.remove();map.getCanvas().style.cursor="";return;}
    var nm=p[E.nameField]||"";var html;
    if(E.tooltipTemplate){var vals={nome:nm,valore:fmt(p.__value)};
      for(var k in p){if(k.indexOf("col:")===0)vals[k.slice(4)]=p[k];}
      html=tplRender(E.tooltipTemplate,vals);}
    else{html='<div class="studio-tooltip-name">'+esc(nm)+'</div>'+
      '<div class="studio-tooltip-value"><span>'+esc(E.valueLabel)+'</span> '+esc(fmt(p.__value))+'</div>';}
    pop.setLngLat(e.lngLat).setHTML(html).addTo(map);
    map.getCanvas().style.cursor="pointer";});
  map.on("mouseleave","d-fill",function(){pop.remove();map.getCanvas().style.cursor="";});
}
})();`;
