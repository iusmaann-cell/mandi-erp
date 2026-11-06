import { sql } from "kysely";
import type { Clock } from "@mandi/core";
import { sha256Hex, utf8Bytes } from "@mandi/numeric";
import { Catalogue } from "../catalogue/define";
import type { UntypedDb } from "../model";
import type { DbKind } from "../types";
import { createTable } from "./ddl";
import { BOOTSTRAP_TABLE, MIGRATIONS, statementsOf, type Migration } from "./scripts";

export type MigrationErrorCode =
  | "checksum_mismatch" // an applied migration's script has changed since it was applied
  | "unknown_migration" // the database has a migration this program does not know: the program is older than the database
  | "name_mismatch"
  | "gap"; // applied migrations are not 1, 2, 3 ...

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  constructor(code: MigrationErrorCode, message: string) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
  }
}

export interface MigrationResult {
  readonly applied: readonly number[];
  readonly alreadyApplied: readonly number[];
}

/** SHA-256 over the migration's number, name and statements for this database. Stored when applied; checked at every start. */
export function checksumOf(migration: Migration, kind: DbKind, earlier: readonly Migration[]): string {
  const text = `${migration.id}\n${migration.name}\n${statementsOf(migration, kind, earlier).join("\n;\n")}`;
  return sha256Hex(utf8Bytes(text));
}

const ADVISORY_LOCK_KEY = 7_237_761; // one migration run at a time on a shared PostgreSQL

interface AppliedRow {
  readonly id: bigint;
  readonly name: string;
  readonly checksum: string;
}

/**
 * Apply every migration the database has not seen, in order, each in its own transaction. Before
 * anything runs, every migration already applied is checked against this program's copy: a changed
 * script, an unknown migration or a gap stops the run (the database must never be changed by a
 * program that does not match it).
 */
export async function migrate(db: UntypedDb, kind: DbKind, clock: Clock, migrations: readonly Migration[] = MIGRATIONS): Promise<MigrationResult> {
  for (const statement of createTable(BOOTSTRAP_TABLE, kind, new Catalogue([BOOTSTRAP_TABLE]), { ifNotExists: true })) {
    await sql.raw(statement).execute(db);
  }

  const applied: number[] = [];
  const already: number[] = [];
  for (const migration of migrations) {
    const earlier = migrations.filter((m) => m.id < migration.id);
    const didRun = await db.transaction().execute(async (trx) => {
      if (kind === "postgres") await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`.execute(trx);
      const rows = (await trx.selectFrom("schema_migrations").select(["id", "name", "checksum"]).orderBy("id").execute()) as AppliedRow[];
      verifyApplied(rows, migrations, kind);
      if (rows.some((r) => r.id === BigInt(migration.id))) return false;
      for (const statement of statementsOf(migration, kind, earlier)) {
        await sql.raw(statement).execute(trx);
      }
      await trx
        .insertInto("schema_migrations")
        .values({ id: BigInt(migration.id), name: migration.name, checksum: checksumOf(migration, kind, earlier), applied_at: new Date(clock.nowMs()).toISOString() })
        .execute();
      return true;
    });
    (didRun ? applied : already).push(migration.id);
  }
  return { applied, alreadyApplied: already };
}

function verifyApplied(rows: readonly AppliedRow[], migrations: readonly Migration[], kind: DbKind): void {
  rows.forEach((row, index) => {
    const id = Number(row.id);
    if (id !== index + 1) {
      throw new MigrationError("gap", `applied migrations are not consecutive: expected ${index + 1}, found ${id}`);
    }
    const known = migrations.find((m) => m.id === id);
    if (known === undefined) {
      throw new MigrationError("unknown_migration", `the database has migration ${id} (${row.name}), which this program does not have: update the program`);
    }
    if (known.name !== row.name) {
      throw new MigrationError("name_mismatch", `migration ${id} was applied as "${row.name}" but this program calls it "${known.name}"`);
    }
    const expected = checksumOf(known, kind, migrations.filter((m) => m.id < id));
    if (expected !== row.checksum) {
      throw new MigrationError("checksum_mismatch", `migration ${id} (${row.name}) has changed since it was applied; never edit an applied migration, add a new one`);
    }
  });
}
