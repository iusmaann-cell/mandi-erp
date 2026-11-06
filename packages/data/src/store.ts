import { Kysely, type Dialect } from "kysely";
import type { Pool } from "pg";
import type { Clock } from "@mandi/core";
import { type Catalogue } from "./catalogue/define";
import { createPostgresPool, postgresDialect, type PostgresConnection } from "./drivers/postgres";
import { sqliteDialect } from "./drivers/sqlite";
import { CompanyContextError } from "./errors";
import { readSchema, type SchemaSnapshot } from "./introspection/snapshot";
import { migrate, type MigrationResult } from "./migrations/runner";
import { catalogueOf, MIGRATIONS, type Migration } from "./migrations/scripts";
import type { PlatformDatabase, UntypedDb } from "./model";
import { companyScopePlugin, installationScopePlugin } from "./scoped";
import type { DbKind } from "./types";

export interface CompanyContext {
  readonly companyId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A query handle that can only see and write one company's rows. */
export type ScopedDb = Kysely<PlatformDatabase>;
/** A query handle for installation-level tables (owner groups, nodes, devices) and the system tables; it refuses company tables. */
export type InstallationDb = Kysely<PlatformDatabase>;

/**
 * The only way to the database. There is no unscoped handle: a query on a company table needs a
 * company context (`scoped`), a query without one cannot be built (document 05, section 12).
 */
export interface DataStore {
  readonly kind: DbKind;
  readonly catalogue: Catalogue;
  scoped(context: CompanyContext): ScopedDb;
  installation(): InstallationDb;
  migrate(): Promise<MigrationResult>;
  readSchema(): Promise<SchemaSnapshot>;
  close(): Promise<void>;
}

class Store implements DataStore {
  readonly kind: DbKind;
  readonly catalogue: Catalogue;
  readonly #root: UntypedDb;
  readonly #clock: Clock;
  readonly #migrations: readonly Migration[];
  readonly #companyTables: ReadonlySet<string>;
  readonly #onClose: () => Promise<void>;

  constructor(kind: DbKind, dialect: Dialect, clock: Clock, migrations: readonly Migration[], onClose: () => Promise<void>) {
    this.kind = kind;
    this.#root = new Kysely<Record<string, never>>({ dialect });
    this.#clock = clock;
    this.#migrations = migrations;
    this.catalogue = catalogueOf(migrations);
    this.#companyTables = this.catalogue.companyTables();
    this.#onClose = onClose;
  }

  scoped(context: CompanyContext): ScopedDb {
    const id = (context as Partial<CompanyContext> | undefined)?.companyId;
    if (typeof id !== "string" || !UUID.test(id)) {
      throw new CompanyContextError("a company context with a valid company id is required");
    }
    return this.#root.withPlugin(companyScopePlugin(id, this.#companyTables)) as ScopedDb;
  }

  installation(): InstallationDb {
    return this.#root.withPlugin(installationScopePlugin(this.#companyTables)) as InstallationDb;
  }

  migrate(): Promise<MigrationResult> {
    return migrate(this.#root, this.kind, this.#clock, this.#migrations);
  }

  readSchema(): Promise<SchemaSnapshot> {
    return readSchema(this.#root, this.kind);
  }

  async close(): Promise<void> {
    await this.#root.destroy();
    await this.#onClose();
  }
}

export interface SqliteStoreOptions {
  /** A database file, or ":memory:". */
  readonly path: string;
  readonly clock: Clock;
  readonly migrations?: readonly Migration[];
}

/** For site nodes, Windows and Android stand-alone devices and tests (document 05, section 11). */
export function createSqliteStore(options: SqliteStoreOptions): DataStore {
  return new Store("sqlite", sqliteDialect(options.path), options.clock, options.migrations ?? MIGRATIONS, () => Promise.resolve());
}

export interface PostgresStoreOptions {
  readonly connection: PostgresConnection | Pool;
  readonly clock: Clock;
  readonly migrations?: readonly Migration[];
}

/** For the cloud (document 05, section 11). Passing an existing pool is for tests; it must come from `createPostgresPool`. */
export function createPostgresStore(options: PostgresStoreOptions): DataStore {
  const pool = "connectionString" in options.connection ? createPostgresPool(options.connection) : options.connection;
  return new Store("postgres", postgresDialect(pool), options.clock, options.migrations ?? MIGRATIONS, async () => {
    // Kysely's destroy() already ends the pool it was given
  });
}
