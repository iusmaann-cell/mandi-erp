import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";
import companyContext from "./rules/company-context.mjs";
import noAmbientTimeRandom from "./rules/no-ambient-time-random.mjs";
import noFloatingPoint from "./rules/no-floating-point.mjs";
import noMoneyArithmetic from "./rules/no-money-arithmetic.mjs";
import noRawSql, { looksLikeSql } from "./rules/no-raw-sql.mjs";
import testHook from "./rules/test-hook.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2023, sourceType: "module" } });
const jsx = new RuleTester({ languageOptions: { ecmaVersion: 2023, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } });
const SQL = (...parts) => parts.join(" "); // keeps SQL text out of this file's own string literals

const ENGINE = "packages/core/src/x.js";

tester.run("no-floating-point", noFloatingPoint, {
  valid: [
    "const a = 10;",
    "const a = 1_000_000;",
    "const h = 0x1F;",
    "const big = 12345678901234567890n;",
    "const q = 5n / 2n;",
    "const m = Math.max(1, 2) + Math.min(3, 4) + Math.abs(-1) + Math.trunc(7) + Math.sign(-3) + Math.imul(3, 4) + Math.clz32(8);",
    "const s = (5).toString();",
    "const n = Number.parseInt('12', 10);",
    "const million = 1e6;",
    { code: "const w = 0.5;", options: [{ literals: false }] },
    { code: "const r = a / b;", options: [{ division: false }] },
  ],
  invalid: [
    { code: "const a = 1.5;", errors: [{ messageId: "floatLiteral" }] },
    { code: "const a = 0.1 + 0.2;", errors: [{ messageId: "floatLiteral" }, { messageId: "floatLiteral" }] },
    { code: "const a = 1.0;", errors: [{ messageId: "floatLiteral" }] },
    { code: "const a = 1e-7;", errors: [{ messageId: "floatLiteral" }] },
    { code: "const a = 1e400;", errors: [{ messageId: "floatLiteral" }] },
    { code: "const a = parseFloat(s);", errors: [{ messageId: "floatCall" }] },
    { code: "const a = Number.parseFloat(s);", errors: [{ messageId: "floatCall" }] },
    { code: "const a = globalThis.parseFloat(s);", errors: [{ messageId: "floatCall" }] },
    { code: "const a = x.toFixed(2);", errors: [{ messageId: "floatCall" }] },
    { code: "const a = x.toPrecision(3);", errors: [{ messageId: "floatCall" }] },
    { code: "const a = Math.round(x);", errors: [{ messageId: "mathFn" }] },
    { code: "const a = Math.floor(x);", errors: [{ messageId: "mathFn" }] },
    { code: "const a = Math.pow(x, 2);", errors: [{ messageId: "mathFn" }] },
    { code: "const a = Math.PI;", errors: [{ messageId: "mathFn" }] },
    { code: "const a = x / y;", errors: [{ messageId: "division" }] },
    { code: "let a = 4; a /= 2;", errors: [{ messageId: "division" }] },
    { code: "const a = 7n / x;", errors: [{ messageId: "division" }] }, // untyped: only two bigint literals are trusted
    { code: "const a = 0.5;", options: [{ division: false }], errors: [{ messageId: "floatLiteral" }] },
    { code: "const a = parseFloat(s);", options: [{ literals: false, division: false }], errors: [{ messageId: "floatCall" }] },
  ],
});

