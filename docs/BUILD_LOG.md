# Build log

What exists, how to run it, decisions of detail, known problems, and the next step. Written by every work
package; this file travels in the zip. The progress tracker is in the Claude Project (`build/progress.md`).

## How to run

See `README.md`. In short: `npm ci`, then `npm run check`.

## Work packages

### BC-01 Repository and pipeline (chat C1, 2026-11-05)

**What exists**
- Monorepo of nine workspace packages (`numeric`, `core`, `data`, `sync`, `server`, `shell`, `ui`, `android`, `testkit`), strict TypeScript, Vitest, fast-check, Playwright.
- The commit pipeline as one command, `npm run check` (`tools/ci/check.mjs`): typecheck, lint, secret scan, tests, dependency audit; writes `build-output/check-report.json`. GitHub workflows: `commit.yml` (Linux and Windows), `nightly.yml` (skeleton), `android.yml` (skeleton).
- Code rules as lint: no floating point, no raw SQL outside migrations, company context, no ambient time or randomness, test hooks (see `docs/CONVENTIONS.md`).
- Runtime ports in `@mandi/core`: `Clock` (`ManualClock`, system clock), `RandomSource` (`SeededRandom`, system random), UUIDv7 ids, `Runtime`, `createTestRuntime`. `PRODUCT_NAME` (AR-2).
- Secret scanner (`tools/secret-scan`) and SBOM script (`npm sbom`).
- Playwright set up with a smoke test.

**Proof**
- 191 unit and tool tests pass (38 core, 109 lint-rule, 39 secret-scan, 5 pipeline-proof). `tools/ci/pipeline-proof.test.mjs` is the exit proof: a planted float, number division, raw SQL string, `Date.now()`, query-builder call and fake secret each fail the build for the intended rule, a clean control passes, and the build is green again after removal.
- Core coverage 100% statements, 96.15% branches.
- NOT yet proven: the green run on Linux and Windows on GitHub, and the two Playwright smoke tests (this chat could not download a browser). Both happen on the first push; see "Open stops".

**Decisions of detail**
- TypeScript 6.0.3, not 7.0.2: typescript-eslint (8.72.0) supports TypeScript below 6.1 only, and the type-aware rules need it. Revisit when typescript-eslint supports 7.
- npm 11.21.1 is pinned (`packageManager`, `engines`, workflows): npm 10.9.9 crashes while resolving the Vitest peer tree.
- Versions are the newest release at least 14 days old at 2026-11-05: Vitest 5.0.5, ESLint 10.13.0, typescript-eslint 8.72.0, Vite 8.3.5, fast-check 4.10.2, Playwright 1.64.1, @types/node 22.20.5, globals 17.13.0, jiti 2.7.0. GitHub Actions are pinned by commit SHA (checkout 7.0.0, setup-node 7.0.0, upload-artifact 7.0.1, setup-java 6.1.0).
- SBOM uses npm's built-in `npm sbom` (no extra package). The CycloneDX CLI was tried and dropped: it pulled in a native XML addon.
- `mandi/no-floating-point` does not yet report multiplication; BC-02 introduces branded money types and tightens it.
- `mandi/company-context` is the lint half only (query builders only inside `packages/data`); BC-03 adds the runtime refusal and the schema test.
- Planning documents, the tracker and test reports are git-ignored here (`/planning/`, `/build/`, `/testing/`) because document 10, section 2.4 puts them in the Project. They are delivered next to each zip.
- Property tests: seed 1, 100 runs on commit; the nightly sets `FC_SEED` and `FC_RUNS`.
- Secret scan: values with spaces are not treated as secrets by the generic rule (a pass-phrase would be missed; the format-specific rules still apply). It scans files, not git history.

**Install scripts reviewed:** none run. `.npmrc` sets `ignore-scripts=true`; no dependency needed one.

**Known problems**
- `npm audit`: 10 moderate findings (minimatch, glob) inside the lint tool chain (dev only). 0 high or critical. The commit pipeline fails on high or critical only. Re-check at every package.
- The `android` workflow is a skeleton: it says so and builds nothing until BC-10 creates the Capacitor shell.
- The nightly workflow runs the commit stage with more property-test runs; the simulator, reference model and mutation runs are added by BC-05 to BC-09.

**Open stops**
- Usman: after the first push, report whether the `commit` workflow was green on both Linux and Windows, and whether the two Playwright tests passed.
- Reference devices (AR-3) are recorded in document 09's change log at the start of layer 0 (document 09, 4.2). They need Usman; no work before BC-10 depends on them.


### BC-02 Numeric module (chat C1, 2026-11-05)

