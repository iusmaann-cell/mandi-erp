import { describe, expect, it } from "vitest";
import { createPostgresPool } from "./postgres";

describe("createPostgresPool", () => {
  it("always listens for pool errors, so a connection the server drops while idle cannot crash the process", async () => {
    const pool = createPostgresPool({ connectionString: "postgres://nobody@127.0.0.1:1/none" }); // nothing listens here; the pool never connects
    expect(pool.listenerCount("error")).toBe(1);
    await pool.end();
  });

  it("passes a lost idle connection to the caller's handler, and does not throw without one", async () => {
    const seen: string[] = [];
    const withHandler = createPostgresPool({ connectionString: "postgres://nobody@127.0.0.1:1/none", onIdleError: (e) => seen.push(e.message) });
    withHandler.emit("error", new Error("terminating connection"));
    expect(seen).toEqual(["terminating connection"]);
    const without = createPostgresPool({ connectionString: "postgres://nobody@127.0.0.1:1/none" });
    expect(() => without.emit("error", new Error("terminating connection"))).not.toThrow();
    await withHandler.end();
    await without.end();
  });
});
