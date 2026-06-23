/**
 * Minimal single-page PDF writer (O3.5) — pure, dependency-free, testable.
 *
 * The editor rasterises a map/chart to a JPEG (via `html-to-image`) and this
 * module wraps that JPEG into a valid one-page PDF using a `DCTDecode` image
 * XObject. JPEG embeds verbatim (no re-encoding) so the file stays small and we
 * avoid pulling in a heavy PDF library.
 *
 * Only the features needed for "one image on one page" are implemented; the
 * output is a hand-built but spec-correct PDF 1.3 document with a proper xref
 * table and trailer.
 */

/** Intrinsic JPEG properties read from its SOF marker. */
export interface JpegInfo {
  width: number;
  height: number;
  /** Colour components: 1 = grayscale, 3 = RGB (YCbCr), 4 = CMYK. */
  components: number;
}

/**
 * Read width/height/components from a JPEG's Start-Of-Frame marker. Scans the
 * marker segments rather than trusting any single offset, so it tolerates the
 * APPn/COM/DQT/DHT segments browsers emit before the SOF.
 */
export function parseJpeg(bytes: Uint8Array): JpegInfo {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Non è un file JPEG valido (SOI mancante).");
  }
  let i = 2;
  while (i < bytes.length) {
    // Markers start with 0xFF; skip any fill bytes.
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    let marker = bytes[i + 1];
    // Skip padding 0xFF bytes.
    while (marker === 0xff && i + 1 < bytes.length) {
      i++;
      marker = bytes[i + 1];
    }
    i += 2;
    // Standalone markers without a length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (i + 1 >= bytes.length) break;
    const len = (bytes[i] << 8) | bytes[i + 1];
    // SOF0..SOF15 carry the frame dimensions, excluding DHT(C4)/JPG(C8)/DAC(CC).
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      const height = (bytes[i + 3] << 8) | bytes[i + 4];
      const width = (bytes[i + 5] << 8) | bytes[i + 6];
      const components = bytes[i + 7];
      return { width, height, components };
    }
    i += len;
  }
  throw new Error("JPEG senza marker SOF: impossibile leggere le dimensioni.");
}

/** ASCII → bytes (PDF structure is ASCII; the JPEG payload is binary). */
function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** Format a number for PDF content (no exponent, trimmed trailing zeros). */
function num(n: number): string {
  return Number(n.toFixed(3))
    .toString()
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

/** A4 width in PostScript points (1/72"). The page width is fixed; height
 * follows the image aspect ratio so nothing is distorted. */
const A4_WIDTH_PT = 595.28;

/**
 * Build a one-page PDF (as bytes) that displays the given JPEG full-bleed. The
 * page is A4-width with a height matching the image aspect ratio. The JPEG is
 * embedded verbatim via a DCTDecode image XObject.
 */
export function buildJpegPdf(jpeg: Uint8Array): Uint8Array {
  const info = parseJpeg(jpeg);
  const colorSpace =
    info.components === 1
      ? "/DeviceGray"
      : info.components === 4
        ? "/DeviceCMYK"
        : "/DeviceRGB";

  const pageW = A4_WIDTH_PT;
  const pageH = info.height > 0 ? (pageW * info.height) / info.width : pageW;

  const content = `q\n${num(pageW)} 0 0 ${num(pageH)} 0 0 cm\n/Im0 Do\nQ\n`;

  // Object bodies. Object 4 (image) interleaves binary, so it is assembled as
  // byte parts; the rest are ASCII.
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === "string" ? ascii(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const startObject = () => offsets.push(length);

  push("%PDF-1.3\n%\xff\xff\xff\xff\n");

  startObject();
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObject();
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  startObject();
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${num(
      pageH,
    )}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );

  startObject();
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push("\nendstream\nendobj\n");

  startObject();
  const contentBytes = ascii(content);
  push(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
  push(contentBytes);
  push("\nendstream\nendobj\n");

  // Cross-reference table.
  const xrefOffset = length;
  const count = offsets.length + 1; // +1 for the free object 0
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  // Concatenate.
  const out = new Uint8Array(length);
  let pos = 0;
  for (const part of chunks) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}
