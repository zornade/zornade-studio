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
