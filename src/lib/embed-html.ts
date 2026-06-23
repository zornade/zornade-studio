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
import { frameLabel } from "./temporal";
import {
  annotationsToGeoJson,
  markerAnnotations,
  sanitizeAnnotations,
} from "./annotations";

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
  // fall back to classifying the raw spec data when none were supplied. For a
  // temporal map the fallback classifies over EVERY frame's values so colours
  // are comparable across periods (a value means the same colour over time).
  const fallbackValues = spec.frames
    ? spec.frames.flatMap((f) => f.data.map((dd) => dd.value))
    : Object.values(keyed);
  const classes =
    opts.classes ??
    computeBreaks(fallbackValues, d.classification, d.nClasses, d.manualBreaks);
  const scaleColors = colorsForScale(d.colorScale, d.reverseScale);
  const noData = DEFAULT_NO_DATA_COLOR;
  const fill = buildFillColorExpression(classes, scaleColors, noData);
  const legendColors = sampleColors(scaleColors, classes.breaks.length + 1);
  const { fields, nameField } = geoJoinFields(spec.geo.level);
  const valueLabel = d.valueLabel || spec.geo.valueColumn || "Valore";

  // Temporal frames: normalised key→value per period, with a human label. The
  // initial paint uses `keyed` (= spec.data = newest frame); the slider swaps
  // in another frame's `keyed` at runtime, keeping the shared fill/classes.
  const frames = spec.frames
    ? spec.frames.map((f) => {
        const k: Record<string, number> = {};
        for (const dd of f.data) {
          const nk = normaliseKey(dd.key);
          if (nk !== "") k[nk] = dd.value;
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
    breaks: classes.breaks,
    readerFilters: !!d.readerFilters,
    scaleColors,
    min: classes.min,
    max: classes.max,
    noData,
    valueLabel,
    valueUnit: d.valueUnit || "",
    noDataLabel: "Dato non disponibile",
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
  var noData=paint(E.keyed);
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
  if(E.frames&&E.frames.length>1)timeUI();
  annotations();
}
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
  if(!b.isEmpty())map.fitBounds(b,{padding:24,duration:0,maxZoom:9});}catch(e){}}
function legend(noData){
  var box=document.createElement("div");box.className="lgd";
  var t=document.createElement("p");t.className="lgd-t";t.textContent=E.valueLabel||"Legenda";box.appendChild(t);
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
