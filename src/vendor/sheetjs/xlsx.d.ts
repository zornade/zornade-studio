/**
 * Minimal type declarations for the vendored SheetJS build
 * (`src/vendor/sheetjs/xlsx.mjs`, official CDN 0.20.3, Apache-2.0).
 *
 * We only declare the tiny surface we actually use (read + sheet_to_json).
 * The library is vendored - not installed from npm - because the npm `xlsx`
 * package is frozen at 0.18.5 (pre proto-pollution fix); the official CDN build
 * is the supported, secure distribution (ROADMAP §1.11).
 */
declare module "*/vendor/sheetjs/xlsx.mjs" {
  export interface WorkSheet {
    [cell: string]: unknown;
  }
  export interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  }
  export interface ReadOptions {
    type?: "array" | "binary" | "string" | "buffer" | "base64" | "file";
    cellDates?: boolean;
    raw?: boolean;
    dense?: boolean;
  }
  export function read(data: ArrayBuffer | Uint8Array, opts?: ReadOptions): WorkBook;
  export interface SheetToJsonOptions {
    header?: 1 | "A" | string[];
    raw?: boolean;
    defval?: unknown;
    blankrows?: boolean;
  }
  export const utils: {
    sheet_to_json<T = unknown>(sheet: WorkSheet, opts?: SheetToJsonOptions): T[];
  };
}
