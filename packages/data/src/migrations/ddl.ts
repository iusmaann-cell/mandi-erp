import type { Catalogue, Column, TableDef } from "../catalogue/define";
import { PHYSICAL_TYPE, type DbKind } from "../types";

/*
 * The one place that writes SQL (document 05, section 11; SEC-5). It turns a catalogue table into
 * statements for SQLite or PostgreSQL. Identifiers and enumeration values come from the catalogue,
 * which is code; each is checked against a strict pattern here so nothing odd can reach the SQL.
 */

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const ENUM_VALUE = /^[a-z][a-z0-9_]*$/;
const MAX_NAME = 63; // PostgreSQL's limit on an identifier

export function ident(name: string): string {
  if (!IDENTIFIER.test(name) || name.length > MAX_NAME) {
    throw new Error(`not a valid identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

const literal = (text: string): string => `'${text.replaceAll("'", "''")}'`;

export interface ForeignKey {
  readonly name: string;
  readonly columns: readonly string[];
  readonly refTable: string;
  readonly refColumns: readonly string[];
}

/** The foreign keys of a table (document 06, D-4): composite with company_id between company tables. */
export function foreignKeysOf(table: TableDef, catalogue: Catalogue): ForeignKey[] {
  const keys: ForeignKey[] = [];
  if (table.scope === "company" && table.name !== "companies") {
    keys.push({ name: `fk_${table.name}__company`, columns: ["company_id"], refTable: "companies", refColumns: ["id"] });
  }
  for (const c of table.columns) {
    if (c.references === undefined) continue;
    const target = c.references.table === table.name ? table : catalogue.get(c.references.table);
    if (target === undefined) {
      if (c.references.pending === true) continue;
      throw new Error(`${table.name}.${c.name} refers to unknown table ${c.references.table}`);
    }
    if (target.scope === "company") {
      if (table.scope !== "company") throw new Error(`${table.name}.${c.name}: a non-company table cannot refer to company table ${target.name}`);
      keys.push({ name: `fk_${table.name}__${c.name}`, columns: ["company_id", c.name], refTable: target.name, refColumns: ["company_id", "id"] });
    } else {
      keys.push({ name: `fk_${table.name}__${c.name}`, columns: [c.name], refTable: target.name, refColumns: ["id"] });
    }
  }
  return keys;
}

export interface IndexSpec {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
}

/** All indexes of a table including the (company_id, id) key that composite foreign keys point at; company_id first on every company index. */
export function indexesOf(table: TableDef): IndexSpec[] {
  const out: IndexSpec[] = [];
  const company = table.scope === "company";
  if (company) out.push({ name: `ux_${table.name}__company_id_id`, columns: ["company_id", "id"], unique: true });
  for (const i of table.indexes) {
    const columns = company ? ["company_id", ...i.columns] : i.columns;
    out.push({ name: i.name ?? `${i.unique ? "ux" : "ix"}_${table.name}__${columns.join("_")}`, columns, unique: i.unique });
  }
  return out;
}

function defaultSql(c: Column, kind: DbKind): string {
  const d = c.default;
  if (d === undefined) return "";
  switch (d.kind) {
    case "int":
      return ` DEFAULT ${d.value.toString()}`;
    case "bool":
      return ` DEFAULT ${kind === "sqlite" ? (d.value ? "1" : "0") : d.value ? "true" : "false"}`;
    case "text":
      return ` DEFAULT ${literal(d.value)}`;
  }
}

/** The CHECK constraints a column needs. SQLite has no uuid, timestamp, date, json or boolean type, so it checks the form instead. */
function columnChecks(table: TableDef, c: Column, kind: DbKind): string[] {
  const name = (suffix: string): string => ident(`ck_${table.name}_${c.name}__${suffix}`);
  const x = ident(c.name);
  if (c.type === "enum") {
    const values = c.enumValues ?? [];
    for (const v of values) if (!ENUM_VALUE.test(v)) throw new Error(`bad enumeration value ${v}`);
    return [`CONSTRAINT ${name("enum")} CHECK (${x} IN (${values.map(literal).join(", ")}))`];
  }
  if (kind === "postgres") return [];
  switch (c.type) {
    case "id":
      return [`CONSTRAINT ${name("id")} CHECK (${x} = lower(${x}) AND length(${x}) = 36)`];
    case "ts":
      return [`CONSTRAINT ${name("ts")} CHECK (${x} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')`];
    case "date":
      return [`CONSTRAINT ${name("date")} CHECK (${x} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`];
    case "json":
      return [`CONSTRAINT ${name("json")} CHECK (json_valid(${x}))`];
    case "bool":
      return [`CONSTRAINT ${name("bool")} CHECK (${x} IN (0, 1))`];
    default:
      return [];
  }
}

export function createTable(table: TableDef, kind: DbKind, catalogue: Catalogue, options: { readonly ifNotExists?: boolean } = {}): string[] {
  const lines: string[] = table.columns.map((c) => `${ident(c.name)} ${PHYSICAL_TYPE[kind][c.type]}${c.nullable ? "" : " NOT NULL"}${defaultSql(c, kind)}`);
  lines.push(`CONSTRAINT ${ident(`pk_${table.name}`)} PRIMARY KEY (${ident("id")})`);
  for (const fk of foreignKeysOf(table, catalogue)) {
    lines.push(`CONSTRAINT ${ident(fk.name)} FOREIGN KEY (${fk.columns.map(ident).join(", ")}) REFERENCES ${ident(fk.refTable)} (${fk.refColumns.map(ident).join(", ")})`);
  }
  for (const c of table.columns) lines.push(...columnChecks(table, c, kind));
  for (const check of table.checks) lines.push(`CONSTRAINT ${ident(`ck_${table.name}_${check.name}__rule`)} CHECK (${check.rule})`);

  const statements = [`CREATE TABLE ${options.ifNotExists === true ? "IF NOT EXISTS " : ""}${ident(table.name)} (\n  ${lines.join(",\n  ")}\n)${kind === "sqlite" ? " STRICT" : ""}`];
  for (const i of indexesOf(table)) {
    statements.push(`CREATE ${i.unique ? "UNIQUE " : ""}INDEX ${options.ifNotExists === true ? "IF NOT EXISTS " : ""}${ident(i.name)} ON ${ident(table.name)} (${i.columns.map(ident).join(", ")})`);
  }
  if (table.class === 1) statements.push(...appendOnlyTriggers(table.name, kind));
  if (table.class === "P") statements.push(...guardTriggers(table.name, kind));
  return statements;
}

/** Document 06, D-2 and section 12: BEFORE UPDATE and BEFORE DELETE refuse every change to a class 1 table (and TRUNCATE on PostgreSQL). */
export function appendOnlyTriggers(tableName: string, kind: DbKind): string[] {
  const t = ident(tableName);
  const message = literal(`class 1 table is append-only: ${tableName}`);
  if (kind === "sqlite") {
    return (["update", "delete"] as const).map((event) => `CREATE TRIGGER ${ident(`trg_${tableName}_no_${event}`)} BEFORE ${event.toUpperCase()} ON ${t} BEGIN SELECT RAISE(ABORT, ${message}); END`);
  }
  return [
    ...(["update", "delete"] as const).map((event) => `CREATE TRIGGER ${ident(`trg_${tableName}_no_${event}`)} BEFORE ${event.toUpperCase()} ON ${t} FOR EACH ROW EXECUTE FUNCTION mandi_raise_append_only()`),
    `CREATE TRIGGER ${ident(`trg_${tableName}_no_truncate`)} BEFORE TRUNCATE ON ${t} FOR EACH STATEMENT EXECUTE FUNCTION mandi_raise_append_only()`,
  ];
}

/** Document 06, D-3: projection tables accept writes only while `apply_guard` is open, which only applyBundle opens. */
export function guardTriggers(tableName: string, kind: DbKind): string[] {
  const t = ident(tableName);
  const message = literal(`projection table is written only by applyBundle: ${tableName}`);
  return (["insert", "update", "delete"] as const).map((event) =>
    kind === "sqlite"
      ? `CREATE TRIGGER ${ident(`trg_${tableName}_guard_${event}`)} BEFORE ${event.toUpperCase()} ON ${t} WHEN (SELECT is_open FROM apply_guard WHERE id = 1) = 0 BEGIN SELECT RAISE(ABORT, ${message}); END`
      : `CREATE TRIGGER ${ident(`trg_${tableName}_guard_${event}`)} BEFORE ${event.toUpperCase()} ON ${t} FOR EACH ROW EXECUTE FUNCTION mandi_require_apply_guard()`,
  );
}

/** PostgreSQL functions the triggers call. SQLite writes the check inline in each trigger. */
export function postgresFunctions(): string[] {
  return [
    `CREATE FUNCTION mandi_raise_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'class 1 table is append-only: %', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation'; END $$`,
    `CREATE FUNCTION mandi_require_apply_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT (SELECT is_open FROM apply_guard WHERE id = 1) THEN RAISE EXCEPTION 'projection table is written only by applyBundle: %', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation'; END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$`,
  ];
}

/** The row `apply_guard` always holds: one row, closed. */
export function seedApplyGuard(kind: DbKind): string {
  return `INSERT INTO ${ident("apply_guard")} (${ident("id")}, ${ident("is_open")}) VALUES (1, ${kind === "sqlite" ? "0" : "false"})`;
}
