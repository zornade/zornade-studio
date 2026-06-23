import { useState } from "react";
import {
  Copy,
  Check,
  FileImage,
  FileCode2,
  FileText,
  Film,
  LayoutTemplate,
  Share2,
  Table2,
  Smartphone,
  TrendingUp,
  Save,
  FolderOpen,
  Download,
} from "lucide-react";
import { useStudio } from "../../studio/StudioContext";
import { PanelSection, Button, SoonBadge } from "../primitives";
import { isChartType } from "../../lib/chart-data";
import { rowsToCsv } from "../../lib/data-table";

export function PublishPanel() {
  const studio = useStudio();
  const { project, data, exportNodeRef } = studio;
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);

  const slug =
    project.title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "mappa";

  // SVG export is a real vector export only for the Plot charts.
  const isChart = isChartType(studio.vizType);

  /** Build the spec, send it to /api/publish, and keep the immutable URL. */
  const publish = async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      const { buildSpec } = await import("../../lib/spec");
      const out = buildSpec({
        step: studio.step,
        project: studio.project,
        dataSource: studio.dataSource,
        vizType: studio.vizType,
        preset: studio.preset,
        brand: studio.brand,
        design: studio.design,
        data: studio.data,
        annotations: studio.annotations,
      });
      if ("error" in out) {
        setPublishError(out.error);
        return;
      }
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec: out.spec }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.url) {
        setPublishError(body.error ?? `Pubblicazione fallita (${res.status}).`);
        return;
      }
      setPublishedUrl(body.url);
    } catch (e) {
      setPublishError(
        e instanceof Error ? `Pubblicazione fallita: ${e.message}` : "Errore di rete.",
      );
    } finally {
      setPublishing(false);
    }
  };

  /** Export the live map (with title/legend/source overlays) as a PNG. */
  const exportPng = async () => {
    const node = exportNodeRef.current;
    if (!node) {
      setExportError("Carica prima i dati (passo Dati).");
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      // Lazy-load html-to-image so it isn't in the initial bundle.
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        cacheBust: true,
        // The map tiles are same-origin/CORS-enabled; skip nodes that taint the
        // canvas just in case (defensive — keeps the export from failing hard).
        filter: (el) =>
          !(el instanceof HTMLElement && el.dataset.exportIgnore === "true"),
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${slug}.png`;
      a.click();
    } catch (e) {
      setExportError(
        e instanceof Error ? `Export fallito: ${e.message}` : "Export fallito.",
      );
    } finally {
      setExporting(false);
    }
  };

  /** Export a chart as a true vector SVG (the largest Plot-rendered svg). */
  const exportSvg = async () => {
    const node = exportNodeRef.current;
    if (!node) {
      setExportError("Carica prima i dati (passo Dati).");
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      // A Plot figure may hold several svgs (a categorical legend + the chart);
      // pick the largest by rendered area so we export the chart itself.
      const svgs = Array.from(node.querySelectorAll("svg"));
      if (svgs.length === 0) {
        setExportError("Nessun grafico vettoriale da esportare.");
        return;
      }
      const target = svgs.reduce((best, s) => {
        const a = s.clientWidth * s.clientHeight;
        const b = best.clientWidth * best.clientHeight;
        return a > b ? s : best;
      });
      const clone = target.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
      const xml = new XMLSerializer().serializeToString(clone);
      const doc = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
      const blob = new Blob([doc], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(
        e instanceof Error ? `Export SVG fallito: ${e.message}` : "Export SVG fallito.",
      );
    } finally {
      setExporting(false);
    }
  };

  /** Export the current view as a single-page PDF (raster JPEG wrapped). */
  const exportPdf = async () => {
    const node = exportNodeRef.current;
    if (!node) {
      setExportError("Carica prima i dati (passo Dati).");
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const { toJpeg } = await import("html-to-image");
      const dataUrl = await toJpeg(node, {
        pixelRatio: 2,
        quality: 0.92,
        backgroundColor: "#ffffff",
        cacheBust: true,
        filter: (el) =>
          !(el instanceof HTMLElement && el.dataset.exportIgnore === "true"),
      });
      const base64 = dataUrl.split(",")[1] ?? "";
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const { buildJpegPdf } = await import("../../lib/pdf");
      const pdf = buildJpegPdf(bytes);
      const blob = new Blob([pdf as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(
        e instanceof Error ? `Export PDF fallito: ${e.message}` : "Export PDF fallito.",
      );
    } finally {
      setExporting(false);
    }
  };

  /** Download the loaded dataset as a CSV (accessible, machine-readable). */
  const downloadCsv = () => {
    if (!data) {
      setExportError("Carica prima i dati (passo Dati).");
      return;
    }
    const csv = rowsToCsv(data.columns, data.rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // The embed snippet only makes sense once a real, immutable URL exists.
  const embed = publishedUrl
    ? `<!--
  Mappa realizzata con Zornade Studio — https://zornade.com/studio
  ATTRIBUZIONE OBBLIGATORIA. Questa mappa contiene dati © OpenStreetMap (licenza
  ODbL) ed elaborazioni proprietarie Zornade. Il mantenimento dei crediti e del
  link a zornade.com è richiesto dalle licenze dei dati (ODbL) e dai Termini di
  servizio dell'embed: la rimozione costituisce una violazione di licenza.
  Non rimuovere né nascondere questo blocco e la didascalia sottostante.
-->
<figure style="margin:0">
  <iframe src="${publishedUrl}" width="100%" height="520" frameborder="0" scrolling="no" title="${project.title}" loading="lazy"></iframe>
  <figcaption style="font:13px/1.45 system-ui,-apple-system,sans-serif;color:#475569;margin-top:6px">
    <a href="${publishedUrl}" target="_blank" rel="noopener">${project.title} — Mappa di Zornade</a> · Dati © OpenStreetMap
  </figcaption>
</figure>`
    : "";

  const copy = () => {
    if (!embed) return;
    navigator.clipboard?.writeText(embed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  // Save the full editable project to a downloadable .json file.
  const saveProject = async () => {
    setProjectError(null);
    const { serialiseProject } = await import("../../lib/project");
    const json = serialiseProject({
      step: studio.step,
      project: studio.project,
      dataSource: studio.dataSource,
      vizType: studio.vizType,
      preset: studio.preset,
      brand: studio.brand,
      design: studio.design,
      data: studio.data,
      annotations: studio.annotations,
    });
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.zornade.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Open a saved project file and replace the editor state.
  const openProject = async (file: File) => {
    setProjectError(null);
    try {
      const text = await file.text();
      const { parseProject } = await import("../../lib/project");
      const out = parseProject(text);
      if ("error" in out) {
        setProjectError(out.error);
        return;
      }
      studio.loadProject(out.state);
    } catch {
      setProjectError("Impossibile leggere il file del progetto.");
    }
  };

  return (
    <div className="space-y-6">
      <PanelSection
        title="Progetto"
        hint="Salva il lavoro su file e riaprilo quando vuoi."
      >
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => void saveProject()}>
            <Save size={15} />
            Salva progetto
          </Button>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-zornade hover:text-zornade-700">
            <FolderOpen size={15} />
            Apri progetto
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void openProject(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {projectError && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {projectError}
          </p>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          Il lavoro viene salvato in automatico in questo browser; “Salva
          progetto” crea un file che puoi archiviare o spostare.
        </p>
      </PanelSection>

      <PanelSection
        title="Pubblica & incorpora"
        hint="Genera uno snapshot immutabile e ottieni il codice da incollare."
      >
        {data &&
          (isChartType(studio.vizType) ||
            studio.vizType === "table" ||
            data.kind === "table") && (
          <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
            L'incorporamento (embed) è disponibile per ora solo per le mappe. I
            grafici e le tabelle puoi comunque scaricarli come immagine PNG qui
            sotto.
          </p>
        )}
        <button
          onClick={publish}
          disabled={!data || publishing}
          className={`flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-colors ${
            !data || publishing
              ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
              : "border-zornade bg-zornade text-white hover:opacity-90"
          }`}
        >
          {publishing ? "Pubblico…" : publishedUrl ? "Ripubblica" : "Pubblica mappa"}
        </button>
        {publishError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {publishError}
          </p>
        )}
        {!data && (
          <p className="text-xs text-slate-500">
            Carica i dati e scegli la mappa prima di pubblicare.
          </p>
        )}

        {publishedUrl && (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <code className="block whitespace-pre-wrap break-all font-mono text-xs text-slate-600">
                {embed}
              </code>
            </div>
            <Button variant="primary" onClick={copy} className="w-full">
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copiato!" : "Copia codice embed"}
            </Button>
            <p className="text-xs text-slate-500">
              Snapshot statico immutabile su CDN: questo URL resta raggiungibile
              in modo permanente e non cambia se in seguito modifichi il progetto.
            </p>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Lo snippet include i crediti e il link a Zornade: l'attribuzione è
              richiesta dalle licenze dei dati (ODbL di OpenStreetMap) e dai
              Termini di servizio. Non va rimossa.
            </p>
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
              <strong>WordPress:</strong> incolla direttamente questo URL in un
              blocco a sé (oEmbed) e la mappa comparirà automaticamente, senza
              usare lo snippet HTML.
            </p>
          </>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" disabled className="h-4 w-4 rounded accent-zornade" />
          Genera variante mobile dedicata
          <Smartphone size={14} className="text-slate-400" />
          <SoonBadge />
        </label>
      </PanelSection>

      <PanelSection title="Esporta">
        <button
          onClick={exportPng}
          disabled={!data || exporting}
          className={`flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-colors ${
            !data || exporting
              ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
              : "border-zornade bg-zornade-50 text-zornade-700 hover:bg-zornade-100"
          }`}
        >
          <FileImage size={18} />
          {exporting ? "Genero PNG…" : "Scarica PNG"}
        </button>
        {exportError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {exportError}
          </p>
        )}
        {!data && (
          <p className="text-xs text-slate-500">
            Carica i dati e apri la mappa per esportarla.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={exportPdf}
            disabled={!data || exporting}
            className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition-colors ${
              !data || exporting
                ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                : "border-zornade bg-zornade-50 text-zornade-700 hover:bg-zornade-100"
            }`}
          >
            <FileText size={16} />
            PDF
          </button>
          <button
            onClick={exportSvg}
            disabled={!data || !isChart || exporting}
            title={
              isChart
                ? "Esporta il grafico come SVG vettoriale"
                : "SVG vettoriale disponibile solo per i grafici"
            }
            className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition-colors ${
              !data || !isChart || exporting
                ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                : "border-zornade bg-zornade-50 text-zornade-700 hover:bg-zornade-100"
            }`}
          >
            <FileCode2 size={16} />
            SVG
          </button>
        </div>
        {!isChart && data && (
          <p className="text-[11px] text-slate-400">
            L'SVG vettoriale è disponibile per i grafici; le mappe (WebGL) si
            esportano in PNG o PDF.
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Social", icon: Share2 },
            { label: "Poster", icon: LayoutTemplate },
            { label: "GIF/MP4", icon: Film },
          ].map((f) => {
            const Icon = f.icon;
            return (
              <button
                key={f.label}
                disabled
                className="flex cursor-not-allowed flex-col items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-4 text-slate-500 opacity-70"
              >
                <Icon size={20} />
                <span className="text-xs font-medium">{f.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <SoonBadge />
          Grafica social, poster e animazioni in arrivo.
        </div>
      </PanelSection>

      <PanelSection
        title="Accessibilità"
        hint="Rendi la mappa fruibile a tutti."
      >
        <button
          onClick={downloadCsv}
          disabled={!data}
          className={`flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition-colors ${
            !data
              ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
              : "border-zornade bg-zornade-50 text-zornade-700 hover:bg-zornade-100"
          }`}
        >
          <Download size={16} />
          Scarica i dati (CSV)
        </button>
        <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          <Table2 size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
          Le mappe pubblicate includono una tabella dati nascosta, leggibile
          dagli screen reader, con i valori per area.
        </p>
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 opacity-80">
          <input type="checkbox" disabled defaultChecked className="h-4 w-4 rounded accent-zornade" />
          Testo alternativo + check contrasto/daltonismo
          <SoonBadge />
        </label>
      </PanelSection>

      <PanelSection title="Analytics" hint="Engagement dell'embed pubblicato.">
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Visualizzazioni", value: "—", icon: TrendingUp },
            { label: "Interazioni", value: "—", icon: Share2 },
          ].map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.label}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <Icon size={16} className="text-slate-400" />
                <p className="mt-1 text-lg font-semibold text-slate-700">
                  {m.value}
                </p>
                <p className="text-xs text-slate-500">{m.label}</p>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <SoonBadge />
          Disponibile dopo la pubblicazione.
        </div>
      </PanelSection>
    </div>
  );
}
