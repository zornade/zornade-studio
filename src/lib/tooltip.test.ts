import { describe, it, expect } from "vitest";
import {
  templateColumns,
  renderTooltipTemplate,
  tooltipValues,
  escapeHtml,
} from "./tooltip";

describe("templateColumns", () => {
  it("returns referenced columns, excluding reserved tokens and duplicates", () => {
    const cols = templateColumns("<b>{nome}</b>: {valore} ({regione}, {regione})");
    expect(cols).toEqual(["regione"]);
  });

  it("returns an empty array when only reserved tokens are used", () => {
    expect(templateColumns("{nome} {valore}")).toEqual([]);
  });

  it("trims whitespace inside tokens", () => {
    expect(templateColumns("{  area }")).toEqual(["area"]);
  });
});

describe("renderTooltipTemplate", () => {
  it("fills tokens with HTML-escaped values, preserving template HTML", () => {
    const html = renderTooltipTemplate("<b>{nome}</b>: {valore}", {
      nome: "Lazio",
      valore: "8,19 %",
    });
    expect(html).toBe("<b>Lazio</b>: 8,19 %");
  });

  it("escapes interpolated values (no injection from data)", () => {
    const html = renderTooltipTemplate("{nome}", {
      nome: "<img src=x onerror=alert(1)>",
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("replaces unknown tokens with an empty string", () => {
    expect(renderTooltipTemplate("{nome}-{missing}", { nome: "X" })).toBe("X-");
  });

  it("keeps the trusted template markup verbatim", () => {
    const html = renderTooltipTemplate("<div class='t'>{valore}</div>", {
      valore: "10",
    });
    expect(html).toBe("<div class='t'>10</div>");
  });
});

describe("escapeHtml", () => {
  it("escapes the dangerous characters", () => {
    expect(escapeHtml(`<b>"&'`)).toBe("&lt;b&gt;&quot;&amp;&#39;");
  });
});

describe("tooltipValues", () => {
  it("always provides nome and valore", () => {
    expect(tooltipValues({}, "Lazio", "8,19 %")).toEqual({
      nome: "Lazio",
      valore: "8,19 %",
    });
  });

  it("adds col:-prefixed columns under their bare name", () => {
    const values = tooltipValues(
      { "col:regione": "Lazio", "col:anno": 2023, ignored: "x" },
      "Roma",
      "10",
    );
    expect(values).toEqual({
      nome: "Roma",
      valore: "10",
      regione: "Lazio",
      anno: "2023",
    });
  });

  it("coerces null/undefined column values to an empty string", () => {
    const values = tooltipValues({ "col:note": null }, "X", "1");
    expect(values.note).toBe("");
  });
});
