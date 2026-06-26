import { describe, it, expect } from "vitest";
import { searchSource, PortalError } from "./catalog-search";
import { sourceById } from "./sources";

/** Build a mock fetch that returns the given JSON, recording the called URL. */
function mockJson(payload: unknown, ok = true, status = 200) {
  const calls: string[] = [];
  const fn = (url: string) => {
    calls.push(url);
    return Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(payload),
    } as Response);
  };
  return { fn, calls };
}

describe("catalog-search · CKAN adapter", () => {
  const toscana = sourceById("toscana")!;

  it("normalises packages, keeps only usable resources, drops empty datasets", async () => {
    const { fn } = mockJson({
      result: {
        count: 42,
        results: [
          {
            id: "p1",
            name: "popolazione-comuni",
            title: "Popolazione comuni",
            notes: "n".repeat(400),
            organization: { title: "Regione Toscana" },
            resources: [
              { format: "CSV", name: "dati", url: "https://x/dati.csv" },
              { format: "PDF", name: "doc", url: "https://x/doc.pdf" }, // not usable
            ],
          },
          {
            id: "p2",
            name: "solo-pdf",
            title: "Solo PDF",
            resources: [{ format: "PDF", name: "d", url: "https://x/d.pdf" }],
          },
        ],
      },
    });

    const out = await searchSource(toscana, { q: "popolazione", rows: 10 }, fn);
    expect(out.portal).toBe(toscana.label);
    expect(out.count).toBe(42);
    expect(out.results).toHaveLength(1); // p2 dropped (no usable resource)
    const d = out.results[0];
    expect(d.resources).toHaveLength(1);
    expect(d.resources[0].format).toBe("CSV");
    expect(d.notes.length).toBe(280); // truncated
    expect(d.landing).toBe("https://dati.toscana.it/dataset/popolazione-comuni");
    expect(d.publisher).toBe("Regione Toscana");
  });

  it("builds the CKAN query URL with q/rows/start", async () => {
    const { fn, calls } = mockJson({ result: { count: 0, results: [] } });
    await searchSource(toscana, { q: "rifiuti", rows: 5, start: 10 }, fn);
    expect(calls[0]).toContain("package_search?q=rifiuti&rows=5&start=10");
  });

  it("throws PortalError on non-200", async () => {
    const { fn } = mockJson({}, false, 503);
    await expect(searchSource(toscana, {}, fn)).rejects.toBeInstanceOf(PortalError);
  });
});

describe("catalog-search · Socrata adapter", () => {
  const lombardia = sourceById("lombardia")!;

  it("scopes to the portal domain and only=dataset", async () => {
    const { fn, calls } = mockJson({ results: [], resultSetSize: 0 });
    await searchSource(lombardia, { q: "popolazione", rows: 3 }, fn);
    const url = calls[0];
    expect(url).toContain("search_context=www.dati.lombardia.it");
    expect(url).toContain("domains=www.dati.lombardia.it");
    expect(url).toContain("only=dataset");
    expect(url).toContain("q=popolazione");
  });

  it("normalises datasets, builds CSV url on the dataset's own domain, uses permalink", async () => {
    const { fn } = mockJson({
      resultSetSize: 7,
      results: [
        {
          resource: { id: "abcd-1234", name: "Popolazione", description: "desc", attribution: "Regione Lombardia", type: "dataset" },
          metadata: { domain: "www.dati.lombardia.it" },
          permalink: "https://www.dati.lombardia.it/d/abcd-1234",
        },
        {
          // federated result from another domain — own domain must be used for the URL
          resource: { id: "wxyz-9999", name: "Friuli pop", type: "dataset" },
          metadata: { domain: "www.dati.friuliveneziagiulia.it" },
          permalink: "https://www.dati.friuliveneziagiulia.it/d/wxyz-9999",
        },
        {
          // non-dataset (map/chart) must be skipped
          resource: { id: "skip-0000", name: "Mappa", type: "map" },
          metadata: { domain: "www.dati.lombardia.it" },
        },
      ],
    });

    const out = await searchSource(lombardia, {}, fn);
    expect(out.count).toBe(7);
    expect(out.results).toHaveLength(2); // map skipped
    expect(out.results[0].resources[0].url).toBe("https://www.dati.lombardia.it/resource/abcd-1234.csv");
    expect(out.results[0].landing).toBe("https://www.dati.lombardia.it/d/abcd-1234");
    expect(out.results[1].resources[0].url).toBe("https://www.dati.friuliveneziagiulia.it/resource/wxyz-9999.csv");
  });
});

