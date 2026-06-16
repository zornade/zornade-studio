import { describe, it, expect } from "vitest";
import {
  buildOverpassQuery,
  overpassToTable,
  runOverpass,
  OVERPASS_MAX,
  type OverpassElement,
} from "./overpass";

describe("buildOverpassQuery", () => {
  it("builds an area-scoped query for a named comune", () => {
    const q = buildOverpassQuery(
      [{ key: "amenity", value: "school" }],
      { kind: "area", name: "Bologna", adminLevel: 8 },
    );
    expect(q).toContain('area["name"="Bologna"]["admin_level"="8"]->.a;');
    expect(q).toContain('nwr["amenity"="school"](area.a);');
    expect(q).toContain(`out center ${OVERPASS_MAX};`);
    expect(q.startsWith("[out:json]")).toBe(true);
  });

  it("OR-combines multiple filters in a union block", () => {
    const q = buildOverpassQuery(
      [
        { key: "harbour", value: "yes" },
        { key: "leisure", value: "marina" },
      ],
      { kind: "nationwide" },
    );
    expect(q).toContain('area["ISO3166-1"="IT"]["admin_level"="2"]->.a;');
    expect(q).toContain('nwr["harbour"="yes"](area.a);');
    expect(q).toContain('nwr["leisure"="marina"](area.a);');
  });

  it("supports a key-only filter (any value)", () => {
    const q = buildOverpassQuery([{ key: "man_made" }], { kind: "nationwide" });
    expect(q).toContain('nwr["man_made"](area.a);');
  });

  it("escapes quotes in a place name (injection-safe)", () => {
    const q = buildOverpassQuery(
      [{ key: "amenity", value: "school" }],
      { kind: "area", name: 'Foo"]; out;', adminLevel: 8 },
    );
    expect(q).toContain('\\"');
    expect(q).not.toContain('"Foo"];');
  });
});

describe("overpassToTable", () => {
  const filters = [
    { key: "harbour", value: "yes" },
    { key: "leisure", value: "marina" },
  ];

  it("maps node lat/lon and way/relation center into lat/lon columns", () => {
    const els: OverpassElement[] = [
      { type: "node", lat: 44.1, lon: 9.8, tags: { name: "Porto A", harbour: "yes" } },
      {
        type: "way",
        center: { lat: 43.5, lon: 10.3 },
        tags: { name: "Marina B", leisure: "marina" },
      },
    ];
    const out = overpassToTable(els, filters);
    expect(out.columns).toContain("lat");
    expect(out.columns).toContain("lon");
    expect(out.rows[0]).toMatchObject({
      nome: "Porto A",
      categoria: "yes",
      lat: "44.1",
      lon: "9.8",
      tipo_osm: "node",
    });
    expect(out.rows[1]).toMatchObject({ nome: "Marina B", categoria: "marina", tipo_osm: "way" });
  });

  it("drops elements without coordinates", () => {
    const els: OverpassElement[] = [
      { type: "relation", tags: { name: "no coords" } },
      { type: "node", lat: 45, lon: 9, tags: { harbour: "yes" } },
    ];
    const out = overpassToTable(els, filters);
    expect(out.rows).toHaveLength(1);
    expect(out.dropped).toBe(1);
  });

  it("falls back to a placeholder name and composes the address", () => {
    const els: OverpassElement[] = [
      {
        type: "node",
        lat: 45,
        lon: 9,
        tags: {
          harbour: "yes",
          "addr:street": "Via Roma",
          "addr:housenumber": "10",
          "addr:city": "Genova",
        },
      },
    ];
    const out = overpassToTable(els, filters);
    expect(out.rows[0].nome).toBe("(senza nome)");
    expect(out.rows[0].indirizzo).toBe("Via Roma 10, Genova");
  });

  it("labels unmatched elements 'altro'", () => {
    const els: OverpassElement[] = [
      { type: "node", lat: 45, lon: 9, tags: { name: "X", amenity: "cafe" } },
    ];
    const out = overpassToTable(els, filters);
    expect(out.rows[0].categoria).toBe("altro");
  });
});

describe("runOverpass (robustness)", () => {
  const okBody = { elements: [{ type: "node", lat: 45, lon: 9, tags: {} }] };

  it("falls back to the next endpoint when the first is overloaded (504)", async () => {
    const calls: string[] = [];
    const fetchMock = async (url: string) => {
      calls.push(url);
      if (calls.length === 1) {
        return { ok: false, status: 504 } as Response;
      }
      return {
        ok: true,
        json: async () => okBody,
      } as unknown as Response;
    };
    const orig = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const els = await runOverpass("q", ["https://a/i", "https://b/i"]);
      expect(els).toHaveLength(1);
      expect(calls).toHaveLength(2); // tried both
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("aborts a hung endpoint via timeout and surfaces a clear error", async () => {
    // A fetch that never resolves until aborted → the AbortController must
    // reject it so the call can't hang forever.
    const fetchMock = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const orig = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      await expect(
        runOverpass("q", ["https://slow/i"], 20),
      ).rejects.toThrow(/non hanno risposto|tempo scaduto/i);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
