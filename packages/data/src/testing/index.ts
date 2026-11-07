import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { Clock } from "@mandi/core";
import { createTestRuntime } from "@mandi/core";
import { createPostgresPool } from "../drivers/postgres";
import { createPostgresStore, createSqliteStore, type DataStore } from "../store";
import type { DbKind } from "../types";
import type { Migration } from "../migrations/scripts";
import type { DriverHooks } from "../drivers/hooks";

/**
 * Test helpers (document 09, TL-4): a real PostgreSQL server started from the npm binaries, and a
 * store on either database. Nothing here is imported by the product.
 *
 * Install-script review (SEC-2): the embedded-postgres binary package has an install script whose only
 * job is to create the library symlinks listed in native/pg-symlinks.json. Install scripts are off in
 * this repository, so `linkLibraries` does exactly that, from the same file, and nothing else.
 */

const PLATFORM = { linux: "linux", darwin: "darwin", win32: "windows" } as const;

function packageDirectory(): string {
  const platform = PLATFORM[process.platform as keyof typeof PLATFORM];
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch;
  // The package does not export its package.json, so start at its entry file and walk up to the folder that holds `native`.
  let dir = dirname(createRequire(import.meta.url).resolve(`@embedded-postgres/${platform}-${arch}`));
  while (!existsSync(join(dir, "native")) && dirname(dir) !== dir) dir = dirname(dir);
  return dir;
}

function linkLibraries(): void {
  const dir = packageDirectory();
  const file = join(dir, "native", "pg-symlinks.json");
  if (!existsSync(file)) return;
  const links = JSON.parse(readFileSync(file, "utf8")) as { source: string; target: string }[];
  for (const { source, target } of links) {
    const to = join(dir, target);
    let present = true;
    try {
      lstatSync(to);
    } catch {
      present = false;
    }
    if (!present) symlinkSync(basename(source), to);
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/**
 * Whether the PostgreSQL half of the tests runs here. PostgreSQL only ever runs in the Linux cloud
 * container (document 05, section 11), and document 09 TL-4 puts its contract tests in the Linux
 * pipeline, so the default is on everywhere except Windows. Set MANDI_TEST_POSTGRES=on to run it on
 * Windows too (it shows the server's own output if it cannot start), or =off to skip it anywhere.
 */
export function postgresTestsEnabled(): boolean {
  const setting = process.env["MANDI_TEST_POSTGRES"];
  if (setting === "on") return true;
  if (setting === "off") return false;
  return process.platform !== "win32";
}

export interface TestPostgres {
  /** A new empty database on the server, and a store-ready pool on it. */
  createDatabase(name: string): Promise<{ connectionString: string }>;
  stop(): Promise<void>;
}

export async function startTestPostgres(): Promise<TestPostgres> {
  linkLibraries();
  const port = await freePort();
  const databaseDir = mkdtempSync(join(tmpdir(), "mandi-pg-"));
  const output: string[] = [];
  const keep = (message: unknown): void => {
    output.push(typeof message === "string" ? message : JSON.stringify(message));
    if (output.length > 200) output.shift();
  };
  const server = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "mandi",
    password: "mandi",
    persistent: false,
    createPostgresUser: process.getuid?.() === 0, // PostgreSQL will not run as root (a sandbox may)
    postgresFlags: ["-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off"], // tests only
    onLog: keep,
    onError: keep,
  });
  try {
    await server.initialise();
    await server.start();
  } catch (error) {
    // never hide why the server would not start: say where, and show what it printed
    const reason = error instanceof Error ? error.message : JSON.stringify(error);
    rmSync(databaseDir, { recursive: true, force: true });
    throw new Error(`could not start the test PostgreSQL on ${process.platform}/${process.arch} with Node ${process.version}: ${reason}\n--- server output (last lines) ---\n${output.slice(-40).join("\n")}`, { cause: error });
  }
  return {
    async createDatabase(name: string) {
      await server.createDatabase(name);
      return { connectionString: `postgres://mandi:mandi@127.0.0.1:${port}/${name}` }; // secret-scan:allow throwaway password of a test server that lives only on 127.0.0.1 for one test run
    },
    async stop() {
      await server.stop();
      rmSync(databaseDir, { recursive: true, force: true });
    },
  };
}

let databaseSequence = 0;

export interface OpenTestStoreOptions {
  readonly clock?: Clock;
  readonly migrations?: readonly Migration[];
  /** The crash-point seam (drivers/hooks.ts). */
  readonly hooks?: DriverHooks;
}

/** One empty database that several stores can be opened on, one after another (as when a program is updated). */
export interface TestDatabase {
  readonly kind: DbKind;
  open(options?: OpenTestStoreOptions): DataStore;
}

/** A new empty database: a file in a temporary folder for SQLite, a new database on the given test server for PostgreSQL. */
export async function createTestDatabase(kind: DbKind, pg?: TestPostgres): Promise<TestDatabase> {
  databaseSequence += 1;
  const defaultClock = createTestRuntime({ seed: "data-tests" }).clock;
  const pick = (o: OpenTestStoreOptions) => ({ clock: o.clock ?? defaultClock, ...(o.migrations === undefined ? {} : { migrations: o.migrations }), ...(o.hooks === undefined ? {} : { hooks: o.hooks }) });
  if (kind === "sqlite") {
    const path = join(mkdtempSync(join(tmpdir(), "mandi-sqlite-")), "test.db");
    return { kind, open: (o = {}) => createSqliteStore({ path, ...pick(o) }) };
  }
  if (pg === undefined) throw new Error("a PostgreSQL test database needs a started test server (startTestPostgres)");
  const { connectionString } = await pg.createDatabase(`t_${String(databaseSequence)}`);
  return { kind, open: (o = {}) => createPostgresStore({ connection: createPostgresPool({ connectionString, max: 2, ...(o.hooks === undefined ? {} : { hooks: o.hooks }) }), ...pick(o) }) };
}

/** A migrated-on-demand store on a new database; convenience for tests that need only one. */
export async function openTestStore(kind: DbKind, options: OpenTestStoreOptions & { readonly pg?: TestPostgres } = {}): Promise<DataStore> {
  return (await createTestDatabase(kind, options.pg)).open(options);
}

export { seedWorld, type SeededCompany, type World } from "./seed";
export { TEST_DOCUMENT_LINES, TEST_DOCUMENTS, TEST_STOCK, WITH_TEST_DOCUMENTS } from "../migrations/test-fixtures";
