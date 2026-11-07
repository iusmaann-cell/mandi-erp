import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "../secret-scan/scan.mjs";

/**
 * The commit pipeline (document 09, section 4.3, "On every commit"), as one command that runs the
 * same on a developer machine, a build chat's workspace and both CI runners:
 *   typecheck -> lint (includes the float, raw-SQL, company-context and clock rules)
 *   -> secret scan (SEC-1) -> tests -> dependency audit (SEC-2)
 * Every step runs even if an earlier one fails, so one run shows everything that is wrong.
 *
 *   node tools/ci/check.mjs [--offline] [--skip <step>[,<step>]] [--only <step>[,<step>]]
 * --offline skips the dependency audit (it needs the npm registry). Writes build-output/check-report.json.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const offline = args.includes("--offline");
const value = (flag) => args[args.indexOf(flag) + 1]?.split(",") ?? [];
const only = args.includes("--only") ? value("--only") : undefined;
const skip = args.includes("--skip") ? value("--skip") : [];
const BUDGET_SECONDS = 15 * 60; // document 09, 4.3: under 15 minutes

const bin = (...parts) => join(root, "node_modules", ...parts);

function node(script, scriptArgs, env = {}) {
  return spawnSync(process.execPath, [script, ...scriptArgs], { cwd: root, stdio: "inherit", env: { ...process.env, ...env } }).status === 0;
}

function npm(npmArgs) {
  // npm is a .cmd shim on Windows, which needs a shell to start
  return spawnSync("npm", npmArgs, { cwd: root, stdio: "inherit", shell: process.platform === "win32" }).status === 0;
}

const steps = [
  {
    name: "typecheck",
    run() {
      let ok = true;
      for (const dir of readdirSync(join(root, "packages"))) {
        const tsconfig = join("packages", dir, "tsconfig.json");
        if (existsSync(join(root, tsconfig)) && !node(bin("typescript", "bin", "tsc"), ["-p", tsconfig])) ok = false;
      }
      return node(bin("typescript", "bin", "tsc"), ["-p", "tsconfig.json"]) && ok;
    },
  },
  { name: "lint", run: () => node(bin("eslint", "bin", "eslint.js"), ["."]) },
  {
    name: "secret-scan",
    run() {
      const { findings, scanned, allowedByConfig } = scanProject(root);
      for (const f of findings) console.error(`${f.path}:${f.line}  [${f.rule}]  ${f.preview}`);
      console.log(`secret-scan: ${scanned} files scanned, ${findings.length} finding(s), ${allowedByConfig} allow-listed`);
      return findings.length === 0;
    },
  },
  {
    name: "test",
    run() {
      mkdirSync(join(root, "build-output"), { recursive: true });
      // what the previous run left for the report generator is cleared, so a report never mixes two runs
      rmSync(join(root, "build-output", "scenarios"), { recursive: true, force: true });
      rmSync(join(root, "build-output", "seeds.jsonl"), { force: true });
      // the JSON file, the scenario results and the seeds feed the test report generator (TR-12)
      return node(bin("vitest", "vitest.mjs"), ["run", "--reporter=default", "--reporter=json", "--outputFile.json=build-output/vitest-results.json"], { MANDI_RESULTS_DIR: "build-output" });
    },
  },
  { name: "audit", run: () => npm(["audit", "--audit-level=high"]) },
];

const results = [];
const started = Date.now();
for (const step of steps) {
  if ((only && !only.includes(step.name)) || skip.includes(step.name) || (offline && step.name === "audit")) {
    results.push({ step: step.name, status: "skipped", seconds: 0 });
    continue;
  }
  console.log(`\n=== ${step.name} ===`);
  const t0 = Date.now();
  let ok = false;
  try {
    ok = step.run();
  } catch (error) {
    console.error(error);
  }
  results.push({ step: step.name, status: ok ? "passed" : "FAILED", seconds: Math.round((Date.now() - t0) / 100) / 10 });
}
const total = Math.round((Date.now() - started) / 100) / 10;

console.log("\n=== summary ===");
for (const r of results) console.log(`${r.step.padEnd(12)} ${r.status.padEnd(8)} ${String(r.seconds).padStart(7)} s`);
console.log(`total        ${String(total).padStart(16)} s (budget ${BUDGET_SECONDS} s)`);

mkdirSync(join(root, "build-output"), { recursive: true });
// Wall-clock time is read here in a build tool, not in product code (TR-1 governs packages/).
writeFileSync(
  join(root, "build-output", "check-report.json"),
  JSON.stringify({ at: new Date().toISOString(), node: process.version, platform: process.platform, offline, totalSeconds: total, results }, null, 2),
);
const failed = results.filter((r) => r.status === "FAILED");
if (failed.length > 0) {
  console.error(`\nFAILED: ${failed.map((r) => r.step).join(", ")}`);
  process.exit(1);
}
if (total > BUDGET_SECONDS) {
  console.error(`\nThe pipeline took longer than ${BUDGET_SECONDS} s; the commit stage must stay under 15 minutes (document 09, 4.3).`);
  process.exit(1);
}
