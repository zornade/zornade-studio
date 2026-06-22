/**
 * probe:portals — live health check for every open-data source in the registry.
 *
 * Run with:  npm run probe:portals  [-- options]
 *
 * Options:
 *   --source=<id>     probe only this source (default: all)
 *   --samples=<n>     datasets to sample per source        (default: 5)
 *   --resources=<n>   resources to verify per dataset      (default: 2)
 *   --timeout=<ms>    per-request timeout                  (default: 20000)
 *   --full            sample more datasets/resources (20 / 5)
 *   --no-resources    only check the catalogue API, skip resource downloads
 *
 * What it does, for EVERY source (active AND blacklisted):
 *   1. queries the catalogue API through the same shared adapter the proxy uses;
 *   2. samples some datasets and verifies their resources actually download
 *      (status 200 and not an HTML landing page);
 *   3. reconciles against {@link SOURCE_BLACKLIST}: an active source that is
 *      down is flagged for blacklisting, and a blacklisted source that answers
 *      again is flagged for promotion back to active.
 *
 * It writes a machine-readable report to scripts/probe-report.json and prints a
 * human summary. It is intentionally OUTSIDE the vitest suite: it depends on the
 * network and on third-party uptime, so it must never break offline CI.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  OPEN_DATA_SOURCES,
  SOURCE_BLACKLIST,
  isBlacklisted,
  type OpenDataSource,
} from "../src/lib/sources";
import { searchSource, type NormalisedDataset } from "../src/lib/catalog-search";

interface ResourceCheck {
  url: string;
  format: string;
  ok: boolean;
  status: number;
  contentType: string;
  note?: string;
}
interface DatasetCheck {
  title: string;
  landing: string;
  resources: ResourceCheck[];
}
interface SourceReport {
  id: string;
  label: string;
  kind: string;
  blacklisted: boolean;
  apiOk: boolean;
  count: number;
  error?: string;
  datasets: DatasetCheck[];
  resourcesOk: number;
  resourcesDead: number;
}

// --- options ---------------------------------------------------------------

const argv = process.argv.slice(2);
function opt(name: string): string | undefined {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
}
const FULL = opt("full") !== undefined;
const SAMPLES = Number(opt("samples") ?? (FULL ? 20 : 5)) || 5;
const RES_PER = Number(opt("resources") ?? (FULL ? 5 : 2)) || 2;
const TIMEOUT = Number(opt("timeout") ?? 20000) || 20000;
const CHECK_RESOURCES = opt("no-resources") === undefined;
const ONLY = opt("source");

const sources = OPEN_DATA_SOURCES.filter((s) => !ONLY || s.id === ONLY);
if (sources.length === 0) {
  console.error(`Nessuna fonte con id "${ONLY}". Id validi: ${OPEN_DATA_SOURCES.map((s) => s.id).join(", ")}`);
  process.exit(1);
}

// --- resource downloadability ----------------------------------------------

/**
 * A resource is "loadable" if it answers 200 with a data content-type — NOT an
 * HTML landing page (mirrors the /api/fetch proxy's 415 rule). We read only the
 * headers and then cancel the body so we never download large files.
 */
async function checkResource(url: string, format: string): Promise<ResourceCheck> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "user-agent": "ZornadeStudio/1.0", accept: "*/*", range: "bytes=0-2048" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    await res.body?.cancel().catch(() => {});
    const isHtml = /text\/html|application\/xhtml/i.test(ct);
    const ok = res.ok && !isHtml;
    return {
      url,
      format,
      ok,
      status: res.status,
      contentType: ct,
      note: !res.ok ? `HTTP ${res.status}` : isHtml ? "pagina HTML, non un file" : undefined,
    };
  } catch (e) {
    const name = e instanceof Error ? e.name : "errore";
    return { url, format, ok: false, status: 0, contentType: "", note: name === "TimeoutError" ? "timeout" : "irraggiungibile" };
  }
}

/** Retry an async op once on failure, with a short pause — tolerates slow PA portals. */
async function withRetry<T>(op: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await op();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw last;
}