tester.run("no-raw-sql", noRawSql, {
  valid: [
    { code: `const q = ${JSON.stringify(SQL("PRAGMA", "foreign_keys = ON"))};`, filename: "packages/data/src/drivers/sqlite.js", options: [{ allowPaths: ["packages/data/src/drivers/"] }] },
    { code: "const s = 'hello world';", filename: ENGINE },
    { code: "const events = ['UPDATE', 'DELETE', 'TRUNCATE'];", filename: ENGINE }, // single words are not statements
    { code: "const s = 'select all the items from the list';", filename: ENGINE }, // English, not SQL
    { code: "const s = 'Delete from cart';", filename: ENGINE },
    { code: "const s = 'Create table of contents';", filename: ENGINE },
    { code: "const s = 'Insert into position';", filename: ENGINE },
    { code: "const s = 'Update settings';", filename: ENGINE },
    { code: `const s = ${JSON.stringify(SQL("SELECT", "*", "FROM", "items"))};`, filename: "packages/data/migrations/sqlite/001_init.js" },
    { code: "import Database from 'better-sqlite3';", filename: "packages/data/src/open.js" },
    { code: "import { Kysely } from 'kysely';", filename: "packages/data/src/db.js" },
    { code: "import { clock } from './clock';", filename: ENGINE },
    { code: "const q = sql`now()`;", filename: "packages/data/src/q.js" },
  ],
  invalid: [
    { code: `const q = ${JSON.stringify(SQL("SELECT", "*", "FROM", "items"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("select id, name", "from", "items", "where id = ?"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("select count(*)", "from", "items"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: "const q = `" + SQL("SELECT", "*", "FROM") + " ${table}`;", filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("INSERT", "INTO", "items (id) VALUES (?)"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("insert", "into", "items(id) values (?)"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("UPDATE", "items", "SET", "qty = 1"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("DELETE", "FROM", "items WHERE id = 1"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("DELETE", "FROM", "items"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("CREATE", "TABLE", "items (id TEXT)"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("DROP", "TRIGGER", "IF EXISTS t1"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("PRAGMA", "journal_mode = WAL"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("TRUNCATE", "TABLE items"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("BEGIN", "IMMEDIATE"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("WITH", "t AS (SELECT 1)"))};`, filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: "const q = " + JSON.stringify(SQL("SELECT", "*", "FROM", "items WHERE id=")) + " + id;", filename: ENGINE, errors: [{ messageId: "rawSql" }] },
    { code: "const q = sql.raw(userText);", filename: "packages/data/src/q.js", errors: [{ messageId: "sqlRaw" }] },
    { code: `const q = ${JSON.stringify(SQL("PRAGMA", "foreign_keys = ON"))};`, filename: "packages/data/src/other/x.js", options: [{ allowPaths: ["packages/data/src/drivers/"] }], errors: [{ messageId: "rawSql" }] },
    { code: `const q = ${JSON.stringify(SQL("PRAGMA", "foreign_keys = ON"))};`, filename: "packages/core/src/drivers/x.js", options: [{ allowPaths: ["packages/data/src/drivers/"] }], errors: [{ messageId: "rawSql" }] },
    { code: "import pg from 'pg';", filename: ENGINE, errors: [{ messageId: "driver" }] },
    { code: "import { Kysely } from 'kysely';", filename: "packages/sync/src/x.js", errors: [{ messageId: "driver" }] },
    { code: "const d = require('better-sqlite3');", filename: ENGINE, errors: [{ messageId: "driver" }] },
    { code: "const d = await import('node:sqlite');", filename: ENGINE, errors: [{ messageId: "driver" }] },
    { code: "export * from 'pg';", filename: ENGINE, errors: [{ messageId: "driver" }] },
  ],
});

describe("looksLikeSql", () => {
  it("separates statements from sentences", () => {
    expect(looksLikeSql(SQL("SELECT", "1", "FROM", "t"))).toBe(true);
    expect(looksLikeSql("Select a customer from the list")).toBe(false);
    expect(looksLikeSql("Please update the price set by the owner")).toBe(false);
  });
});

tester.run("company-context", companyContext, {
  valid: [
    { code: "db.selectFrom('items');", filename: "packages/data/src/q.js" },
    { code: "list.map(x => x);", filename: ENGINE },
    { code: "tx.scoped.selectFrom('bundles');", filename: "packages/sync/src/apply.js", options: [{ allowPaths: ["packages/sync/"] }] },
    { code: "const t = tracker.selectFromX();", filename: ENGINE },
  ],
  invalid: [
    { code: "db.selectFrom('items').selectAll();", filename: ENGINE, errors: [{ messageId: "outsideData" }] },
    { code: "trx.insertInto('items').values(v);", filename: "packages/server/src/x.js", errors: [{ messageId: "outsideData" }] },
    { code: "this.db.updateTable('items');", filename: ENGINE, errors: [{ messageId: "outsideData" }] },
    { code: "db.deleteFrom('items');", filename: ENGINE, errors: [{ messageId: "outsideData" }] },
    { code: "tx.scoped.selectFrom('bundles');", filename: "packages/core/src/x.js", options: [{ allowPaths: ["packages/sync/"] }], errors: [{ messageId: "outsideData" }] }, // the engine may never touch a database
    { code: "tx.scoped.selectFrom('bundles');", filename: "packages/ui/src/x.js", options: [{ allowPaths: ["packages/sync/"] }], errors: [{ messageId: "outsideData" }] },
  ],
});

