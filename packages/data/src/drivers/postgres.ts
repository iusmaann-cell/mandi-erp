import { PostgresDialect } from "kysely";
import pg from "pg";
import { normalizeTimestamp } from "../types";

const OID = { int8: 20, date: 1082, json: 114, jsonb: 3802, timestamp: 1114, timestamptz: 1184 } as const;

/**
 * Reads values from PostgreSQL in the same canonical forms SQLite gives (document 06, 2.2): whole
 * numbers as bigint, timestamps as UTC millisecond text, dates and JSON as text.
 */
const types = {
  getTypeParser(oid: number): (value: string) => unknown {
    switch (oid) {
      case OID.int8:
        return (v) => BigInt(v);
      case OID.timestamptz:
      case OID.timestamp:
        return (v) => normalizeTimestamp(v);
      case OID.date:
      case OID.json:
      case OID.jsonb:
        return (v) => v;
      default: {
        const standard: unknown = pg.types.getTypeParser(oid, "text");
        return standard as (value: string) => unknown;
      }
    }
  },
};

export interface PostgresConnection {
  readonly connectionString: string;
  readonly max?: number;
  /**
   * Called when an idle connection is lost (the server restarted, a failover, a network cut). The pool
   * discards that connection and opens a new one for the next query, so this is for logging only.
   */
  readonly onIdleError?: (error: Error) => void;
}

/**
 * A connection pool that reads in canonical forms and always works in UTC. node-postgres requires an
 * 'error' listener on the pool: without one, a connection the server drops while idle raises an
 * uncaught exception and ends the process.
 */
export function createPostgresPool(connection: PostgresConnection): pg.Pool {
  const pool = new pg.Pool({ connectionString: connection.connectionString, max: connection.max ?? 4, options: "-c timezone=UTC", types });
  pool.on("error", (error) => {
    connection.onIdleError?.(error);
  });
  return pool;
}

export function postgresDialect(pool: pg.Pool): PostgresDialect {
  return new PostgresDialect({ pool });
}
