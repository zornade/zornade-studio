import { describe, it, expect } from "vitest";
import { parseExcel } from "./parse-excel";
// The vendored SheetJS build also has write helpers; we use them in the test to
// synthesise a real .xlsx in memory (no binary fixture committed).
import * as XLSX from "../../vendor/sheetjs/xlsx.mjs";

/** Build an .xlsx ArrayBuffer from an array-of-arrays sheet. */
function xlsxFromAoa(aoa: unknown[][]): ArrayBuffer {
  // These helpers exist in the full build but aren't in our minimal .d.ts.
  const utils = XLSX.utils as unknown as {
    aoa_to_sheet: (a: unknown[][]) => unknown;
    book_new: () => { SheetNames: string[]; Sheets: Record<string, unknown> };
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
  };
  const write = (XLSX as unknown as {
    write: (wb: unknown, opts: { type: string; bookType: string }) => ArrayBuffer;
  }).write;
  const ws = utils.aoa_to_sheet(aoa);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Foglio1");
  return write(wb, { type: "array", bookType: "xlsx" });
}

describe("parseExcel", () => {
  it("reads the first sheet's header + rows as strings", async () => {
    const buf = xlsxFromAoa([
      ["Regione", "Arrivi"],
      ["Lazio", 100],
      ["Veneto", 200],
    ]);
    const out = await parseExcel(buf);
    expect(out.columns).toEqual(["Regione", "Arrivi"]);
    expect(out.rows).toEqual([
      { Regione: "Lazio", Arrivi: "100" },
      { Regione: "Veneto", Arrivi: "200" },
    ]);
    expect(out.sheetName).toBe("Foglio1");
    expect(out.sheetNames).toEqual(["Foglio1"]);
  });

  it("skips fully empty rows", async () => {
    const buf = xlsxFromAoa([
      ["A", "B"],
      ["1", "2"],
      ["", ""],
      ["3", "4"],
    ]);
    const out = await parseExcel(buf);
    expect(out.rows.length).toBe(2);
  });

  it("names blank headers and de-duplicates repeats", async () => {
    const buf = xlsxFromAoa([
      ["Regione", "", "Regione"],
      ["Lazio", "x", "y"],
    ]);
    const out = await parseExcel(buf);
    expect(out.columns[0]).toBe("Regione");
    expect(out.columns[1]).toBe("Colonna 2");
    expect(out.columns[2]).toBe("Regione (2)");
  });

  it("returns empty result for an empty sheet", async () => {
    const buf = xlsxFromAoa([]);
    const out = await parseExcel(buf);
    expect(out.columns).toEqual([]);
    expect(out.rows).toEqual([]);
  });
});
