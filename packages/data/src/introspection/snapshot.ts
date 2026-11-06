import { sql } from "kysely";
import type { UntypedDb } from "../model";
import { type DbKind, type LogicalType } from "../types";

/**
 * Reads the live schema of a database into one comparable shape (document 06, section 12: "a schema
 * test reads the live schema of both databases"). Only catalogue tables are read, no business data.
 * The raw catalogue queries below are the one reason this folder may hold SQL (lint option allowPaths).
 */

export interface ColumnSnapshot {
  readonly name: string;
  readonly physicalType: string;
  readonly logicalType: LogicalType;
  readonly nullable: boolean;
  readonly hasDefault: boolean;
}
export interface ForeignKeySnapshot {
  readonly columns: readonly string[];
  readonly refTable: string;
  readonly refColumns: readonly string[];
}
export interface IndexSnapshot {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
}
export type TriggerEvent = "insert" | "update" | "delete" | "truncate";
export interface TriggerSnapshot {
  readonly name: string;
  readonly event: TriggerEvent;
}
export interface TableSnapshot {
  readonly name: string;
  readonly columns: readonly ColumnSnapshot[];
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly ForeignKeySnapshot[];
  readonly indexes: readonly IndexSnapshot[];
  readonly triggers: readonly TriggerSnapshot[];
  /** Names of the enumeration and rule checks (`__enum`, `__rule`): the same on both databases. */
  readonly checks: readonly string[];
}
export interface SchemaSnapshot {
  readonly kind: DbKind;
  readonly tables: readonly TableSnapshot[];
}

const EMULATION = /__(id|ts|date|json|bool|enum)$/;

function logicalFor(kind: DbKind, table: string, column: string, physical: string, checks: readonly string[]): LogicalType {
  const mine = checks.find((c) => c.startsWith(`ck_${table}_${column}__`) && EMULATION.test(c));
  const suffix = mine === undefined ? undefined : (EMULATION.exec(mine)?.[1] as LogicalType | undefined);
  const p = physical.toLowerCase();
  if (kind === "postgres") {
    if (p === "uuid") return "id";
    if (p === "bigint") return "int64";
    if (p === "boolean") return "bool";
    if (p === "date") return "date";
    if (p === "jsonb" || p === "json") return "json";
    if (p.startsWith("timestamp")) return "ts";
    return suffix === "enum" ? "enum" : "text";
  }
  if (p === "integer") return suffix === "bool" ? "bool" : "int64";
  return suffix ?? "text";
}

const orEmpty = <T>(rows: readonly T[] | undefined): readonly T[] => rows ?? [];

export async function readSchema(db: UntypedDb, kind: DbKind): Promise<SchemaSnapshot> {
  return kind === "sqlite" ? readSqlite(db) : readPostgres(db);
}

// ---- SQLite -------------------------------------------------------------------------------------

async function readSqlite(db: UntypedDb): Promise<SchemaSnapshot> {
  const tables = (await sql<{ name: string; sql: string }>`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`.execute(db)).rows;
  const triggers = (await sql<{ name: string; tbl_name: string; sql: string }>`SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger'`.execute(db)).rows;
  const out: TableSnapshot[] = [];
  for (const t of tables) {
    const checks = [...t.sql.matchAll(/CONSTRAINT\s+"?(ck_[a-z0-9_]+)"?\s+CHECK/g)].map((m) => m[1] ?? "");
    const info = (await sql<{ name: string; type: string; not_null: bigint; dflt_value: string | null; pk: bigint }>`SELECT name, type, "notnull" AS not_null, dflt_value, pk FROM pragma_table_info(${t.name}) ORDER BY cid`.execute(db)).rows;
    const fkRows = (await sql<{ id: bigint; ref_table: string; from_col: string; to_col: string }>`SELECT id, "table" AS ref_table, "from" AS from_col, "to" AS to_col FROM pragma_foreign_key_list(${t.name}) ORDER BY id, seq`.execute(db)).rows;
    const fks = new Map<bigint, { columns: string[]; refTable: string; refColumns: string[] }>();
    for (const r of fkRows) {
      const fk = fks.get(r.id) ?? { columns: [], refTable: r.ref_table, refColumns: [] };
      fk.columns.push(r.from_col);
      fk.refColumns.push(r.to_col);
      fks.set(r.id, fk);
    }
    const indexList = (await sql<{ name: string; is_unique: bigint; origin: string }>`SELECT name, "unique" AS is_unique, origin FROM pragma_index_list(${t.name})`.execute(db)).rows.filter((i) => i.origin === "c");
    const indexes: IndexSnapshot[] = [];
    for (const i of indexList) {
      const cols = (await sql<{ name: string }>`SELECT name FROM pragma_index_info(${i.name}) ORDER BY seqno`.execute(db)).rows;
      indexes.push({ name: i.name, columns: cols.map((c) => c.name), unique: i.is_unique === 1n });
    }
    const mine = triggers
      .filter((tr) => tr.tbl_name === t.name)
      .map((tr): TriggerSnapshot => {
        const m = /\bBEFORE\s+(INSERT|UPDATE|DELETE)\b/i.exec(tr.sql);
        return { name: tr.name, event: (m?.[1] ?? "").toLowerCase() as TriggerEvent };
      });
    out.push({
      name: t.name,
      columns: info.map((c) => ({ name: c.name, physicalType: c.type, logicalType: logicalFor("sqlite", t.name, c.name, c.type, checks), nullable: c.not_null === 0n, hasDefault: c.dflt_value !== null })),
      primaryKey: info.filter((c) => c.pk > 0n).sort((a, b) => Number(a.pk - b.pk)).map((c) => c.name),
      foreignKeys: [...fks.values()],
      indexes,
      triggers: mine,
      checks: checks.filter((c) => /__(enum|rule)$/.test(c)),
    });
  }
  return { kind: "sqlite", tables: out };
}

