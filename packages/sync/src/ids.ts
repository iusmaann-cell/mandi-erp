import { sha256Hex, utf8Bytes } from "@mandi/numeric";

/**
 * An id derived from facts, for rows that are projections (number series, chain heads, stock balances):
 * every node that applies the same bundles must create the same row ids, or two nodes would differ in
 * a column that no fact explains. A version 8 (custom) UUID from the SHA-256 of a namespace and a text.
 */
export function derivedId(namespace: string, text: string): string {
  const h = sha256Hex(utf8Bytes(`${namespace}|${text}`));
  const variant = ((Number.parseInt(h.charAt(16), 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
