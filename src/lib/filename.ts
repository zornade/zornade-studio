/**
 * Derive a human title from a file name: drop the extension, turn separators
 * into spaces, collapse whitespace and capitalise the first letter. Returns ""
 * for opaque names (UUID/hex exports) that carry no human signal - detected by
 * requiring at least one run of 3+ consecutive letters (real words have it,
 * hex/UUID chunks like "ba5f" do not).
 */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "");
  const cleaned = base
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[a-zA-Z]{3,}/.test(cleaned)) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