const ALLOWED = ["packages/core/src/runtime/system-clock.ts"];
tester.run("no-ambient-time-random", noAmbientTimeRandom, {
  valid: [
    { code: "const t = clock.nowMs();", filename: ENGINE },
    { code: "const d = new Date(0);", filename: ENGINE },
    { code: "const d = Date.UTC(2026, 6, 1);", filename: ENGINE },
    { code: "const r = random.nextInt(10);", filename: ENGINE },
    { code: "const t = Date.now();", filename: "packages/core/src/runtime/system-clock.ts", options: [{ allowFiles: ALLOWED }] },
    { code: "setTimeout(f, 1);", filename: ENGINE, options: [{ timers: false }] },
    { code: "import { createHash } from 'node:crypto';", filename: ENGINE },
  ],
  invalid: [
    { code: "const t = Date.now();", filename: ENGINE, errors: [{ messageId: "time" }] },
    { code: "const d = new Date();", filename: ENGINE, errors: [{ messageId: "time" }] },
    { code: "const t = performance.now();", filename: ENGINE, errors: [{ messageId: "time" }] },
    { code: "const t = globalThis.performance.now();", filename: ENGINE, errors: [{ messageId: "time" }] },
    { code: "const r = Math.random();", filename: ENGINE, errors: [{ messageId: "random" }] },
    { code: "const r = crypto.randomUUID();", filename: ENGINE, errors: [{ messageId: "random" }] },
    { code: "const r = globalThis.crypto.getRandomValues(a);", filename: ENGINE, errors: [{ messageId: "random" }] },
    { code: "import { randomBytes } from 'node:crypto';", filename: ENGINE, errors: [{ messageId: "random" }] },
    { code: "const r = randomUUID();", filename: ENGINE, errors: [{ messageId: "random" }] },
    { code: "setTimeout(f, 1);", filename: ENGINE, errors: [{ messageId: "timer" }] },
    { code: "setInterval(f, 1);", filename: ENGINE, errors: [{ messageId: "timer" }] },
    { code: "globalThis.setTimeout(f, 1);", filename: ENGINE, errors: [{ messageId: "timer" }] },
    { code: "const t = Date.now();", filename: "packages/core/src/other.ts", options: [{ allowFiles: ALLOWED }], errors: [{ messageId: "time" }] },
  ],
});

// Without type information the rule cannot know a type, so it stays silent; the typed behaviour is proved
// with the real tools in tools/ci/pipeline-proof.test.mjs.
tester.run("no-money-arithmetic", noMoneyArithmetic, {
  valid: ["const a = x * 2;", "const a = b / c;", "a *= 3;"],
  invalid: [],
});

jsx.run("test-hook", testHook, {
  valid: [
    "const a = <button data-testid=\"UI-01-01.signin.submit\">OK</button>;",
    "const a = <div>plain text</div>;",
    "const a = <input type=\"hidden\" name=\"csrf\" />;",
    "const a = <div role=\"button\" onClick={f} data-testid=\"shell.menu.toggle\" />;",
    "const a = <button {...props} />;",
    "const a = <Foo onClick={f} />;",
    "const a = <a href=\"/x\" data-testid=\"shell.nav.home\">Home</a>;",
    "const a = <button data-testid={`UI-03-01.row.${id}`}>x</button>;",
    "const a = <input data-testid=\"UI-01-01.signin.password\" type=\"password\" />;",
  ],
  invalid: [
    { code: "const a = <button>OK</button>;", errors: [{ messageId: "missingTestId" }] },
    { code: "const a = <input />;", errors: [{ messageId: "missingTestId" }] },
    { code: "const a = <select><option>x</option></select>;", errors: [{ messageId: "missingTestId" }] },
    { code: "const a = <a href=\"/x\">Home</a>;", errors: [{ messageId: "missingTestId" }] },
    { code: "const a = <div onClick={f} data-testid=\"shell.a.b\" />;", errors: [{ messageId: "missingRole" }] },
    { code: "const a = <div onClick={f} />;", errors: [{ messageId: "missingTestId" }, { messageId: "missingRole" }] },
    { code: "const a = <button data-testid=\"bad id\">x</button>;", errors: [{ messageId: "badTestId" }] },
    { code: "const a = <button data-testid=\"submit\">x</button>;", errors: [{ messageId: "badTestId" }] },
    { code: "const a = <button data-testid=\".submit\">x</button>;", errors: [{ messageId: "badTestId" }] },
  ],
});

describe("the plugin", () => {
  it("registers all six rules under the name mandi", async () => {
    const { default: plugin } = await import("./index.mjs");
    expect(plugin.meta.name).toBe("mandi");
    expect(Object.keys(plugin.rules).sort()).toEqual(["company-context", "no-ambient-time-random", "no-floating-point", "no-money-arithmetic", "no-raw-sql", "test-hook"]);
    expect(expect.anything()).toBeDefined();
  });
});
