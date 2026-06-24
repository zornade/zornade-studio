/**
 * Custom HTML tooltip templates (ROADMAP O2.8).
 *
 * The operator can write a tooltip template with `{placeholder}` tokens that
 * are filled from the hovered feature. Two tokens are always available:
 *   - `{nome}`  → the area/place name
 *   - `{valore}` → the mapped value (already formatted, with unit)
 * Any other `{column}` token is filled from the dataset's columns (the
 * referenced columns are carried onto the features / into the published spec).
 *
 * Security: the **template** is authored by the trusted operator, so its HTML
 * is kept as-is; the **interpolated values** come from data and are
 * HTML-escaped, so a malicious cell can never inject markup. When no template
 * is set, callers fall back to the built-in name/value tooltip.
 */

/** Matches a `{token}` placeholder; token is letters/digits/underscore/space/dot/dash. */
const PLACEHOLDER_RE = /\{([^{}]+)\}/g;

/** Reserved tokens provided by the renderer (not dataset columns). */
export const RESERVED_TOKENS = new Set(["nome", "valore"]);

/** Escape a value for safe HTML interpolation. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Return the distinct dataset columns referenced by a template (excluding the
 * reserved `nome`/`valore` tokens), so the caller can carry exactly those
 * columns onto the features / into the spec — and no more.
 */
export function templateColumns(template: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(template)) !== null) {
    const token = m[1].trim();
    if (token === "" || RESERVED_TOKENS.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Render a template to HTML, replacing each `{token}` with the matching value
 * from `values` (HTML-escaped). Unknown tokens become an empty string. The
 * template's own HTML is preserved verbatim (trusted author).
 */
export function renderTooltipTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER_RE, (_full, rawToken) => {
    const token = String(rawToken).trim();
    const v = values[token];
    return v == null ? "" : escapeHtml(v);
  });
}

/**
 * Build the token dictionary for a custom tooltip template from a feature's
 * properties: `nome`, `valore` (already formatted), plus every `col:`-prefixed
 * column carried onto the feature for the template.
 */
export function tooltipValues(
  props: Record<string, unknown>,
  name: string,
  value: string,
): Record<string, string> {
  const values: Record<string, string> = { nome: name, valore: value };
  for (const k of Object.keys(props)) {
    if (k.startsWith("col:")) values[k.slice(4)] = String(props[k] ?? "");
  }
  return values;
}
