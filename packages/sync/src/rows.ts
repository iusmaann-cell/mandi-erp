import { canonicalJson, encodeValue, type Catalogue, type Column } from "@mandi/data";
import { fromWire, toWire } from "@mandi/numeric";
import type { WireRow, WireValue } from "./bundle";

/**
 * Rows between the wire and the database. On the wire every whole number is a canonical decimal
 * string, JSON columns are canonical JSON text, and `bundle_id` is never written (applyBundle sets it
 * from the envelope, so a row cannot disagree with its bundle). company_id is always written.
 */
export class RowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RowError";
  }
}

/** Whatever refusal a conversion raises (numeric, type, canonical form), the caller sees one error type. */
function asRowError<T>(where: string, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof RowError) throw error;
    throw new RowError(`${where}: ${error instanceof Error ? error.message : "cannot be read"}`);
  }
}

function wireValue(table: string, column: Column, value: unknown): WireValue {
  if (value === null || value === undefined) {
    if (!column.nullable && column.default === undefined) throw new RowError(`${table}.${column.name} is required`);
    return null;
  }
  switch (column.type) {
    case "int64":
      if (typeof value === "bigint") return toWire(value);
      if (typeof value === "number" && Number.isSafeInteger(value)) return toWire(BigInt(value));
      if (typeof value === "string") return toWire(fromWire(value));
      throw new RowError(`${table}.${column.name} must be a whole number`);
    case "bool":
      if (typeof value !== "boolean") throw new RowError(`${table}.${column.name} must be true or false`);
      return value;
    case "json":
      return canonicalJson(typeof value === "string" ? value : JSON.stringify(value));
    case "enum":
      if (typeof value !== "string" || !(column.enumValues ?? []).includes(value)) throw new RowError(`${table}.${column.name}: ${JSON.stringify(value)} is not one of ${(column.enumValues ?? []).join(", ")}`);
      return value;
    case "text":
      if (typeof value !== "string") throw new RowError(`${table}.${column.name} must be text`);
      return value;
    default:
      return encodeValue(column.type, value) as string; // id, date, ts: canonical forms only
  }
}

/** A record of natural values (bigint, boolean, text ...) to a wire row, checking every column against the catalogue. */
export function toWireRow(catalogue: Catalogue, table: string, companyId: string, record: Readonly<Record<string, unknown>>): WireRow {
  const def = catalogue.get(table);
  if (def === undefined) throw new RowError(`unknown table ${table}`);
  const values: Record<string, WireValue> = { company_id: companyId };
  for (const [name, value] of Object.entries(record)) {
    if (name === "company_id" || name === "bundle_id") throw new RowError(`${table}: ${name} is set by the bundle, not by the row`);
    const column = def.columns.find((c) => c.name === name);
    if (column === undefined) throw new RowError(`${table} has no column ${name}`);
    values[name] = asRowError(`${table}.${name}`, () => wireValue(table, column, value));
  }
  for (const column of def.columns) {
    if (column.name === "bundle_id" || column.name in values) continue;
    if (!column.nullable && column.default === undefined) throw new RowError(`${table}.${column.name} is required`);
  }
  return { t: table, v: values };
}

export interface DecodedRow {
  readonly table: string;
  /** What is inserted: database parameters (bigint, boolean, text), with company_id and bundle_id. */
  readonly insert: Readonly<Record<string, unknown>>;
  /** The same row in canonical application form, for validators and projectors (int64 as bigint). */
  readonly app: Readonly<Record<string, unknown>>;
}

/** A wire row to a row ready to insert. Throws RowError for anything that is not a well-formed row of a class 1 table. */
export function fromWireRow(catalogue: Catalogue, row: WireRow, companyId: string, bundleId: string): DecodedRow {
  const def = catalogue.get(row.t);
  if (def === undefined) throw new RowError(`unknown table ${row.t}`);
  if (def.class !== 1) throw new RowError(`${row.t} is not a class 1 table: only facts travel in bundles`);
  if (row.v["company_id"] !== companyId) throw new RowError(`a row of ${row.t} belongs to another company than its bundle`);
  if ("bundle_id" in row.v) throw new RowError(`${row.t}: bundle_id is set by the bundle, not by the row`);
  const insert: Record<string, unknown> = {};
  const app: Record<string, unknown> = {};
  for (const [name, wire] of Object.entries(row.v)) {
    const column = def.columns.find((c) => c.name === name);
    if (column === undefined) throw new RowError(`${row.t} has no column ${name}`);
    if (wire === null) {
      if (!column.nullable) throw new RowError(`${row.t}.${name} cannot be empty`);
      insert[name] = null;
      app[name] = null;
      continue;
    }
    switch (column.type) {
      case "int64": {
        if (typeof wire !== "string") throw new RowError(`${row.t}.${name} must be a decimal string`);
        const v = asRowError(`${row.t}.${name}`, () => fromWire(wire)); // canonical text only; 64-bit range
        insert[name] = v;
        app[name] = v;
        break;
      }
      case "bool":
        if (typeof wire !== "boolean") throw new RowError(`${row.t}.${name} must be true or false`);
        insert[name] = wire;
        app[name] = wire;
        break;
      case "enum":
        if (typeof wire !== "string" || !(column.enumValues ?? []).includes(wire)) throw new RowError(`${row.t}.${name}: not an allowed value`);
        insert[name] = wire;
        app[name] = wire;
        break;
      case "json": {
        if (typeof wire !== "string") throw new RowError(`${row.t}.${name} must be JSON text`);
        let canonical: string;
        try {
          canonical = canonicalJson(wire);
        } catch {
          throw new RowError(`${row.t}.${name} is not JSON`);
        }
        if (canonical !== wire) throw new RowError(`${row.t}.${name} is not in canonical JSON form`);
        insert[name] = wire;
        app[name] = wire;
        break;
      }
      default: {
        if (typeof wire !== "string") throw new RowError(`${row.t}.${name} must be text`);
        asRowError(`${row.t}.${name}`, () => encodeValue(column.type, wire)); // id, ts, date: canonical forms only
        insert[name] = wire;
        app[name] = wire;
      }
    }
  }
  for (const column of def.columns) {
    if (column.name === "bundle_id" || column.name in insert) continue;
    if (!column.nullable && column.default === undefined) throw new RowError(`${row.t}.${column.name} is required`);
  }
  insert["bundle_id"] = bundleId;
  app["bundle_id"] = bundleId;
  return { table: row.t, insert, app };
}
