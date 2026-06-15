import { describe, it, expect } from "vitest";
import { parseNumber, parseCsv } from "./csv";

describe("csv smoke", () => {
  it("parses Italian numbers", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("12,19")).toBeCloseTo(12.19);
    expect(parseNumber("n.d.")).toBeNull();
  });
  it("parses a semicolon CSV", () => {
    const { columns, rows } = parseCsv('a;b\r\n"1";"2"\r\n');
    expect(columns).toEqual(["a", "b"]);
    expect(rows).toHaveLength(1);
  });
});

describe("parseCsv — delimiter detection on a sample", () => {
  it("detects ; , tab and pipe", () => {
    expect(parseCsv("a;b;c\n1;2;3\n").columns).toEqual(["a", "b", "c"]);
    expect(parseCsv("a,b\n1,2\n").columns).toEqual(["a", "b"]);
    expect(parseCsv("a\tb\n1\t2\n").columns).toEqual(["a", "b"]);
    expect(parseCsv("a|b\n1|2\n").columns).toEqual(["a", "b"]);
  });
  it("prefers the consistent delimiter even when the header has a stray comma", () => {
    // Header label contains a comma, but the real delimiter is ';'.
    const text =
      '"Comune, sigla";abitanti\nRoma;2750000\nMilano;1370000\nNapoli;920000\n';
    const { columns, rows } = parseCsv(text);
    expect(columns).toEqual(["Comune, sigla", "abitanti"]);
    expect(rows[0]).toEqual({ "Comune, sigla": "Roma", abitanti: "2750000" });
  });
});

describe("parseNumber — robustness (ROADMAP §1.12.3)", () => {
  it("keeps existing behaviour (no regressions)", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("12,19")).toBeCloseTo(12.19);
    expect(parseNumber("12,3")).toBeCloseTo(12.3);
    expect(parseNumber("12.5")).toBeCloseTo(12.5); // single dot → decimal
    expect(parseNumber("42")).toBe(42);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
  });
  it("handles IT thousands grouping without a comma", () => {
    expect(parseNumber("1.500")).toBe(1500);
    expect(parseNumber("1.234.567")).toBe(1234567);
    expect(parseNumber("1.50")).toBeCloseTo(1.5); // not a thousands pattern
  });
  it("strips currency, percent and units", () => {
    expect(parseNumber("€ 1.500")).toBe(1500);
    expect(parseNumber("12,3 %")).toBeCloseTo(12.3);
    expect(parseNumber("850 kWh")).toBe(850);
    expect(parseNumber("1.234,5 €/m²")).toBeCloseTo(1234.5);
    expect(parseNumber("$2,5")).toBeCloseTo(2.5);
  });
  it("handles negatives (parentheses and Unicode minus)", () => {
    expect(parseNumber("(1.234)")).toBe(-1234);
    expect(parseNumber("-5")).toBe(-5);
    expect(parseNumber("\u22125")).toBe(-5); // U+2212
    expect(parseNumber("(12,5)")).toBeCloseTo(-12.5);
  });
  it("treats explicit null tokens and non-numbers as null", () => {
    for (const t of ["n.d.", "n/d", "N/A", "-", "–", "—", "..", "ciao", "ND"]) {
      expect(parseNumber(t), `token ${t}`).toBeNull();
    }
  });
});

