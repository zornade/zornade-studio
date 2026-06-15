import { describe, it, expect } from "vitest";
import { decodeBytes } from "./decode";

// Helper: encode a string as Windows-1252 bytes for the accented chars we care
// about (à=0xE0, è=0xE8, ì=0xEC, ò=0xF2, ù=0xF9, °=0xB0). ASCII maps 1:1.
const WIN1252: Record<string, number> = {
  à: 0xe0, è: 0xe8, ì: 0xec, ò: 0xf2, ù: 0xf9, "°": 0xb0, é: 0xe9,
};
function encodeWin1252(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) out.push(WIN1252[ch] ?? ch.charCodeAt(0));
  return new Uint8Array(out);
}

describe("decodeBytes", () => {
  it("decodes clean UTF-8", () => {
    const bytes = new TextEncoder().encode("Forlì, città");
    const r = decodeBytes(bytes);
    expect(r.encoding).toBe("utf-8");
    expect(r.text).toBe("Forlì, città");
  });

  it("strips a UTF-8 BOM", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("a,b")]);
    const r = decodeBytes(withBom);
    expect(r.encoding).toBe("utf-8");
    expect(r.text).toBe("a,b");
  });

  it("falls back to Windows-1252 for non-UTF-8 accents", () => {
    const bytes = encodeWin1252("Comune;abitanti\nForlì;10\nCittà di Castello;20\n");
    const r = decodeBytes(bytes);
    expect(r.encoding).toBe("windows-1252");
    expect(r.text).toContain("Forlì");
    expect(r.text).toContain("Città di Castello");
  });

  it("decodes the degree sign from Windows-1252", () => {
    const bytes = encodeWin1252("temperatura\n20°\n");
    const r = decodeBytes(bytes);
    expect(r.text).toContain("20°");
  });
});
