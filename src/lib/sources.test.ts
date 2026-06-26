import { describe, it, expect } from "vitest";
import {
  OPEN_DATA_SOURCES,
  SOURCE_BLACKLIST,
  activeSources,
  isBlacklisted,
  sourceById,
  landingUrl,
} from "./sources";

describe("open-data sources registry", () => {
  it("has unique ids", () => {
    const ids = OPEN_DATA_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every source has a valid http(s) api URL", () => {
    for (const s of OPEN_DATA_SOURCES) {
      expect(() => new URL(s.api), `${s.id} api`).not.toThrow();
      expect(/^https?:$/.test(new URL(s.api).protocol), `${s.id} protocol`).toBe(true);
    }
  });

  it("ckan sources carry a {name} landing pattern; socrata carry a domain", () => {
    for (const s of OPEN_DATA_SOURCES) {
      if (s.kind === "ckan" || s.kind === "dcat") {
        expect(s.landingPattern, `${s.id} landingPattern`).toBeTruthy();
        expect(s.landingPattern, `${s.id} landing token`).toContain("{name}");
      } else {
        expect(s.domain, `${s.id} domain`).toBeTruthy();
      }
    }
  });

  it("blacklist entries reference a real source id or a resource URL", () => {
    const ids = new Set(OPEN_DATA_SOURCES.map((s) => s.id));
    for (const b of SOURCE_BLACKLIST) {
      const isSource = ids.has(b.id);
      const isUrl = /^https?:\/\//.test(b.id);
      expect(isSource || isUrl, `blacklist "${b.id}" must be a known id or a URL`).toBe(true);
      expect(b.reason.length, `blacklist "${b.id}" needs a reason`).toBeGreaterThan(0);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(b.since), `blacklist "${b.id}" since date`).toBe(true);
    }
  });

  it("activeSources excludes blacklisted ids", () => {
    const active = activeSources();
    for (const s of active) expect(isBlacklisted(s.id)).toBe(false);
    expect(active.length).toBe(OPEN_DATA_SOURCES.length - new Set(SOURCE_BLACKLIST.map((b) => b.id).filter((id) => OPEN_DATA_SOURCES.some((s) => s.id === id))).size);
  });

  it("sourceById finds and misses correctly", () => {
    expect(sourceById("toscana")?.label).toContain("Toscana");
    expect(sourceById("does-not-exist")).toBeUndefined();
  });

  it("landingUrl fills the pattern and encodes the name; empty for socrata", () => {
    const toscana = sourceById("toscana")!;
    expect(landingUrl(toscana, "comuni e abitanti")).toBe(
      "https://dati.toscana.it/dataset/comuni%20e%20abitanti",
    );
    const lombardia = sourceById("lombardia")!;
    expect(landingUrl(lombardia, "anything")).toBe("");
  });
});
