import { DatabaseSync } from "node:sqlite";
import { SqliteDialect, type SqliteDatabase, type SqliteStatement } from "kysely";
import type { DriverHooks } from "./hooks";

/** Settings applied to every SQLite connection (document 05, section 11: write-ahead mode; document 06, section 12). */
const PRAGMAS = ["PRAGMA journal_mode = WAL", "PRAGMA foreign_keys = ON", "PRAGMA busy_timeout = 5000", "PRAGMA synchronous = FULL"];

const bind = (parameters: readonly unknown[]): (string | bigint | number | null)[] =>
  parameters.map((v) => {
    if (typeof v === "boolean") return v ? 1 : 0; // SQLite has no boolean parameter
    if (v === undefined) return null;
    return v as string | bigint | number | null;
  });

/** The oldest Node whose built-in SQLite has StatementSync.columns(), which tells a query that returns rows from one that does not. */
export const MINIMUM_NODE_FOR_SQLITE = "22.16.0";

class NodeSqliteDatabase implements SqliteDatabase {
  readonly #db: DatabaseSync;
  readonly #hooks: DriverHooks;
  #statements = 0;

  constructor(path: string, hooks: DriverHooks) {
    this.#hooks = hooks;
    this.#db = new DatabaseSync(path);
    if (typeof this.#db.prepare("PRAGMA user_version").columns !== "function") {
      this.#db.close();
      throw new Error(`this Node (${process.version}) has no StatementSync.columns(): Node ${MINIMUM_NODE_FOR_SQLITE} or newer is needed for the built-in SQLite`);
    }
    for (const pragma of PRAGMAS) this.#db.exec(pragma);
  }

  close(): void {
    this.#db.close();
  }

  #after(sql: string): void {
    this.#statements += 1;
    this.#hooks.afterStatement?.({ sql, index: this.#statements, abandon: () => this.#db.close() });
  }

  prepare(text: string): SqliteStatement {
    const statement = this.#db.prepare(text);
    statement.setReadBigInts(true); // whole numbers come back as bigint, never as a rounded number
    return {
      reader: statement.columns().length > 0,
      all: (parameters) => {
        const rows = statement.all(...bind(parameters));
        this.#after(text);
        return rows;
      },
      run: (parameters) => {
        const result = statement.run(...bind(parameters));
        this.#after(text);
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      },
      iterate: (parameters) => statement.iterate(...bind(parameters)),
    };
  }
}

/** A Kysely dialect over Node's built-in SQLite. `path` is a file, or ":memory:" for tests. */
export function sqliteDialect(path: string, hooks: DriverHooks = {}): SqliteDialect {
  return new SqliteDialect({ database: new NodeSqliteDatabase(path, hooks) });
}
