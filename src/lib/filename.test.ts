import { describe, it, expect } from "vitest";
import { titleFromFileName } from "./filename";

describe("titleFromFileName", () => {
  it("drops the extension and capitalises", () => {
    expect(titleFromFileName("popolazione.csv")).toBe("Popolazione");
  });

  it("turns separators into spaces and collapses whitespace", () => {
    expect(titleFromFileName("prezzi_omi__2024.geojson")).toBe("Prezzi omi 2024");
    expect(titleFromFileName("comuni-italia.xlsx")).toBe("Comuni italia");
  });

  it("returns empty for opaque hex/UUID names (no 3+ letter run)", () => {
    expect(titleFromFileName("ba5f-9c21.csv")).toBe("");
    expect(titleFromFileName("a1b2c3.geojson")).toBe("");
  });

  it("keeps a name with at least one real word", () => {
    expect(titleFromFileName("export_roma_2024.csv")).toBe("Export roma 2024");
  });
});
