import { describe, it, expect } from "vitest";
import { parseJpeg, buildJpegPdf } from "./pdf";

/** A structurally-valid (not decodable) JPEG: SOI + SOF0(w×h, n comps) + EOI. */
function fakeJpeg(width: number, height: number, components = 3): Uint8Array {
  const comp: number[] = [];
  for (let i = 0; i < components; i++) comp.push(i + 1, 0x11, 0);
  const len = 8 + components * 3; // precision+h+w+nf + per-component
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, // SOF0
    (len >> 8) & 0xff, len & 0xff,
    0x08, // precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    components,
    ...comp,
    0xff, 0xd9, // EOI
  ]);
}

describe("parseJpeg", () => {
  it("reads width, height and components from the SOF0 marker", () => {
    expect(parseJpeg(fakeJpeg(200, 100, 3))).toEqual({
      width: 200,
      height: 100,
      components: 3,
    });
  });

  it("reads grayscale (1 component) frames", () => {
    expect(parseJpeg(fakeJpeg(50, 40, 1)).components).toBe(1);
  });

  it("rejects non-JPEG input", () => {
    expect(() => parseJpeg(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});

describe("buildJpegPdf", () => {
  const jpeg = fakeJpeg(200, 100, 3);
  const pdf = buildJpegPdf(jpeg);
  const text = new TextDecoder("latin1").decode(pdf);

  it("emits a valid PDF header and EOF", () => {
    expect(text.startsWith("%PDF-1.3")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("embeds the image as a DCTDecode XObject with the right metadata", () => {
    expect(text).toContain("/Filter /DCTDecode");
    expect(text).toContain("/ColorSpace /DeviceRGB");
    expect(text).toContain("/Width 200");
    expect(text).toContain("/Height 100");
    expect(text).toContain(`/Length ${jpeg.length}`);
  });

  it("uses DeviceGray for grayscale JPEGs", () => {
    const g = new TextDecoder("latin1").decode(buildJpegPdf(fakeJpeg(20, 20, 1)));
    expect(g).toContain("/ColorSpace /DeviceGray");
  });

  it("sizes the page A4-width with the image aspect ratio", () => {
    // 595.28 * 100/200 = 297.64
    expect(text).toContain("/MediaBox [0 0 595.28 297.64]");
  });

  it("includes an xref table and a single-page tree", () => {
    expect(text).toContain("xref\n0 6\n");
    expect(text).toContain("/Type /Pages /Kids [3 0 R] /Count 1");
    expect(text).toContain("startxref");
  });

  it("embeds the original JPEG bytes verbatim", () => {
    // The SOI/EOI of the embedded jpeg must be present between stream markers.
    const streamStart = pdf.indexOf(0xff, text.indexOf("stream\n") + 7);
    expect(pdf[streamStart]).toBe(0xff);
    expect(pdf[streamStart + 1]).toBe(0xd8);
  });
});
