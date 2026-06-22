import { describe, it, expect } from "vitest";
import {
  periodSortKey,
  orderFrames,
  frameLabel,
  framesOf,
  rowsForFrame,
  detectTimeColumn,
} from "./temporal";
import { detectWide, meltWide } from "./reshape";

describe("temporal · periodSortKey", () => {
  it("orders OMI semesters", () => {
    expect(periodSortKey("2015_1")! < periodSortKey("2015_2")!).toBe(true);
    expect(periodSortKey("2015_2")! < periodSortKey("2016_1")!).toBe(true);
  });
  it("orders years, months, ISO dates", () => {
    expect(periodSortKey("2019")! < periodSortKey("2020")!).toBe(true);
    expect(periodSortKey("2024-03")! < periodSortKey("2024-07")!).toBe(true);
    expect(periodSortKey("2024-03-01")! < periodSortKey("2024-03-15")!).toBe(true);
  });
  it("mixes granularities coherently (semester between years)", () => {
    expect(periodSortKey("2015")! <= periodSortKey("2015_1")!).toBe(true);
    expect(periodSortKey("2015_2")! < periodSortKey("2016")!).toBe(true);
  });
  it("returns null for non-periods", () => {
    expect(periodSortKey("Lombardia")).toBeNull();
    expect(periodSortKey("")).toBeNull();
    expect(periodSortKey("123")).toBeNull(); // not a plausible year
  });
});

describe("temporal · orderFrames", () => {
  it("dedupes, trims and sorts chronologically", () => {
    expect(orderFrames(["2016_1", "2015_2", "2015_1", " 2016_1 "])).toEqual([
      "2015_1",
      "2015_2",
      "2016_1",
    ]);
  });
  it("puts unrecognised labels after periods, alphabetically", () => {
    expect(orderFrames(["zzz", "2020", "aaa"])).toEqual(["2020", "aaa", "zzz"]);
  });
});

describe("temporal · frameLabel", () => {
  it("renders OMI semesters as 'YYYY Sn'", () => {
    expect(frameLabel("2015_1")).toBe("2015 S1");
    expect(frameLabel("2024_2")).toBe("2024 S2");
  });
  it("leaves other labels as-is", () => {
    expect(frameLabel("2020")).toBe("2020");
    expect(frameLabel("2024-03")).toBe("2024-03");
  });
});

describe("temporal · framesOf / rowsForFrame", () => {
  const rows = [
    { comune: "Roma", anno: "2020", v: "1" },
    { comune: "Roma", anno: "2021", v: "2" },
    { comune: "Milano", anno: "2020", v: "3" },
    { comune: "Milano", anno: "2021", v: "4" },
  ];
  it("lists ordered distinct frames", () => {
    expect(framesOf(rows, "anno")).toEqual(["2020", "2021"]);
  });
  it("slices rows of a single frame", () => {
    const r = rowsForFrame(rows, "anno", "2020");
    expect(r.map((x) => x.comune)).toEqual(["Roma", "Milano"]);
  });
});

describe("temporal · detectTimeColumn", () => {
  it("finds a period column with ≥2 frames", () => {
    const rows = [
      { comune: "Roma", anno: "2020", valore: "1" },
      { comune: "Milano", anno: "2021", valore: "2" },
    ];
    expect(detectTimeColumn(["comune", "anno", "valore"], rows, ["comune", "valore"])).toBe("anno");
  });
  it("ignores excluded columns and single-frame columns", () => {
    const rows = [
      { comune: "Roma", anno: "2020", valore: "1" },
      { comune: "Milano", anno: "2020", valore: "2" }, // only one distinct year
    ];
    expect(detectTimeColumn(["comune", "anno", "valore"], rows, ["comune", "valore"])).toBeNull();
  });
  it("returns null when no column is period-like", () => {
    const rows = [{ a: "x", b: "y" }, { a: "z", b: "w" }];
    expect(detectTimeColumn(["a", "b"], rows)).toBeNull();
  });
  it("prefers the column with more distinct frames", () => {
    const rows = [
      { mese: "2020-01", anno: "2020", v: "1" },
      { mese: "2020-02", anno: "2020", v: "2" },
      { mese: "2020-03", anno: "2021", v: "3" },
    ];
    expect(detectTimeColumn(["mese", "anno", "v"], rows, ["v"])).toBe("mese");
  });
});

describe("temporal · wide CSV → long → time column (ingest flow)", () => {
  it("melts year columns and detects the resulting period column", () => {
    // A wide table: one column per year (comune,2015,2016,2017).
    const columns = ["comune", "2015", "2016", "2017"];
    const rows = [
      { comune: "Roma", "2015": "10", "2016": "12", "2017": "15" },
      { comune: "Milano", "2015": "20", "2016": "22", "2017": "25" },
    ];
    const wide = detectWide(columns);
    expect(wide).not.toBeNull();
    expect(wide!.idColumns).toEqual(["comune"]);
    expect(wide!.periodColumns).toEqual(["2015", "2016", "2017"]);

    const long = meltWide({ columns, rows }, wide!, {
      periodName: "periodo",
      valueName: "valore",
    });
    expect(long.columns).toEqual(["comune", "periodo", "valore"]);
    expect(long.rows).toHaveLength(6); // 2 comuni × 3 years

    // The melted "periodo" column is the time column, with 3 ordered frames.
    const timeCol = detectTimeColumn(long.columns, long.rows, ["comune", "valore"]);
    expect(timeCol).toBe("periodo");
    expect(framesOf(long.rows, "periodo")).toEqual(["2015", "2016", "2017"]);
    // And a single frame slices back to one value per entity.
    expect(rowsForFrame(long.rows, "periodo", "2016").map((r) => r.valore)).toEqual([
      "12",
      "22",
    ]);
  });
});
