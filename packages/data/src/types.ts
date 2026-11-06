/**
 * Document 06, section 2.1 and 2.2: the logical types of every column and what each becomes on each
 * database. This file is the ONE place the mapping lives. Application code sees only the canonical
 * form of each logical type, whatever the database:
 *
 *   id    lower-case UUID text            int64  bigint (whole numbers; money, quantity, counters)
 *   text  string                          enum   string (checked against a fixed list)
 *   date  "YYYY-MM-DD"                    ts     "YYYY-MM-DDTHH:mm:ss.sssZ" (UTC, always milliseconds)
 *   bool  boolean                         json   JSON text, canonical (keys sorted, no spaces), read and written whole
 */
export type DbKind = "sqlite" | "postgres";
export type LogicalType = "id" | "int64" | "text" | "date" | "ts" | "bool" | "json" | "enum";

export const PHYSICAL_TYPE: Readonly<Record<DbKind, Readonly<Record<LogicalType, string>>>> = {
  sqlite: { id: "TEXT", int64: "INTEGER", text: "TEXT", date: "TEXT", ts: "TEXT", bool: "INTEGER", json: "TEXT", enum: "TEXT" },
  postgres: { id: "uuid", int64: "bigint", text: "text", date: "date", ts: "timestamptz", bool: "boolean", json: "jsonb", enum: "text" },
};

/** Physical type names that must never appear in a schema (document 06, D-6: no floating point). */
export const FORBIDDEN_PHYSICAL_TYPES = /\b(real|float|float4|float8|double|numeric|decimal|money|smallserial|serial)\b/i;

const TIMESTAMP_TEXT = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;
export const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Any timestamp text either database or driver may produce, as the canonical UTC millisecond form.
 * Text with no zone is read as UTC, which is what both databases are configured to produce.
 */
export function normalizeTimestamp(text: string): string {
  const m = TIMESTAMP_TEXT.exec(text);
  if (m === null) {
    throw new TypeError(`not a timestamp: ${JSON.stringify(text)}`);
  }
  const zone = m[4];
  const millis = (m[3] ?? "").padEnd(3, "0").slice(0, 3);
  if (zone === undefined || zone === "Z" || /^[+-]00(?::?00)?$/.test(zone)) {
    return `${m[1] ?? ""}T${m[2] ?? ""}.${millis}Z`;
  }
  const shifted = new Date(`${m[1] ?? ""}T${m[2] ?? ""}.${millis}${zone.length === 3 ? `${zone}:00` : zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`}`);
  return shifted.toISOString();
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

/**
 * JSON text in one form on every database: keys sorted, no spaces. PostgreSQL's jsonb reorders keys
 * and adds spaces, SQLite keeps the text as written; without this the same row would read back
 * differently and a hash over it would differ by database. Whole numbers above 2^53 do not belong in
 * JSON (int64 values travel as strings, document 05, section 7.1).
 */
export function canonicalJson(text: string): string {
  return JSON.stringify(sortKeys(JSON.parse(text)));
}

function show(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "boolean") return value.toString();
  return JSON.stringify(value) ?? typeof value;
}

/** A value as the database driver returned it, to the canonical application form. */
export function decodeValue(type: LogicalType, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  switch (type) {
    case "int64":
      if (typeof raw === "bigint") return raw;
      if (typeof raw === "number" || typeof raw === "string") return BigInt(raw);
      throw new TypeError(`cannot read ${typeof raw} as int64`);
    case "bool":
      if (typeof raw === "boolean") return raw;
      if (raw === 1n || raw === 1) return true;
      if (raw === 0n || raw === 0) return false;
      throw new TypeError(`cannot read ${show(raw)} as bool`);
    case "ts":
      if (raw instanceof Date) return raw.toISOString();
      return normalizeTimestamp(show(raw));
    case "json":
      return canonicalJson(typeof raw === "string" ? raw : JSON.stringify(raw));
    case "id":
      return show(raw).toLowerCase();
    case "date":
    case "text":
    case "enum":
      return show(raw);
  }
}

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

const validTimestamp = (v: string): boolean => CANONICAL_TIMESTAMP.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;
const validDate = (v: string): boolean => DATE_TEXT.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/**
 * A canonical application value to what a driver accepts as a parameter. Timestamps, dates and ids
 * must already be in canonical form: SQLite refuses anything else through its CHECK constraints, but
 * PostgreSQL's timestamp and date input accepts many other spellings (and words such as "yesterday"
 * or "infinity"), so the application layer is the one place that keeps both databases equally strict.
 */
export function encodeValue(type: LogicalType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "int64":
      return typeof value === "bigint" ? value : BigInt(value as number | string);
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "ts":
      if (typeof value !== "string" || !validTimestamp(value)) throw new TypeError(`not a canonical timestamp (YYYY-MM-DDTHH:mm:ss.sssZ): ${show(value)}`);
      return value;
    case "date":
      if (typeof value !== "string" || !validDate(value)) throw new TypeError(`not a date (YYYY-MM-DD): ${show(value)}`);
      return value;
    case "id":
      if (typeof value !== "string" || !UUID_TEXT.test(value)) throw new TypeError(`not a lower-case uuid: ${show(value)}`);
      return value;
    default:
      return value;
  }
}
