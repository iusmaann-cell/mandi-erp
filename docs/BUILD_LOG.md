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

**Next:** BC-02 Numeric module.
