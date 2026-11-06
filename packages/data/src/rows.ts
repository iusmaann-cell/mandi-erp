import type { Catalogue } from "./catalogue/define";
import { decodeValue, encodeValue } from "./types";

/**
 * Rows to and from the canonical application forms, using the catalogue (the physical type map in
 * one place). The drivers already return whole numbers as bigint and timestamps, dates and JSON as
 * text on both databases; what is left is SQLite's integer flags and a normal form for ids and JSON.
 */
export function decodeRow(catalogue: Catalogue, tableName: string, row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const table = catalogue.get(tableName);
  if (table === undefined) throw new Error(`unknown table ${tableName}`);
  const out: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(row)) {
    const column = table.columns.find((c) => c.name === name);
    out[name] = column === undefined ? raw : decodeValue(column.type, raw);
  }
  return out;
}

export function encodeRow(catalogue: Catalogue, tableName: string, row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const table = catalogue.get(tableName);
  if (table === undefined) throw new Error(`unknown table ${tableName}`);
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    const column = table.columns.find((c) => c.name === name);
    out[name] = column === undefined ? value : encodeValue(column.type, value);
  }
  return out;
}
