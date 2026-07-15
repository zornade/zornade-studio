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
import { getSupabaseAccessToken } from "../../lib/supabase";
import { useAuth } from "../../auth/AuthContext";
import { useSupabaseAuth } from "../../auth/SupabaseAuthContext";
import { AuthGateModal } from "../AuthGateModal";
import { useI18n } from "../../i18n/LanguageContext";

export function PublishPanel() {
  const studio = useStudio();
  const { project, data, exportNodeRef } = studio;
  const { isAuthed: legacyAuthed } = useAuth();
  const { isAuthed: supabaseAuthed, isConfigured: supabaseConfigured } = useSupabaseAuth();
  const { dict } = useI18n();
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [showAuthGate, setShowAuthGate] = useState(false);

  const slug =
    project.title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "mappa";

  // SVG export is a real vector export only for the Plot charts.
  const isChart = isChartType(studio.vizType);

  /**
   * Build the spec, send it to /api/publish, and keep the immutable URL.
   * Login-only-when-necessary (2026-07-13): if Supabase is configured on
   * this deploy and the visitor hasn't signed in through EITHER method
   * accepted server-side (see netlify/functions/_auth.mts), show the
   * contextual auth prompt instead of firing a request that would just
   * 401 - the modal retries this same call automatically once signed in.
   */
  const publish = async () => {
    if (supabaseConfigured && !supabaseAuthed && !legacyAuthed) {
      setShowAuthGate(true);
      return;
    }
    setPublishing(true);
    setPublishError(null);
    try {
      const { buildSpec } = await import("../../lib/spec");
      // Capture the current map camera (center/zoom/pitch/bearing) so the embed
      // renders at exactly the viewport the user configured.
      const camera = studio.mapApiRef.current?.getCamera() ?? null;
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
        storySteps: studio.storySteps,
        camera,
      });
      if ("error" in out) {
        setPublishError(out.error);
        return;
      }
      // Attach the Supabase session token, if any, so the endpoint can
      // authenticate magic-link users (see netlify/functions/_auth.mts) -
      // falls back to the legacy cookie (sent automatically) when absent.
      const accessToken = await getSupabaseAccessToken();
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ spec: out.spec }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.url) {
        setPublishError(body.error ?? dict.publishPanel.publishFailedGeneric(res.status));
        return;
      }
      setPublishedUrl(body.url);
    } catch (e) {
      setPublishError(
        e instanceof Error ? dict.publishPanel.publishFailedWithMessage(e.message) : dict.publishPanel.networkError,
      );
    } finally {
      setPublishing(false);
    }
  };

  /** Export the live map (with title/legend/source overlays) as a PNG. */
  const exportPng = async () => {
    const node = exportNodeRef.current;
    if (!node) {
      setExportError(dict.publishPanel.loadDataFirst);
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
        // canvas just in case (defensive - keeps the export from failing hard).
        filter: (el) =>
          !(el instanceof HTMLElement && el.dataset.exportIgnore === "true"),
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${slug}.png`;
      a.click();
    } catch (e) {
      setExportError(
        e instanceof Error ? dict.publishPanel.exportFailed(e.message) : dict.publishPanel.exportFailedGeneric,
      );
    } finally {
      setExporting(false);
    }
  };

  /** Export a chart as a true vector SVG (the largest Plot-rendered svg). */
  const exportSvg = async () => {
    const node = exportNodeRef.current;
    if (!node) {
      setExportError(dict.publishPanel.loadDataFirst);
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      // A Plot figure may hold several svgs (a categorical legend + the chart);
      // pick the largest by rendered area so we export the chart itself.
      const svgs = Array.from(node.querySelectorAll("svg"));
      if (svgs.length === 0) {
        setExportError(dict.publishPanel.noVectorChart);
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
        e instanceof Error ? dict.publishPanel.exportSvgFailed(e.message) : dict.publishPanel.exportSvgFailedGeneric,
      );
    } finally {
      setExporting(false);
    }
  };

  /** Export the current view as a single-page PDF (raster JPEG wrapped). */
  const exportPdf = async () => {
    const node = exportNodeRef.current;
    if (!node) {
      setExportError(dict.publishPanel.loadDataFirst);
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
        e instanceof Error ? dict.publishPanel.exportPdfFailed(e.message) : dict.publishPanel.exportPdfFailedGeneric,
      );
    } finally {
      setExporting(false);
    }
  };

  /** Download the loaded dataset as a CSV (accessible, machine-readable). */
  const downloadCsv = () => {
    if (!data) {
      setExportError(dict.publishPanel.loadDataFirst);
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
  //
  // The comment below deliberately keeps the two attribution obligations
  // SEPARATE (verified against the OSMF Attribution Guideline and the ODbL
  // text, 2026-07-07 - see /memories/repo/ for the research notes): the OSM
  // credit is a genuine, universal condition of the ODbL data licence (it
  // cannot be waived by Zornade, on any plan); the "Mappa di Zornade" link is
  // Zornade's own Terms of Service condition for the free hosted embed - the
  // same model used by Datawrapper ("Created with Datawrapper" on the free
  // plan, removable only on paid plans) and Flourish ("with attribution" on
  // the free plan). Conflating the two into a single "required by ODbL and
  // ToS" claim would misstate what OSM's licence actually requires.
  //
  // The caption deliberately splits TWO links with two different targets
  // (same pattern as Datawrapper's own footer, which separates "Get the
  // data" from "Created with Datawrapper" into distinct anchors, 2026-07-07
  // research): the title links to the map's OWN page (publishedUrl) so a
  // reader can click through to see/share the actual map full-size; "Mappa
  // di Zornade" links straight to the zornade.com/studio marketing page, so
  // the external backlink from the THIRD-PARTY site (the one with real SEO
  // value) lands directly on the product page instead of being diluted
  // through an extra hop via the embed's own page.
  const embed = publishedUrl
    ? `<!--
  ${dict.publishPanel.embedComment}
-->
<figure style="margin:0">
  <iframe src="${publishedUrl}" width="100%" height="520" frameborder="0" scrolling="no" title="${project.title}" loading="lazy"></iframe>
  <figcaption style="font:13px/1.45 system-ui,-apple-system,sans-serif;color:#475569;margin-top:6px">
    <a href="${publishedUrl}" target="_blank" rel="noopener">${project.title}</a> - <a href="https://zornade.com/studio?utm_source=studio.zornade.com&amp;utm_medium=embed&amp;utm_campaign=share_caption_attribution" target="_blank" rel="noopener">${dict.publishPanel.embedZornadeLinkText}</a> · ${dict.publishPanel.embedDataCreditPrefix} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>
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
      storySteps: studio.storySteps,
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
      setProjectError(dict.publishPanel.cannotReadProjectFile);
    }
  };

  return (
    <div className="space-y-6">
      <PanelSection
        title={dict.publishPanel.projectSection}
        hint={dict.publishPanel.projectHint}
      >
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => void saveProject()}>
            <Save size={15} />
            {dict.publishPanel.saveProject}
          </Button>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-zornade hover:text-zornade-700">
            <FolderOpen size={15} />
            {dict.publishPanel.openProject}
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
          {dict.publishPanel.projectFooterHint}
        </p>
      </PanelSection>

      <PanelSection
        title={dict.publishPanel.publishSection}
        hint={dict.publishPanel.publishHint}
      >
        {!isChartType(studio.vizType) && studio.vizType !== "table" && (
          <div className="mb-3">
            <p className="mb-1.5 text-xs font-medium text-slate-600">
              {dict.publishPanel.embedFraming}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => studio.updateDesign({ lockView: false })}
                className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                  !studio.design.lockView
                    ? "border-zornade bg-zornade/5 text-zornade"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                <span className="block font-medium">{dict.publishPanel.fitData}</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {dict.publishPanel.fitDataHint}
                </span>
              </button>
              <button
                type="button"
                onClick={() => studio.updateDesign({ lockView: true })}
                className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                  studio.design.lockView
                    ? "border-zornade bg-zornade/5 text-zornade"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                <span className="block font-medium">{dict.publishPanel.useCurrentView}</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {dict.publishPanel.useCurrentViewHint}
                </span>
              </button>
            </div>
            {studio.design.lockView && (
              <p className="mt-1.5 text-[11px] text-slate-400">
                {dict.publishPanel.lockViewNote}
              </p>
            )}
          </div>
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
          {publishing
            ? dict.publishPanel.publishing
            : publishedUrl
              ? dict.publishPanel.republish
              : isChartType(studio.vizType) || studio.vizType === "table"
                ? dict.publishPanel.publishChart
                : dict.publishPanel.publishMap}
        </button>
        {publishError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {publishError}
          </p>
        )}
        {!data && (
          <p className="text-xs text-slate-500">
            {dict.publishPanel.loadDataBeforePublish}
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
              {copied ? dict.publishPanel.copied : dict.publishPanel.copyEmbedCode}
            </Button>
            <p className="text-xs text-slate-500">
              {dict.publishPanel.publishedUrlNote}
            </p>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {dict.publishPanel.attributionNote}
            </p>
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
              <strong>{dict.publishPanel.wordpressNoteBold}</strong> {dict.publishPanel.wordpressNote}
            </p>
          </>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" disabled className="h-4 w-4 rounded accent-zornade" />
          {dict.publishPanel.mobileVariantLabel}
          <Smartphone size={14} className="text-slate-400" />
          <SoonBadge />
        </label>
      </PanelSection>

      <PanelSection title={dict.publishPanel.exportSection}>
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
          {exporting ? dict.publishPanel.generatingPng : dict.publishPanel.downloadPng}
        </button>
        {exportError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {exportError}
          </p>
        )}
        {!data && (
          <p className="text-xs text-slate-500">
            {dict.publishPanel.loadDataToExport}
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
                ? dict.publishPanel.svgOnlyForCharts
                : dict.publishPanel.svgOnlyForChartsDisabled
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
            {dict.publishPanel.svgHint}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: dict.publishPanel.socialLabel, icon: Share2 },
            { label: dict.publishPanel.posterLabel, icon: LayoutTemplate },
            { label: dict.publishPanel.gifMp4Label, icon: Film },
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
          {dict.publishPanel.socialSoonHint}
        </div>
      </PanelSection>

      <PanelSection
        title={dict.publishPanel.accessibilitySection}
        hint={dict.publishPanel.accessibilityHint}
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
          {dict.publishPanel.downloadCsv}
        </button>
        <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          <Table2 size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
          {dict.publishPanel.hiddenTableNote}
        </p>
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 opacity-80">
          <input type="checkbox" disabled defaultChecked className="h-4 w-4 rounded accent-zornade" />
          {dict.publishPanel.altTextCheckLabel}
          <SoonBadge />
        </label>
      </PanelSection>

      <PanelSection title={dict.publishPanel.analyticsSection} hint={dict.publishPanel.analyticsHint}>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: dict.publishPanel.views, value: "-", icon: TrendingUp },
            { label: dict.publishPanel.interactions, value: "-", icon: Share2 },
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
          {dict.publishPanel.availableAfterPublish}
        </div>
      </PanelSection>

      {showAuthGate && (
        <AuthGateModal
          message={dict.publishPanel.authGateMessage}
          onClose={() => setShowAuthGate(false)}
          onAuthed={() => {
            setShowAuthGate(false);
            void publish();
          }}
        />
      )}
    </div>
  );
}
