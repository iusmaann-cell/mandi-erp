# Conventions

These are enforced by tools, not by good intentions. A change that breaks one fails `npm run check`.

## Layout

| Path | What |
|------|------|
| `packages/numeric` | Integer money, quantity, cost, rate, percentage (BC-02) |
| `packages/core` | Pure engine: no database, no screens, no network. Today: the runtime ports (clock, random source, ids) |
| `packages/data` | The only place that touches a database (BC-03, BC-04) |
| `packages/sync`, `packages/server` | Bundles and sync; server code shared by cloud and site node |
| `packages/shell`, `packages/ui`, `packages/android` | Electron shell, React screens, Capacitor shell |
| `packages/testkit` | Test tools: world builder, scenario runner, reports, simulator |
| `tools/` | Build tooling: local lint rules, secret scanner, pipeline scripts. Has its own tests |
| `e2e/` | Playwright screen tests |
| `reference/starter-kit/` | Read-only reference (RU-1). Never imported, built, linted or shipped |

Packages export TypeScript source (`"exports": "./src/index.ts"`), so tests and typecheck need no build step.
`numeric` and `core` have no Node typings on purpose: they must run in the Android WebView too, so a
Node-only API there fails the typecheck. Tests sit beside the code as `*.test.ts`.

## Code rules (lint: `eslint.config.mjs`, rules in `tools/lint-rules`)

| Rule | What it forbids | Source |
|------|-----------------|--------|
| `mandi/no-floating-point` | decimal literals, `parseFloat`, `toFixed`, `Math` functions other than min, max, abs, sign, trunc, imul, clz32, and division unless both sides are bigint. Strict in numeric, core, data, sync, server, testkit; screen packages skip the literal and division checks only | doc 05 §10 |
| `mandi/no-raw-sql` | SQL text outside `*/migrations/*` (and the two files listed in `eslint.config.mjs`: `packages/data/src/drivers/` and `packages/data/src/introspection/`); `sql.raw`; importing a database driver or Kysely outside `packages/data` | SEC-5 |
| `mandi/company-context` | query-builder calls (`selectFrom`, `insertInto`, ...) outside `packages/data`. BC-03 adds the runtime refusal | doc 05 §12, SEC-19 |
| `mandi/no-ambient-time-random` | `Date.now`, `new Date()`, `performance.now`, `Math.random`, `crypto.randomUUID/getRandomValues`, timers, outside `system-clock.ts` and `system-random.ts` | TR-1, TR-2 |
| `mandi/no-money-arithmetic` | `* / % **` (and compound forms) on a Paisa, Milli, Micro, R4 or P4 value anywhere except `@mandi/numeric`. Needs type information | doc 05 §10, N-7 |
| `mandi/test-hook` | controls in `ui` and `shell` without a stable `data-testid`, a bad id format, click handlers on non-controls without `role` | TR-9 |

Fractions in a test on purpose (to check that something refuses them): build them from text, e.g. `Number("0.5")`.

## Numbers (`@mandi/numeric`, document 05 section 10)

Money, quantity, cost, rate and percentage are branded bigints: `Paisa` (0.01 rupee), `Milli` (0.001 of a base unit),
`Micro` (0.000001 rupee per base unit), `R4` (rate with 4 decimals), `P4` (percentage with 4 decimals; 18% = 180000).
Build them with `paisa(...)`, `milli(...)` and the others; every value is checked against signed 64 bits and an
overflow is refused with a `NumericError` (code `overflow`), never wrapped. Add, subtract and compare with `add`,
`sub`, `sum`, `compare`. Everything that multiplies or divides lives in the numeric package and is rounded once, at
the end, by `divRound`:

| Function | What |
|---|---|
| `lineAmount(qty, rate, rateUnit?)` | quantity x rate, the rate quoted per a rate unit (R-3) |
| `costOf(qty, unitCost)` | cost of a quantity at a unit cost |
| `unitCostMicro(total, qty)` | unit cost of a quantity bought for a total |
| `percentOf(amount, pct)` | a percentage of an amount |
| `consumptionCost(lot, qty, unitCost)` | the last consumption of a lot takes the remaining value (document 03, 2) |
| `factor`, `toBase`, `fromBase`, `isExact...` | trading units (R-2) with exact fractions |
| `toWire`, `fromWire` | whole numbers as canonical decimal strings in bundles and the API (PB-18) |
| `parseScaled`, `formatScaled`, `formatPaisa` ... | typed input and screen text: lakh or million grouping, Western or Urdu digits (document 07, 9.3, 9.4) |

