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
} from "lucide-react";
import { useStudio } from "../../studio/StudioContext";
import { PanelSection, Button, SoonBadge } from "../primitives";

export function PublishPanel() {
  const studio = useStudio();
  const { project, data, exportNodeRef } = studio;
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  const slug =
    project.title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "mappa";

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
      setExportError("Apri prima la mappa (passo Dati).");
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

  return (
    <div className="space-y-6">
      <PanelSection
        title="Pubblica & incorpora"
        hint="Genera uno snapshot immutabile e ottieni il codice da incollare."
      >
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
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "SVG", icon: FileCode2 },
            { label: "PDF", icon: FileText },
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
          Export SVG, social e animazioni in arrivo.
        </div>
      </PanelSection>

      <PanelSection
        title="Accessibilità"
        hint="Rendi la mappa fruibile a tutti."
      >
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 opacity-80">
          <input type="checkbox" disabled defaultChecked className="h-4 w-4 rounded accent-zornade" />
          <Table2 size={15} />
          Tabella dati scaricabile / leggibile da screen reader
          <SoonBadge />
        </label>
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
