import { Catalogue, type TableDef } from "../catalogue/define";
import { APPLY_GUARD, NUMBERING_TABLES, PLATFORM_TABLES, SCHEMA_MIGRATIONS } from "../catalogue/platform";
import type { DbKind } from "../types";
import { createTable, postgresFunctions, seedApplyGuard } from "./ddl";

/**
 * Forward-only, numbered migrations (document 06, section 13). There is no down script: a mistake is
 * repaired by a new migration. Class 1 rows are never rewritten by a migration. Migration 1 was replaced
 * once, in BC-04 and before any release, to give `audit_events.bundle_id` its foreign key to `bundles`
 * (SQLite cannot add one later); from the first release on, no applied migration is ever edited. A migration lists
 * the tables it creates (they join the catalogue) and may add statements before and after them.
 */
export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly tables: readonly TableDef[];
  readonly before?: (kind: DbKind) => string[];
  readonly after?: (kind: DbKind) => string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: "platform_tables",
    tables: [APPLY_GUARD, ...PLATFORM_TABLES],
    before: (kind) => (kind === "postgres" ? postgresFunctions() : []),
    after: (kind) => [seedApplyGuard(kind)],
  },
  { id: 2, name: "numbering_exceptions_and_chain_heads", tables: NUMBERING_TABLES },
];

/** The catalogue after the given migrations: the always-present schema_migrations table plus every table they create. */
export function catalogueOf(migrations: readonly Migration[] = MIGRATIONS): Catalogue {
  return new Catalogue([SCHEMA_MIGRATIONS, ...migrations.flatMap((m) => m.tables)]);
}

/** The statements of one migration for one database, given the migrations before it. */
export function statementsOf(migration: Migration, kind: DbKind, earlier: readonly Migration[]): string[] {
  const before = catalogueOf(earlier);
  const withThis = before.with(migration.tables);
  return [...(migration.before?.(kind) ?? []), ...migration.tables.flatMap((t) => createTable(t, kind, withThis)), ...(migration.after?.(kind) ?? [])];
}

export const BOOTSTRAP_TABLE = SCHEMA_MIGRATIONS;
