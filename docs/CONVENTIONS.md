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
| `mandi/no-raw-sql` | SQL text outside `*/migrations/*`; `sql.raw`; importing a database driver or Kysely outside `packages/data` | SEC-5 |
| `mandi/company-context` | query-builder calls (`selectFrom`, `insertInto`, ...) outside `packages/data`. BC-03 adds the runtime refusal | doc 05 §12, SEC-19 |
| `mandi/no-ambient-time-random` | `Date.now`, `new Date()`, `performance.now`, `Math.random`, `crypto.randomUUID/getRandomValues`, timers, outside `system-clock.ts` and `system-random.ts` | TR-1, TR-2 |
| `mandi/test-hook` | controls in `ui` and `shell` without a stable `data-testid`, a bad id format, click handlers on non-controls without `role` | TR-9 |

Fractions in a test on purpose (to check that something refuses them): build them from text, e.g. `Number("0.5")`.

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