**What exists** (`packages/numeric`, all exported from its index; `docs/CONVENTIONS.md` has the table)
- Branded int64 types `Paisa`, `Milli`, `Micro`, `R4`, `P4` with overflow refused, never wrapped; `add`, `sub`, `negate`, `abs`, `compare`, `sum`.
- `divRound`: the one rounding rule, half away from zero. `lineAmount`, `costOf`, `unitCostMicro`, `percentOf`, `consumptionCost` (last consumption takes the remaining value). Unit conversion with exact fractions (`factor`, `toBase`, `fromBase`).
- `toWire` and `fromWire` (PB-18). `parseScaled` and `formatScaled` with lakh and million grouping and Western and Urdu digits, and the display presets of document 07, 9.4.
- `Sha256` in integer arithmetic and `runNumericDigest` (N-3). Lint rule `mandi/no-money-arithmetic` (N-7); `@mandi/core` now depends on `@mandi/numeric`.
- `tools/ci/mutation-summary.mjs`, `stryker.numeric.config.mjs`, `vitest.mutation.numeric.config.ts`; the nightly workflow runs the mutation test.

**Proof**
- 214 numeric tests; whole suite 409 tests passing; `npm run check` (typecheck, lint, secret scan, tests, audit) green in 70 s.
- Coverage of `@mandi/numeric`: statements 99.47%, branches 92.09%, functions 100%.
- Mutation testing: **98.00%** killed (786 of 802), target 85%. Per file: arith 96.3, digest 94.4, digits 100, errors 100, format 100, limits 100 (no mutants), money 100, parse 100, round 92.9, sha256 97.1, types 100, units 100, wire 100. Run in slices, merged with `tools/ci/mutation-summary.mjs`.
- Survivors, all judged equivalent (no behaviour can differ): `arith.ts:23`, `round.ts:20`, `round.ts:24` (`<` against `<=` where only zero differs and zero negates to zero, or the divisor cannot be zero); `sha256.ts:11` and `:21` (a different starting guess for an integer root finder: same result, different speed); `sha256.ts:77` and `:81` (one extra write that is overwritten, and one write past the end of a typed array that is ignored); `digest.ts:63` (a non-numeric error would be counted as a refusal instead of thrown; none can occur); `digest.ts:120,125,126,135,136,156` (fallbacks that `noUncheckedIndexedAccess` forces and that can never run).
- N-1 at every scale (paisa, milli, micro, r4, p4, with negatives), N-2 (products above 2^53 are exact, 64-bit overflow refused), N-4 (PB-5 property on generated lot histories), N-5 (bags, maunds, cartons, awkward factors, entry unit different from rate unit; PB-10 properties), N-6 (typed input in both digit sets, ambiguous input refused), N-7 (lint, proved on planted files), PB-18, PB-19 are tested. The rounding, money and unit tests compare with an independently formulated oracle rather than the code's own formula.
- N-3: the Node run is a test in `@mandi/core` (100,000 operations, seed `n3-golden`, digest `3e15d93dda3f4d03a1d54cefea176587de9ee3829baa0305646cbb4182a2c78c`, 7,427 refusals). The Android WebView and Electron runs belong to BC-10 and BC-13 and are NOT done. The N-3 gate is not passed until they print this digest.
- SHA-256 matches the FIPS test messages and 14 reference digests made with Python's hashlib; its round constants are derived with integer roots and checked against the published ones.

**Decisions of detail**
- **Rounding of negatives (document 06, X-13, DM-25).** N-1 refers to negative amounts "as the document states", but no document stated the negative case. Decided: half away from zero. Same as half up for every positive amount; makes a reversal offset the original exactly. Amended in documents 06 (v0.3a) and 00; to be confirmed with the accountant under Q-1.
- Parsing refuses rather than guesses: grouping must be lakh or million, a grouped number may not start with 0 (`0,500` could be a European 0.5), more decimals than the field holds are refused (extra zeros are accepted), `-0` is refused where negatives are not allowed. `1,250` is read as 1250 (the Pakistani reading), never 1.25.
- `lineAmount` works from the stored base-unit quantity (document 06, 2.1): a quantity typed in another unit is converted to milli first (`toBase`, rounded to the nearest milli, with `isExactToBase` telling the document whether to show rounding), then multiplied.
- `numeric` imports nothing from `core` (core depends on numeric). The digest harness therefore takes its random source structurally (`nextUint32`, `nextInt`), which `SeededRandom` satisfies.
- Stryker is 10.1.1, published on 2026-10-23, exactly 14 days before this build: at the edge of the two-week rule, kept because 10.0.0 does not work with Vitest 5. The mutation run is nightly, not per commit.
- `npm audit`: 14 moderate findings (minimatch in the lint tool chain; `qs` via Stryker's `typed-rest-client`), dev tools only, 0 high or critical.

**Known problems**
- The N-3 gate is not complete (see above).
- A background process cannot outlive one tool call in the build chat's workspace, so the mutation test was run in slices; the nightly workflow runs it whole and has not run yet.

**Open stops**
- Usman: the BC-01 open stop (first GitHub run on Linux and Windows, and the Playwright smoke tests) still stands. Also confirm the rounding of negatives with the accountant (Q-1, X-13).

**Next:** BC-03 Data layer, both databases.