**Rounding** is half away from zero: half up for positive amounts, the mirror image for negative ones (document 06,
X-13), so a reversal offsets the original to the paisa. **Parsing** refuses anything that could be read two ways
(`12,34`, `125,5`, `0,500`) and anything that would silently lose digits (too many decimals).
**N-3:** `runNumericDigest(random, count)` is the cross-platform digest; the Node value for the gate run is pinned in
`packages/core/src/numeric-digest.test.ts` and BC-10 and BC-13 must print the same digest in the Android WebView and Electron.

## Mutation testing (document 09, section 5.5)

`npm run mutation:numeric` makes small deliberate changes to `@mandi/numeric` and checks that the tests fail; the run
fails below 85% killed. Use Stryker 10.1.1 or newer: 10.0.0 does not work with Vitest 5 (every mutant survives).
To run it in slices (a short-lived workspace cannot run it in one go): `MUTATE_FILES=parse.ts,format.ts MUTATION_REPORT=build-output/mutation/a.json MUTATION_TIMEOUT_MS=6000 npx stryker run stryker.numeric.config.mjs`
(`sha256.ts:1-62` style line ranges also work), then `npm run mutation:summary -- build-output/mutation/*.json --survivors`.

## The data layer (`@mandi/data`, documents 05 section 11 and 12, 06 sections 12 and 13)

**One schema, described once.** Tables are data, in `src/catalogue/` (`table(...)`, `col.*`): class, scope, columns,
checks, indexes. The standard columns of document 06, 2.3 are added by class. `src/migrations/ddl.ts` turns a table
into SQL for SQLite or PostgreSQL; it is the only place SQL is written, and every identifier and enumeration value is
checked against a strict pattern. Migrations are numbered scripts in `src/migrations/scripts.ts`: forward-only, each
in its own transaction, recorded in `schema_migrations` with a SHA-256 checksum that is checked at every start. A
changed script, an unknown migration, a renamed one or a gap stops the run. **Never edit an applied migration: add a
new one.**

**Scope.** Every table is `company` (has `company_id`, behind the wall), `installation` (owner groups, nodes, devices:
no `company_id`; company tables refer to them with plain foreign keys, X-14) or `system` (`schema_migrations`,
`apply_guard`). Foreign keys between company tables are composite with `company_id`; every company index starts with
`company_id`; every company table has a unique (`company_id`, `id`).

**Access.** There is no unscoped handle. `store.scoped({ companyId })` returns a query handle that rewrites every
statement so it only sees and writes that company's rows (WHERE for main tables, ON for joined tables, inside
subqueries and CTEs; INSERT fills or checks `company_id`; upserts cannot touch another company's row; `company_id`
cannot be changed). `store.installation()` serves the installation and system tables and refuses company tables. Right and
full joins, insert-from-select and MERGE on company tables are refused. Raw SQL cannot be analysed: the lint rule is its guard.

**Immutability.** Class 1 tables get BEFORE UPDATE and BEFORE DELETE triggers that raise (and BEFORE TRUNCATE on
PostgreSQL). Projection tables (class P) accept writes only while `apply_guard` is open: `withApplyGuard(trx, work)`,
used only by `applyBundle`, inside a transaction.

**Forms.** `decodeRow` and `encodeRow` (catalogue-driven) give every logical type one canonical form on both databases:
ids lower-case UUID text, whole numbers bigint, flags boolean, dates `YYYY-MM-DD`, timestamps UTC to the millisecond,
JSON canonical text (X-15). `encodeValue` refuses a timestamp, date or id that is not already canonical (PostgreSQL would
accept `yesterday`).

**Schema test.** `checkSchema(await store.readSchema(), catalogue)` must return no violations and `diffSnapshots(sqlite, postgres)`
must be empty. A test builds deliberately damaged schemas to show the check fails; add a case there when you add a rule.

**Testing against both databases.** `import { startTestPostgres, createTestDatabase, seedWorld } from "@mandi/data/testing"`. The tests
start a real PostgreSQL (17.10) from the `embedded-postgres` npm binaries and a SQLite database, and run the same suite on both.
The PostgreSQL half runs on Linux and macOS and is skipped, with a loud message, on Windows (PostgreSQL only ever runs in the
Linux cloud container); `MANDI_TEST_POSTGRES=on` forces it on, `=off` skips it anywhere. If the server cannot start, the error
shows the server's own output.

## Bundles and applying them (`@mandi/sync`, documents 05 section 7 and 9, 06 sections 4 and 5)