async function probeSource(source: OpenDataSource): Promise<SourceReport> {
  const report: SourceReport = {
    id: source.id,
    label: source.label,
    kind: source.kind,
    blacklisted: isBlacklisted(source.id),
    apiOk: false,
    count: 0,
    datasets: [],
    resourcesOk: 0,
    resourcesDead: 0,
  };

  let datasets: NormalisedDataset[] = [];
  try {
    // Retry once before declaring a source down: some PA portals are simply
    // slow/intermittent (e.g. a 20s response), and a single timeout must NOT
    // produce a false blacklist suggestion.
    const result = await withRetry(() => searchSource(source, { rows: SAMPLES }, fetch, TIMEOUT));
    report.apiOk = true;
    report.count = result.count;
    datasets = result.results.slice(0, SAMPLES);
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    return report;
  }

  if (CHECK_RESOURCES) {
    for (const d of datasets) {
      const checks: ResourceCheck[] = [];
      for (const r of d.resources.slice(0, RES_PER)) {
        const c = await checkResource(r.url, r.format);
        checks.push(c);
        if (c.ok) report.resourcesOk += 1;
        else report.resourcesDead += 1;
      }
      report.datasets.push({ title: d.title, landing: d.landing, resources: checks });
    }
  }
  return report;
}

// --- run -------------------------------------------------------------------

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main(): Promise<void> {
  console.log(
    `probe:portals — ${sources.length} fonti · samples=${SAMPLES} · risorse/dataset=${RES_PER}` +
      `${CHECK_RESOURCES ? "" : " · solo-API"} · timeout=${TIMEOUT}ms\n`,
  );

  const reports: SourceReport[] = [];
  for (const s of sources) {
    process.stdout.write(`· ${pad(s.id, 18)} `);
    const r = await probeSource(s);
    reports.push(r);
    if (!r.apiOk) {
      console.log(`[DOWN]  ${r.error ?? ""}`);
    } else {
      const resPart = CHECK_RESOURCES
        ? ` · risorse ${r.resourcesOk}/${r.resourcesOk + r.resourcesDead} ok`
        : "";
      console.log(`[OK]    ${pad(r.kind, 8)} catalogo ${r.count}${resPart}`);
    }
  }

  // Blacklist reconciliation.
  const toBlacklist = reports.filter((r) => !r.blacklisted && !r.apiOk);
  const toPromote = reports.filter((r) => r.blacklisted && r.apiOk);
  const deadResourceSources = reports.filter((r) => r.apiOk && r.resourcesDead > 0);

  console.log("\n— Riconciliazione blacklist —");
  if (toBlacklist.length === 0 && toPromote.length === 0) {
    console.log("Nessuna modifica suggerita: stato coerente con il registry.");
  }
  if (toBlacklist.length > 0) {
    console.log("\n  Fonti ATTIVE ma giù → valuta di aggiungerle a SOURCE_BLACKLIST:");
    for (const r of toBlacklist) {
      console.log(`    { id: "${r.id}", reason: ${JSON.stringify(r.error ?? "non raggiungibile")}, since: "${today()}" },`);
    }
  }
  if (toPromote.length > 0) {
    console.log("\n  Fonti in BLACKLIST ma di nuovo attive → rimuovile da SOURCE_BLACKLIST:");
    for (const r of toPromote) console.log(`    - ${r.id} (${r.label})`);
  }
  if (deadResourceSources.length > 0) {
    console.log("\n  Fonti con risorse morte (campione) — link rotti lato portale, gestiti a runtime:");
    for (const r of deadResourceSources) {
      console.log(`    - ${pad(r.id, 18)} ${r.resourcesDead} risorse non scaricabili su ${r.resourcesOk + r.resourcesDead} controllate`);
    }
  }

  const reportPath = resolve(dirname(fileURLToPath(import.meta.url)), "probe-report.json");
  writeFileSync(
    reportPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), options: { SAMPLES, RES_PER, TIMEOUT, CHECK_RESOURCES }, blacklist: SOURCE_BLACKLIST, reports }, null, 2),
  );
  console.log(`\nReport completo: ${reportPath}`);

  // Exit non-zero only when an ACTIVE source is down (actionable regression).
  process.exit(toBlacklist.length > 0 ? 1 : 0);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