// ---- PostgreSQL ---------------------------------------------------------------------------------

const TG_TYPE = { before: 2, insert: 4, delete: 8, update: 16, truncate: 32 } as const;

async function readPostgres(db: UntypedDb): Promise<SchemaSnapshot> {
  const columns = (
    await sql<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>`
      SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position`.execute(db)
  ).rows;
  const constraints = (
    await sql<{ table_name: string; conname: string; contype: string; ref_table: string | null; columns: string[]; ref_columns: string[] }>`
      SELECT rel.relname::text AS table_name, c.conname::text AS conname, c.contype::text AS contype, frel.relname::text AS ref_table,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS columns,
        ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.ord) AS ref_columns
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
      LEFT JOIN pg_class frel ON frel.oid = c.confrelid
      WHERE n.nspname = current_schema() AND c.contype IN ('p', 'f', 'c')`.execute(db)
  ).rows;
  const indexes = (
    await sql<{ table_name: string; index_name: string; is_unique: boolean; columns: string[] }>`
      SELECT t.relname::text AS table_name, i.relname::text AS index_name, ix.indisunique AS is_unique,
        ARRAY(SELECT a.attname::text FROM unnest(ix.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord) JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum ORDER BY k.ord) AS columns
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = current_schema() AND NOT ix.indisprimary`.execute(db)
  ).rows;
  const triggers = (
    await sql<{ table_name: string; tgname: string; tgtype: number }>`
      SELECT c.relname::text AS table_name, t.tgname::text AS tgname, t.tgtype::int AS tgtype
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = current_schema()`.execute(db)
  ).rows;

  const names = [...new Set(columns.map((c) => c.table_name))].sort();
  return {
    kind: "postgres",
    tables: names.map((name): TableSnapshot => {
      const checks = constraints.filter((c) => c.table_name === name && c.contype === "c").map((c) => c.conname);
      return {
        name,
        columns: columns
          .filter((c) => c.table_name === name)
          .map((c) => ({ name: c.column_name, physicalType: c.data_type, logicalType: logicalFor("postgres", name, c.column_name, c.data_type, checks), nullable: c.is_nullable === "YES", hasDefault: c.column_default !== null })),
        primaryKey: orEmpty(constraints.find((c) => c.table_name === name && c.contype === "p")?.columns),
        foreignKeys: constraints.filter((c) => c.table_name === name && c.contype === "f").map((c) => ({ columns: c.columns, refTable: c.ref_table ?? "", refColumns: c.ref_columns })),
        indexes: indexes.filter((i) => i.table_name === name).map((i) => ({ name: i.index_name, columns: i.columns, unique: i.is_unique })),
        triggers: triggers
          .filter((t) => t.table_name === name)
          .map((t): TriggerSnapshot => ({
            name: t.tgname,
            event: (t.tgtype & TG_TYPE.insert) !== 0 ? "insert" : (t.tgtype & TG_TYPE.update) !== 0 ? "update" : (t.tgtype & TG_TYPE.delete) !== 0 ? "delete" : "truncate",
          })),
        checks: checks.filter((c) => /__(enum|rule)$/.test(c)),
      };
    }),
  };
}
