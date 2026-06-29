/**
 * Deterministic, content-addressed object keys for immutable published
 * snapshots (O1.5). The key embeds a slug (readable) plus a short hash of the
 * serialised spec, so:
 *  - the same map content always maps to the same key (idempotent publish),
 *  - any change to the content yields a new key (immutability - an already
 *    published embed never changes under the reader's feet).
 *
 * Pure and synchronous (FNV-1a over the spec string) → fully testable without
 * crypto APIs; collision risk is negligible at the scale of one operator's maps
 * and the slug further disambiguates.
 */

import { serialiseSpec, type VizSpec } from "./spec";

/** Slugify a title into a URL-safe, accent-free, lowercase token. */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return s || "mappa";
}

/** FNV-1a 32-bit hash of a string → 8-char lowercase hex. Stable across runs. */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to avoid float precision loss.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Build the immutable storage key for a spec, e.g.
 * `embed/arrivi-2024/3f9a1c0b/`. The trailing segment is the content hash, so
 * republishing identical content reuses it and any edit produces a fresh path.
 */
export function publishKeyPrefix(spec: VizSpec): string {
  const slug = slugify(spec.project.title);
  const hash = shortHash(serialiseSpec(spec));
  return `embed/${slug}/${hash}`;
}

/** Object keys for the artefacts of a published snapshot. */
export interface PublishKeys {
  prefix: string;
  /** The declarative spec JSON. */
  spec: string;
  /** The self-contained embed HTML. */
  embed: string;
}

export function publishKeys(spec: VizSpec): PublishKeys {
  const prefix = publishKeyPrefix(spec);
  return {
    prefix,
    spec: `${prefix}/spec.json`,
    embed: `${prefix}/index.html`,
  };
}
