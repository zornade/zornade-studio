import { describe, it, expect } from "vitest";
import { rowsToCsv, accessibleTableHtml } from "./data-table";

describe("rowsToCsv", () => {
  const columns = ["comune", "valore"];
  const rows = [
    { comune: "Roma", valore: "3032" },
    { comune: "Milano", valore: "4500" },
  ];

  it("emits header + rows with CRLF and a UTF-8 BOM by default", () => {
    const csv = rowsToCsv(columns, rows);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("comune,valore\r\nRoma,3032\r\nMilano,4500");
  });

  it("omits the BOM when disabled", () => {
    const csv = rowsToCsv(columns, rows, { bom: false });
    expect(csv.startsWith("\uFEFF")).toBe(false);
    expect(csv.startsWith("comune,valore")).toBe(true);
  });

  it("quotes fields containing commas, quotes, or newlines (RFC 4180)", () => {
    const csv = rowsToCsv(["a", "b"], [
      { a: 'has,comma', b: 'has "quote"' },
      { a: "line\nbreak", b: "plain" },
    ], { bom: false });
    expect(csv).toContain('"has,comma","has ""quote"""');
    expect(csv).toContain('"line\nbreak",plain');
  });

  it("fills missing cells with empty fields", () => {
    const csv = rowsToCsv(["a", "b"], [{ a: "1" }], { bom: false });
    expect(csv).toBe("a,b\r\n1,");
  });

  it("emits only the header for no rows", () => {
    expect(rowsToCsv(["a", "b"], [], { bom: false })).toBe("a,b");
  });
});

describe("accessibleTableHtml", () => {
  const columns = ["comune", "valore"];
  const rows = [{ comune: "Roma", valore: "3032" }];

  it("builds a semantic table with caption, scoped headers, and a row header", () => {
    const html = accessibleTableHtml(columns, rows, { caption: "Prezzi OMI" });
    expect(html).toContain("<caption>Prezzi OMI</caption>");
    expect(html).toContain('<th scope="col">comune</th>');
    expect(html).toContain('<th scope="row">Roma</th>');
    expect(html).toContain("<td>3032</td>");
  });

  it("escapes malicious cell and caption content", () => {
    const html = accessibleTableHtml(
      ["x"],
      [{ x: '<img src=x onerror=alert(1)>' }],
      { caption: "<script>" },
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("caps the number of rows emitted", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      comune: `C${i}`,
      valore: String(i),
    }));
    const html = accessibleTableHtml(columns, many, { maxRows: 10 });
    expect((html.match(/<tr>/g) ?? []).length).toBe(11); // 1 head + 10 body
  });

  it("omits the caption when not given", () => {
    const html = accessibleTableHtml(columns, rows);
    expect(html).not.toContain("<caption>");
  });
});
