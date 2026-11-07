import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Coverage of one package against document 09, section 5.6, written where the report generator reads it:
 *   node tools/ci/coverage.mjs <package>      ->  build-output/coverage/<package>.json
 * Test files, index files and the package's testing helpers are not counted (they are not the product).
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = process.argv[2];
if (pkg === undefined) {
  console.error("usage: node tools/ci/coverage.mjs <package>");
  process.exit(2);
}
const raw = join("build-output", "coverage", `${pkg}-raw`);
const result = spawnSync(
  process.execPath,
  [join(root, "node_modules", "vitest", "vitest.mjs"), "run", "--project", pkg, "--coverage", "--coverage.reporter=json-summary", `--coverage.reportsDirectory=${raw}`, `--coverage.include=packages/${pkg}/src/**`, "--coverage.exclude=**/*.test.ts", "--coverage.exclude=**/index.ts", `--coverage.exclude=packages/${pkg}/src/testing/**`],
  { cwd: root, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const total = JSON.parse(readFileSync(join(root, raw, "coverage-summary.json"), "utf8")).total;
mkdirSync(join(root, "build-output", "coverage"), { recursive: true });
const out = { package: pkg, statements: total.statements.pct, branches: total.branches.pct, functions: total.functions.pct, lines: total.lines.pct };
writeFileSync(join(root, "build-output", "coverage", `${pkg}.json`), `${JSON.stringify(out, null, 2)}\n`);
console.log(`coverage ${pkg}: statements ${out.statements}%  branches ${out.branches}%  functions ${out.functions}%  lines ${out.lines}%`);
