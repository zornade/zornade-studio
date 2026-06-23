import { describe, it, expect } from "vitest";
import {
  serialiseProject,
  parseProject,
  PROJECT_SCHEMA_VERSION,
} from "./project";
import type { StudioState } from "../studio/types";

function sampleState(): StudioState {
  return {
    step: "design",
    project: { title: "Mappa", subtitle: "", source: "ISTAT" },
    dataSource: "upload",
    vizType: "choropleth",
    preset: "zornade",
    brand: {} as StudioState["brand"],
    design: {} as StudioState["design"],
    data: {
      kind: "area",
      fileName: "x.csv",
      columns: ["Regione", "V"],
      rows: [{ Regione: "Lazio", V: "10" }],
      geoLevel: "regioni",
      keyColumn: "Regione",
      valueColumn: "V",
      numericColumns: ["V"],
    },
    annotations: [],
  };
}

describe("serialiseProject / parseProject round-trip", () => {
  it("round-trips a full project state", () => {
    const s = sampleState();
    const out = parseProject(serialiseProject(s));
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    expect(out.state).toEqual(s);
  });

  it("writes a versioned, identifiable file", () => {
    const json = JSON.parse(serialiseProject(sampleState()));
    expect(json.kind).toBe("zornade-studio-project");
    expect(json.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(typeof json.savedAt).toBe("string");
  });

  it("accepts a project with no dataset (data: null)", () => {
    const s = { ...sampleState(), data: null };
    const out = parseProject(serialiseProject(s));
    expect("error" in out).toBe(false);
  });
});

describe("parseProject validation", () => {
  it("rejects invalid JSON", () => {
    expect("error" in parseProject("{bad")).toBe(true);
  });

  it("rejects a non-project JSON", () => {
    expect("error" in parseProject(JSON.stringify({ hello: "world" }))).toBe(true);
  });

  it("rejects an unsupported schema version", () => {
    const file = {
      kind: "zornade-studio-project",
      schemaVersion: 999,
      savedAt: "now",
      state: sampleState(),
    };
    const out = parseProject(JSON.stringify(file));
    expect("error" in out).toBe(true);
  });

  it("rejects a corrupt/incomplete state", () => {
    const file = {
      kind: "zornade-studio-project",
      schemaVersion: PROJECT_SCHEMA_VERSION,
      savedAt: "now",
      state: { project: { title: "x" } }, // missing design/brand/...
    };
    const out = parseProject(JSON.stringify(file));
    expect("error" in out).toBe(true);
  });
});