**One write path.** Class 1 facts are written only by `applyBundleInTransaction` (D-1). The posting transaction of the engine
(`store.transaction(ctx, tx => ...)`) issues numbers with `NumberIssuer`, builds the rows with `toWireRow`, authors the next bundle with
`authorBundle`, and applies it in the same transaction (mode `author`); every other node and the cloud call `receiveBundle`
(mode `receive`). A rejection writes nothing: the author gets `ApplyRejected(code, detail)`; a receiver keeps the bundle,
quarantined, with an open row in `exceptions`, and a retry that succeeds resolves it. Failures of the connection are never rejections.

**Steps.** 1 envelope (schema version, hash, epoch, authority, `node_seq`, `prev_hash`); 2 content (rows well formed and class 1,
printed numbers unused, the registered validators); 3 insert (the bundle's own row first, then its rows); 4 projections with the apply
guard open (number counters, the node's chain head, the registered projectors; a projection that cannot be derived rejects the bundle).
Later work packages register their tables, numbering rules, validators and projectors in an `ApplyRegistry`; the machinery does not change.

**Format.** `Bundle` (bundle.ts): canonical JSON (keys sorted, no spaces), whole numbers as decimal strings on the wire, envelope counters
as JSON numbers within 2^53, `hash` = SHA-256 of everything but `hash` and `signature`. `verifyWireText` finds any single changed character;
`verifyBundleChain` finds a changed, lost, reordered or inserted bundle. A stored bundle is read back through `canonicalJson`
(PostgreSQL's `jsonb` re-spaces and reorders JSON).

**Numbers.** `TD-GA-01-2627-000045`: type, location code, device code, fiscal year, sequence (six digits, growing). The counter is a
projection that moves only when the bundle applies, so a rolled-back save never burns a number. `recoverSeries` jumps a replaced
device's counter ahead by 100 and records the range in `lost_numbers`. `checkIntegrity` is the start-up check after a crash.

**Testing.** `@mandi/sync/testing`: a trivial document type (`test_documents`, `test_document_lines`, `test_stock`), a two-node world
(`seedSyncWorld`), `postTestDocument`, `tableHash`. Golden bundles live in `packages/sync/golden` (rewrite on purpose with `UPDATE_GOLDEN=1`).
Crash-point tests abandon the connection after every statement (`DriverHooks`, a test seam; nothing in the product sets it).

## Time, randomness and ids (TR-1, TR-2)

Take a `Runtime` (`@mandi/core`): `clock`, `random`, `ids`. Apps use `createSystemRuntime()`. Tests use
`createTestRuntime({ seed })`: a `ManualClock` that moves only when told (`advance`, `advanceAsync`, and
`setWallMs` / `jumpWallMs` to make the wall clock wrong without touching durations) and a `SeededRandom`
(xoshiro128**, integer operations only, identical on every platform). Seeds are printed with every result (TS-8).
Row ids are UUIDv7 from `runtime.ids.newId()`: they never go backwards from one generator, even if the clock does.

## Test hooks (TR-9)

Every control has `data-testid="<screen-code-or-area>.<part>.<name>"`, for example `UI-01-01.signin.submit`
or `shell.sync-pill`. Native controls carry their role by being what they are; any other element with a
click or key handler also needs `role`. Scripts find controls by test id, never by text or position.
Playwright is configured with `testIdAttribute: "data-testid"` and reduced motion on.

## Property tests

fast-check is configured in `tools/ci/vitest-setup.mjs`: seed 1 and 100 runs by default, so a commit run is
repeatable. The nightly run sets `FC_SEED` (the run number) and `FC_RUNS`. A failure prints its seed;
replay with `FC_SEED=<seed> npm test`.

## Secrets (SEC-1)

`npm run secret-scan` checks every tracked and untracked, non-ignored file. A finding means the secret is
treated as leaked: rotate it, then remove it. Silence only with `secret-scan:allow <reason>` on the line, or
an entry (path, rule, reason of 10+ characters) in `.secret-scan.json`. `.env` files, key files and
certificates cannot be committed (`.env.example` can).

## Dependencies (SEC-2)

Exact versions, committed lock file, `npm ci`, install scripts off (`.npmrc`). `npm run audit:deps` fails
on high or critical findings. `npm run sbom` writes a CycloneDX SBOM. A dependency that needs an install
script is run by hand and recorded in `docs/BUILD_LOG.md`.

## Where things live (document 10, section 2.4)

Planning documents, the progress tracker and the test and gate reports live in the Claude Project, not in this
repository. This repository holds the code, the tests, the fixtures and `docs/BUILD_LOG.md`.
