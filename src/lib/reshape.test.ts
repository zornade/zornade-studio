import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv";
import { detectWide, meltWide } from "./reshape";

describe("detectWide", () => {
  it("detects a year-per-column table", () => {
    const c = detectWide(["regione", "2019", "2020", "2021"]);
    expect(c).not.toBeNull();
    expect(c!.idColumns).toEqual(["regione"]);
    expect(c!.periodColumns).toEqual(["2019", "2020", "2021"]);
  });
  it("returns null for a tidy table (no/one period column)", () => {
    expect(detectWide(["regione", "anno", "valore"])).toBeNull();
    expect(detectWide(["comune", "popolazione"])).toBeNull();
  });
});

describe("meltWide", () => {
  it("pivots wide → long, skipping empty cells", () => {
    const parsed = parseCsv("regione,2019,2020,2021\nLombardia,100,90,110\nLazio,80,,95\n");
    const cand = detectWide(parsed.columns)!;
    const long = meltWide(parsed, cand, { periodName: "anno", valueName: "valore" });
    expect(long.columns).toEqual(["regione", "anno", "valore"]);
    // Lombardia 3 + Lazio 2 (one empty skipped) = 5 rows
    expect(long.rows).toHaveLength(5);
    expect(long.rows[0]).toEqual({ regione: "Lombardia", anno: "2019", valore: "100" });
    expect(long.rows.find((r) => r.regione === "Lazio" && r.anno === "2020")).toBeUndefined();
  });
});
