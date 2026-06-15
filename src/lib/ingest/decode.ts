/**
 * Bytes → text decoding with an Italian-Excel-friendly fallback
 * (ROADMAP §1.12.3, ingestion stage 1).
 *
 * Many PA / Excel CSV exports are saved in **Windows-1252** (a.k.a. CP-1252),
 * not UTF-8, so accented characters (à, è, ì, ò, ù, °) arrive as invalid UTF-8
 * byte sequences. We first try strict UTF-8 (BOM stripped automatically by
 * TextDecoder); if that throws on invalid bytes we fall back to Windows-1252.
 *
 * `TextDecoder` is available both in the browser and in Node ≥ 18, and both
 * support the "windows-1252" label, so this works in the app and in tests.
 */

export type DecodedEncoding = "utf-8" | "windows-1252";

export interface DecodeResult {
  text: string;
  encoding: DecodedEncoding;
}

/** Decode raw bytes to text, preferring UTF-8 and falling back to Win-1252. */
export function decodeBytes(input: ArrayBuffer | Uint8Array): DecodeResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  try {
    // fatal: true → throws on malformed UTF-8 instead of inserting U+FFFD,
    // which is exactly the signal that the source is not UTF-8.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text, encoding: "utf-8" };
  } catch {
    const text = new TextDecoder("windows-1252").decode(bytes);
    return { text, encoding: "windows-1252" };
  }
}

/**
 * Read a File/Blob to text with the same UTF-8 → Windows-1252 fallback.
 * Use this instead of `File.text()` (which assumes UTF-8 and silently mangles
 * Win-1252 accents).
 */
export async function readFileSmart(file: Blob): Promise<DecodeResult> {
  const buf = await file.arrayBuffer();
  return decodeBytes(buf);
}
