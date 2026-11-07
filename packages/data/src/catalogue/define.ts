import type { LogicalType } from "../types";

/**
 * The catalogue describes every table once, as data. The migration scripts turn it into SQL for each
 * database, the schema test checks the live databases against it, and the scoped data layer reads
 * it to know which tables carry the company wall. No SQL appears in this file.
 */

/** Document 05, section 6: 1 posted facts, 2 master data, 3 controlled data, 4 derived summary, P projection, S system, L local. */
export type TableClass = 1 | 2 | 3 | 4 | "P" | "S" | "L";

/**
 * company: carries `company_id`, is behind the company wall, and refers to other company tables only
 *   with composite foreign keys (document 06, D-4, section 12).
 * installation: belongs to the whole installation (owner groups, nodes, devices): no `company_id`.
 *   A company table refers to it with a plain foreign key. (Decision X-14: document 06 listed these
 *   tables without a company but did not say how the wall rule treats them.)
 * system: the database's own machinery (schema_migrations, apply_guard).
 */
export type TableScope = "company" | "installation" | "system";

export type ColumnDefault =
  | { readonly kind: "int"; readonly value: bigint }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "text"; readonly value: string };

export interface ColumnReference {
  readonly table: string;
  /** A table a later work package creates. The foreign key is added when that table exists in the catalogue. */
  readonly pending?: true;
}

export interface Column {
  readonly name: string;
  readonly type: LogicalType;
  readonly nullable: boolean;
  readonly enumValues?: readonly string[];
  readonly default?: ColumnDefault;
  readonly references?: ColumnReference;
}

/** A rule written as SQL that means the same on both databases (comparisons, length, BETWEEN, IN, AND, OR). */
export interface Check {
  readonly name: string;
  readonly rule: string;
}

export interface IndexDef {
  readonly columns: readonly string[];
  readonly unique: boolean;
  /** For an index whose generated name would be longer than PostgreSQL's 63 characters. */
  readonly name?: string;
}

export interface TableDef {
  readonly name: string;
  readonly class: TableClass;
  readonly scope: TableScope;
  /** Every column in order, standard columns included. */
  readonly columns: readonly Column[];
  readonly checks: readonly Check[];
  /** Indexes other than the primary key and the (company_id, id) key. `company_id` is put in front for company tables. */
  readonly indexes: readonly IndexDef[];
}

// ---- column builders ----------------------------------------------------------------------------

interface Options {
  readonly null?: true;
  readonly default?: ColumnDefault;
}
const base = (name: string, type: LogicalType, o: Options = {}): Column => ({
  name,
  type,
  nullable: o.null === true,
  ...(o.default === undefined ? {} : { default: o.default }),
});

export const col = {
  id: (name: string, o?: Options): Column => base(name, "id", o),
  ref: (name: string, table: string, o: Options & { readonly pending?: true } = {}): Column => ({
    ...base(name, "id", o),
    references: { table, ...(o.pending === true ? { pending: true as const } : {}) },
  }),
  int: (name: string, o?: Options): Column => base(name, "int64", o),
  text: (name: string, o?: Options): Column => base(name, "text", o),
  date: (name: string, o?: Options): Column => base(name, "date", o),
  ts: (name: string, o?: Options): Column => base(name, "ts", o),
  bool: (name: string, o?: Options): Column => base(name, "bool", o),
  json: (name: string, o?: Options): Column => base(name, "json", o),
  enum: (name: string, values: readonly string[], o?: Options): Column => ({ ...base(name, "enum", o), enumValues: values }),
};

export const dflt = {
  int: (value: bigint): ColumnDefault => ({ kind: "int", value }),
  bool: (value: boolean): ColumnDefault => ({ kind: "bool", value }),
  text: (value: string): ColumnDefault => ({ kind: "text", value }),
};

// ---- table builder ------------------------------------------------------------------------------

export interface TableSpec {
  readonly name: string;
  readonly class: TableClass;
  readonly scope: TableScope;
  /** The table's own columns. `id`, `company_id` and the standard columns of document 06, 2.3 are added. */
  readonly columns: readonly Column[];
  readonly checks?: readonly Check[];
  readonly indexes?: readonly IndexDef[];
}

function standardColumns(cls: TableClass): Column[] {
  switch (cls) {
    case 1:
      return [col.ref("bundle_id", "bundles", { pending: true }), col.ts("created_at")];
    case 2:
      return [
        col.int("version", { default: dflt.int(1n) }),
        col.json("field_versions_json", { default: dflt.text("{}") }),
        col.ts("updated_at"),
        col.ref("updated_by_node_id", "nodes", { null: true }),
        col.bool("is_active", { default: dflt.bool(true) }),
      ];
    case 3:
      return [col.int("version", { default: dflt.int(1n) }), col.ts("updated_at"), col.ref("updated_by_user_id", "users", { null: true, pending: true })];
    default:
      return [];
  }
}

/** Expand a table spec into a full definition: standard columns, and the version check for classes 2 and 3. */
export function table(spec: TableSpec): TableDef {
  const lead: Column[] = spec.scope === "system" ? [] : spec.scope === "installation" ? [col.id("id")] : [col.id("id"), col.id("company_id")];
  const standard = spec.scope === "system" ? [] : standardColumns(spec.class);
  const hasVersion = standard.some((c) => c.name === "version");
  return {
    name: spec.name,
    class: spec.class,
    scope: spec.scope,
    columns: [...lead, ...spec.columns, ...standard],
    checks: [...(spec.checks ?? []), ...(hasVersion ? [{ name: "version_positive", rule: "version >= 1" }] : [])],
    indexes: spec.indexes ?? [],
  };
}

// ---- the catalogue ------------------------------------------------------------------------------

export class Catalogue {
  readonly tables: readonly TableDef[];
  readonly #byName: ReadonlyMap<string, TableDef>;

  constructor(tables: readonly TableDef[]) {
    this.tables = tables;
    this.#byName = new Map(tables.map((t) => [t.name, t]));
    if (this.#byName.size !== tables.length) {
      throw new Error("the catalogue has two tables with one name");
    }
  }

  get(name: string): TableDef | undefined {
    return this.#byName.get(name);
  }

  has(name: string): boolean {
    return this.#byName.has(name);
  }

  /** Tables behind the company wall. */
  companyTables(): ReadonlySet<string> {
    return new Set(this.tables.filter((t) => t.scope === "company").map((t) => t.name));
  }

  with(more: readonly TableDef[]): Catalogue {
    return new Catalogue([...this.tables, ...more]);
  }
}

export const isLogicalNumber = (type: LogicalType): boolean => type === "int64";
