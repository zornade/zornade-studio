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
  const { project } = useStudio();
  const [copied, setCopied] = useState(false);

  const slug =
    project.title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "mappa";

  const embed = `<!--
  Mappa realizzata con Zornade Studio — https://zornade.com/studio
  ATTRIBUZIONE OBBLIGATORIA. Questa mappa contiene dati © OpenStreetMap (licenza
  ODbL) ed elaborazioni proprietarie Zornade. Il mantenimento dei crediti e del
  link a zornade.com è richiesto dalle licenze dei dati (ODbL) e dai Termini di
  servizio dell'embed: la rimozione costituisce una violazione di licenza.
  Non rimuovere né nascondere questo blocco e la didascalia sottostante.
-->
<figure style="margin:0">
  <iframe src="https://studio.zornade.com/embed/${slug}" width="100%" height="520" frameborder="0" scrolling="no" title="${project.title}" loading="lazy"></iframe>
  <figcaption style="font:13px/1.45 system-ui,-apple-system,sans-serif;color:#475569;margin-top:6px">
    <a href="https://zornade.com/mappe/${slug}/" target="_blank" rel="noopener">${project.title} — Mappa di Zornade</a> · Dati © OpenStreetMap
  </figcaption>
</figure>`;

  const copy = () => {
    navigator.clipboard?.writeText(embed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="space-y-6">
      <PanelSection
        title="Incorpora"
        hint="Codice responsive da incollare nel tuo articolo."
      >
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
          Lo snapshot statico verrà pubblicato su CDN e resterà raggiungibile in
          modo permanente.
        </p>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Lo snippet include i crediti e il link a Zornade: l'attribuzione è
          richiesta dalle licenze dei dati (ODbL di OpenStreetMap) e dai Termini
          di servizio. Non va rimossa.
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" disabled className="h-4 w-4 rounded accent-zornade" />
          Genera variante mobile dedicata
          <Smartphone size={14} className="text-slate-400" />
          <SoonBadge />
        </label>
      </PanelSection>

      <PanelSection title="Esporta">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "PNG", icon: FileImage },
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
          Export immagini, social e animazioni in arrivo.
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
