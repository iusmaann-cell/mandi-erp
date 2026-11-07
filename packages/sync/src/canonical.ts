/**
 * Document 06, section 4.2: the canonical form of a bundle: keys sorted, no spaces, whole numbers only.
 * The same bundle therefore hashes the same on every platform and every database. Only what a bundle may
 * hold is accepted: null, booleans, strings, safe whole numbers (the envelope counters), arrays and
 * objects. A fraction, NaN, undefined or a bigint is refused (whole numbers above 2^53 travel as strings).
 */
export type Json = null | boolean | string | number | readonly Json[] | { readonly [key: string]: Json };

export class CanonicalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalError";
  }
}

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) throw new CanonicalError(`only whole numbers within 2^53 may be written as a JSON number (got ${String(value)}); larger values are strings`);
      return value.toString();
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`).join(",")}}`;
    }
    default:
      throw new CanonicalError(`cannot write a ${typeof value} in a bundle`);
  }
}
