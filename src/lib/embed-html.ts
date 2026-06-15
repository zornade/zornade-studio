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

/** Pinned MapLibre version for embeds (matches the app's maplibre-gl). */
export const EMBED_MAPLIBRE_VERSION = "4.7.1";

export interface EmbedOptions {
  /** Base URL where `{level}.geojson` geometries are served (no trailing /). */
  geoBaseUrl: string;
  /** Public URL of this embed (for the canonical/attribution link). */
  selfUrl?: string;
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
  const title = escapeHtml(spec.project.title || "Mappa Zornade");
  const subtitle = escapeHtml(spec.project.subtitle || "");
  const source = escapeHtml(spec.project.source || "");
  const geoUrl = `${opts.geoBaseUrl}/${spec.geo.level}.geojson`;
  const canonical = opts.selfUrl ? escapeHtml(opts.selfUrl) : "";

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
  .src{position:absolute;left:12px;bottom:24px;font-size:11px;color:#475569;z-index:2}
  .attr{position:absolute;right:8px;bottom:6px;font-size:11px;z-index:2;
    background:rgba(255,255,255,.85);padding:2px 6px;border-radius:6px}
  .attr a{color:#01646f;text-decoration:none}
</style>
</head>
<body>
<div id="map"></div>
${spec.design.showTitle && title ? `<div class="ttl"><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ""}</div>` : ""}
${spec.design.showSource && source ? `<div class="src">${source}</div>` : ""}
<div class="attr"><a href="https://zornade.com/studio" target="_blank" rel="noopener">Fatto con Zornade Studio</a> · Dati © OpenStreetMap</div>
<script src="https://unpkg.com/maplibre-gl@${mlVer}/dist/maplibre-gl.js"></script>
<script>
const SPEC = ${jsonForScript(spec)};
const GEO_URL = ${jsonForScript(geoUrl)};
${EMBED_RENDERER}
</script>
</body>
</html>`;
}

/**
 * The inline renderer: fetches the geometry, joins the spec data by normalised
 * key (code → name → alias mirror of joinChoropleth), computes quantile/equal
 * breaks, and paints the choropleth. Kept as a string so it ships inside the
 * static embed with no build step.
 */
const EMBED_RENDERER = String.raw`
function nk(v){if(v==null)return"";var s=String(v).trim().toLowerCase();
  if(/^\d$/.test(s))s="0"+s;s=s.split("/")[0].trim();
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"");}
var FIELDS={paesi:["iso_a3","name","iso_a2","name_en"],
  regioni:["reg_istat_code","reg_name"],
  province:["prov_acr","prov_name","prov_istat_code"],
  comuni:["com_istat_code","com_name","com_istat_code_num"]};
var NAMEF={paesi:"name",regioni:"reg_name",province:"prov_name",comuni:"com_name"};
var SCALES={"teal-seq":["#e6f5f6","#9ad6db","#32a4ae","#01646f"],
  "blue-seq":["#eaf2fb","#9ec5e8","#4a90d9","#1b4f8a"],
  "warm-seq":["#fff3e0","#ffb74d","#f57c00","#bf360c"],
  "div-rdbu":["#b2182b","#f4a582","#f7f7f7","#92c5de","#2166ac"]};
var NO_DATA="#e2e8f0";
function hx(h){var m=/^#?([0-9a-f]{6})$/i.exec(h);if(!m)return[0,0,0];
  var n=parseInt(m[1],16);return[(n>>16)&255,(n>>8)&255,n&255];}
function lerp(a,b,t){var x=hx(a),y=hx(b);
  return"#"+[0,1,2].map(function(i){var v=Math.round(x[i]+(y[i]-x[i])*t);
    return("0"+v.toString(16)).slice(-2);}).join("");}
function ramp(cs,n){if(n<=1)return[cs[cs.length-1]];var o=[];
  for(var i=0;i<n;i++){var p=(i/(n-1))*(cs.length-1),lo=Math.floor(p),hi=Math.ceil(p);
    o.push(lerp(cs[lo],cs[hi],p-lo));}return o;}
function quantile(v,k){var s=v.slice().sort(function(a,b){return a-b;}),r=[];
  for(var i=1;i<k;i++){var q=(i/k)*(s.length-1),lo=Math.floor(q),hi=Math.ceil(q);
    r.push(s[lo]+(s[hi]-s[lo])*(q-lo));}return asc(r);}
function equal(v,k){var mn=Math.min.apply(null,v),mx=Math.max.apply(null,v),st=(mx-mn)/k,r=[];
  for(var i=1;i<k;i++)r.push(mn+st*i);return asc(r);}
function asc(a){var o=[];for(var i=0;i<a.length;i++)if(!o.length||a[i]>o[o.length-1])o.push(a[i]);return o;}
fetch(GEO_URL).then(function(r){return r.json();}).then(function(geo){
  var byKey={};SPEC.data.forEach(function(d){byKey[nk(d.key)]=d.value;});
  var fields=FIELDS[SPEC.geo.level]||[],vals=[];
  geo.features.forEach(function(f){var p=f.properties||{},val;
    for(var i=0;i<fields.length;i++){var kk=nk(p[fields[i]]);
      if(kk&&byKey.hasOwnProperty(kk)){val=byKey[kk];break;}}
    if(val!=null){p.__value=val;vals.push(val);}else{delete p.__value;}});
  var k=Math.max(2,Math.min(SPEC.design.nClasses||5,vals.length||2));
  var br=vals.length?(SPEC.design.classification==="equal"?equal(vals,k):
    SPEC.design.classification==="manual"&&SPEC.design.manualBreaks.length?asc(SPEC.design.manualBreaks.slice().sort(function(a,b){return a-b;})):
    quantile(vals,k)):[];
  var cs=SCALES[SPEC.design.colorScale]||SCALES["teal-seq"],rmp=ramp(cs,br.length+1);
  var step=["step",["to-number",["get","__value"]],rmp[0]];
  br.forEach(function(b,i){step.push(b,rmp[i+1]);});
  var fill=["case",["==",["typeof",["get","__value"]],"number"],step,NO_DATA];
  var styleUrl="https://tiles.openfreemap.org/styles/"+(SPEC.design.basemap&&SPEC.design.basemap.indexOf("ofm-")===0?SPEC.design.basemap.slice(4):"positron");
  var map=new maplibregl.Map({container:"map",style:styleUrl,center:[12.5,42],zoom:4.4,
    attributionControl:false,interactive:!!SPEC.design.zoomPan});
  map.addControl(new maplibregl.AttributionControl({compact:true}));
  map.on("load",function(){
    map.addSource("d",{type:"geojson",data:geo});
    var firstSym=(map.getStyle().layers||[]).filter(function(l){return l.type==="symbol";})[0];
    map.addLayer({id:"d-fill",type:"fill",source:"d",
      paint:{"fill-color":fill,"fill-opacity":.82}},firstSym&&firstSym.id);
    map.addLayer({id:"d-line",type:"line",source:"d",
      paint:{"line-color":"#fff","line-width":.6}},firstSym&&firstSym.id);
    try{var b=new maplibregl.LngLatBounds();
      geo.features.forEach(function(f){
        var g=f.geometry;if(!g)return;var cc=g.type==="Polygon"?[g.coordinates]:
          g.type==="MultiPolygon"?g.coordinates:null;if(!cc)return;
        cc.forEach(function(poly){poly[0].forEach(function(pt){b.extend(pt);});});});
      if(!b.isEmpty())map.fitBounds(b,{padding:24,duration:0,maxZoom:9});}catch(e){}
    if(SPEC.design.tooltip){
      var pop=new maplibregl.Popup({closeButton:false,closeOnClick:false});
      var nf=new Intl.NumberFormat("it-IT",{maximumFractionDigits:2});
      var unit=SPEC.design.valueUnit?("\u00a0"+SPEC.design.valueUnit):"";
      var lbl=SPEC.design.valueLabel||SPEC.geo.valueColumn||"Valore";
      map.on("mousemove","d-fill",function(e){var f=e.features&&e.features[0];if(!f)return;
        var p=f.properties||{};if(p.__value==null){pop.remove();return;}
        var nm=p[NAMEF[SPEC.geo.level]]||"";
        pop.setLngLat(e.lngLat).setHTML("<strong>"+nm+"</strong><br>"+lbl+": "+nf.format(p.__value)+unit).addTo(map);
        map.getCanvas().style.cursor="pointer";});
      map.on("mouseleave","d-fill",function(){pop.remove();map.getCanvas().style.cursor="";});
    }
  });
});`;