describe("catalog-search · DCAT adapter (data.europa.eu)", () => {
  const europa = sourceById("data-europa")!;

  it("strips the [..] brackets from access_url and reads the title/format fields", async () => {
    const { fn } = mockJson({
      result: {
        count: 1747616,
        results: [
          {
            id: "c_e630-popolazione",
            title: "Popolazione",
            notes: "Dati popolazione residente",
            publisher: { name: "Comune di Lizzano" },
            resources: [
              {
                access_url: "[https://raw.githubusercontent.com/x/dataset_popolazione.csv]",
                format: "CSV",
                title: "Dati popolazione",
              },
            ],
          },
        ],
      },
    });
    const out = await searchSource(europa, { q: "popolazione" }, fn);
    expect(out.count).toBe(1747616);
    expect(out.results).toHaveLength(1);
    const d = out.results[0];
    expect(d.title).toBe("Popolazione");
    expect(d.publisher).toBe("Comune di Lizzano");
    expect(d.resources[0].url).toBe("https://raw.githubusercontent.com/x/dataset_popolazione.csv");
    expect(d.resources[0].format).toBe("CSV");
    expect(d.resources[0].name).toBe("Dati popolazione");
    expect(d.landing).toBe("https://data.europa.eu/data/datasets/c_e630-popolazione?locale=it");
  });

  it("infers a usable format from the URL extension when `format` is null", async () => {
    const { fn } = mockJson({
      result: {
        results: [
          {
            id: "geo-1",
            title: "Confini",
            resources: [
              { access_url: "[https://host/confini.geojson]", format: null },
              { access_url: "[https://host/dati.gpkg]", format: null },
              { access_url: "[https://host/landing.html]", format: null }, // not usable
            ],
          },
        ],
      },
    });
    const out = await searchSource(europa, {}, fn);
    expect(out.results[0].resources.map((r) => r.format)).toEqual(["GEOJSON", "GPKG"]);
  });

  it("coerces multilingual title/notes objects and falls back to id for a null title", async () => {
    const { fn } = mockJson({
      result: {
        results: [
          {
            id: "ml-1",
            title: { it: "Densità", en: "Density" },
            notes: { en: "Population density" },
            resources: [{ access_url: "[https://host/d.csv]", format: "CSV" }],
          },
          {
            id: "null-title-2",
            title: null,
            resources: [{ access_url: "[https://host/e.csv]", format: "CSV" }],
          },
        ],
      },
    });
    const out = await searchSource(europa, {}, fn);
    expect(out.results[0].title).toBe("Densità"); // it preferred
    expect(out.results[0].notes).toBe("Population density");
    expect(out.results[1].title).toBe("null-title-2"); // id fallback
  });

  it("drops datasets whose resources are non-usable or have no resolvable URL", async () => {
    const { fn } = mockJson({
      result: {
        results: [
          {
            id: "only-pdf",
            title: "Report",
            resources: [{ access_url: "[https://host/report.pdf]", format: "PDF" }],
          },
          {
            id: "no-url",
            title: "Vuoto",
            resources: [{ format: "CSV" }],
          },
        ],
      },
    });
    const out = await searchSource(europa, {}, fn);
    expect(out.results).toHaveLength(0);
  });

  it("builds the query URL with q/rows/start", async () => {
    const { fn, calls } = mockJson({ result: { count: 0, results: [] } });
    await searchSource(europa, { q: "energia", rows: 30, start: 60 }, fn);
    expect(calls[0]).toContain("package_search?q=energia&rows=30&start=60");
  });
});

