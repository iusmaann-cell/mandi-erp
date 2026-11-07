import { canonicalize } from "@mandi/sync";
import { sha256Hex, utf8Bytes } from "@mandi/numeric";

/** Keys sorted at every depth, so a fixture file does not change when code is reordered. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, sorted(v)]));
  }
  return value;
}

/** A fixture as the text of a file: readable (indented), keys sorted, one newline at the end. Fixtures are produced by tools, never by hand (TR-11). */
export function exportFixture(value: unknown): string {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

/** A short fingerprint of a data set or any fixture, printed with results so a run says which data it used. */
export function fingerprint(value: unknown): string {
  return sha256Hex(utf8Bytes(canonicalize(sorted(value)))).slice(0, 16);
}
