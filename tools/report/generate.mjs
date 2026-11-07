import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeMutation } from "../ci/mutation-core.mjs";

/**
 * The test report generator (document 09, TR-12): gathers the results, the seeds, the coverage and the
 * mutation scores of a run into the one-page report of section 15.2. The figures come from the files the
 * run itself wrote (build-output/): nothing is typed in by hand except the narrative in the notes file
 * (what was built, decisions, defects, risks). The text is a pure function of its inputs, so the same run
 * gives the same report.
 *
 *   node tools/report/generate.mjs --notes testing/BC-05-notes.json --out testing/BC-05-test-report.md
 */

/** Packages that hold money, stock, posting or tax rules: the strict coverage targets of section 5.6. */
export const STRICT_PACKAGES = ["numeric", "core"];
export const TARGETS = { strict: { statements: 95, branches: 90 }, other: { statements: 80 } };
const MUTATION_TARGET = 85;

const pct = (n) => (Number.isFinite(n) ? `${n.toFixed(2)}%` : "n/a");
const list = (items, empty) => (items === undefined || items.length === 0 ? [`- ${empty}`] : items.map((i) => `- ${i}`));
const cell = (s) => String(s).replaceAll("|", "\\|");

function projectOf(file) {
  const m = /[\\/]packages[\\/]([^\\/]+)[\\/]/.exec(file);
  if (m) return m[1];
  return /[\\/]tools[\\/]/.test(file) ? "tools" : "other";
}

/** Counts per project from a Vitest JSON report. */
export function summarizeVitest(results) {
  const projects = new Map();
  const failed = [];
  for (const file of results.testResults ?? []) {
    const name = projectOf(file.name);
    const row = projects.get(name) ?? { project: name, passed: 0, failed: 0, skipped: 0 };
    for (const t of file.assertionResults ?? []) {
      if (t.status === "passed") row.passed += 1;
      else if (t.status === "failed") {
        row.failed += 1;
        failed.push(`${name}: ${t.fullName ?? t.title}`);
      } else row.skipped += 1;
    }
    projects.set(name, row);
  }
  const rows = [...projects.values()].sort((a, b) => a.project.localeCompare(b.project));
  return { rows, passed: rows.reduce((a, r) => a + r.passed, 0), failed: rows.reduce((a, r) => a + r.failed, 0), skipped: rows.reduce((a, r) => a + r.skipped, 0), failedNames: failed };
}

function coverageSection(coverage) {
  if (coverage.length === 0) return ["No coverage was measured in this run (run `npm run coverage:package -- <package>`)."];
  const lines = ["| Package | Statements | Branches | Functions | Lines | Target | Result |", "|---|---|---|---|---|---|---|"];
  for (const c of coverage) {
    const strict = STRICT_PACKAGES.includes(c.package);
    const target = strict ? TARGETS.strict : TARGETS.other;
    const meets = c.statements >= target.statements && (!strict || c.branches >= target.branches);
    lines.push(`| ${c.package} | ${pct(c.statements)} | ${pct(c.branches)} | ${pct(c.functions)} | ${pct(c.lines)} | ${strict ? `${target.statements}% statements, ${target.branches}% branches` : `${target.statements}% statements`} | ${meets ? "meets" : "BELOW TARGET"} |`);
  }
  return lines;
}

function scenarioSection(scenarios) {
  if (scenarios.length === 0) return ["No scenario files were run."];
  const lines = ["| Scenario | Engine | Data set (fingerprint) | Seed | Steps | Checks pass / fail / n.a. | Result |", "|---|---|---|---|---|---|---|"];
  for (const s of scenarios) {
    const n = (status) => s.checks.filter((c) => c.status === status).length;
    lines.push(`| ${cell(s.scenario)} | ${cell(s.driver)} | ${s.dataSet} (${s.dataFingerprint}) | ${cell(s.seed)} | ${s.steps.length} | ${n("pass")} / ${n("fail")} / ${n("not_applicable")} | ${s.passed ? "pass" : "FAIL"} |`);
  }
  const na = [...new Set(scenarios.flatMap((s) => s.checks.filter((c) => c.status === "not_applicable").map((c) => `${c.id} (${c.detail ?? "no reason given"})`)))];
  if (na.length > 0) lines.push("", `Integrity checks the engine could not make, and why: ${na.join("; ")}.`);
  return lines;
}

/** The whole report, as text, from the inputs. */
export function generateReport(input) {
  const { notes } = input;
  const vitest = input.vitest === undefined ? undefined : summarizeVitest(input.vitest);
  const out = [];
  out.push(`# Test report: ${notes.workPackage} ${notes.title}`, "");
  out.push(`Chat ${notes.chat ?? "?"}, ${notes.date ?? "date not given"}. Commit \`${notes.commit ?? "not given"}\`. Definition of done: document 09, section 15.2.`, "");
  out.push("**Built.**", ...list(notes.built, "(nothing listed)"), "");
  out.push("**Tests added, by level (document 09, section 3).**", "");
  if ((notes.tests ?? []).length === 0) out.push("(none listed)");
  else {
    out.push("| Level | What | Count |", "|---|---|---|");
    for (const t of notes.tests) out.push(`| ${cell(t.level)} | ${cell(t.what)} | ${t.count ?? ""} |`);
  }
  out.push("");
  out.push("**Result of the full run.**", "");
  if (vitest === undefined) out.push("No test results file was found (build-output/vitest-results.json): run `npm run check` first.");
  else {
    out.push("| Project | Passed | Failed | Skipped |", "|---|---|---|---|");
    for (const r of vitest.rows) out.push(`| ${r.project} | ${r.passed} | ${r.failed} | ${r.skipped} |`);
    out.push(`| **Total** | **${vitest.passed}** | **${vitest.failed}** | **${vitest.skipped}** |`, "");
    if (vitest.failed === 0) out.push("No test failed.");
    else out.push("Failed tests:", ...vitest.failedNames.map((n) => `- ${n}`));
  }
  if ((notes.knownFailures ?? []).length > 0) out.push("", "Known failures (defect numbers):", ...notes.knownFailures.map((k) => `- ${k}`));
  if (input.checkReport !== undefined) {
    const steps = input.checkReport.results.map((r) => `${r.step} ${r.status} (${r.seconds} s)`).join(", ");
    out.push("", `Pipeline (\`npm run check\`, ${input.checkReport.platform}, Node ${input.checkReport.node}): ${steps}; total ${input.checkReport.totalSeconds} s of the 900 s budget.`);
  }
  out.push("");
  out.push("**Scenario runs (TR-7).**", "", ...scenarioSection(input.scenarios ?? []), "");
  out.push("**Seeds (TS-8).**", "");
  const seeds = input.seeds ?? [];
  if (seeds.length === 0 && input.env?.FC_SEED === undefined) out.push("No seeds were recorded in this run.");
  else {
    out.push(`Property tests: seed ${input.env?.FC_SEED ?? "1"}, ${input.env?.FC_RUNS ?? "100"} runs (replay with FC_SEED=<seed>).`);
    if (seeds.length > 0) {
      out.push("", "| Kind | Seed | Note |", "|---|---|---|");
      for (const s of seeds) out.push(`| ${cell(s.kind)} | ${cell(s.seed)} | ${cell(s.note ?? "")} |`);
    }
  }
  out.push("", `Simulator seeds run and seed-bank size: ${notes.simulator ?? "no simulator exists yet (BC-08); the seed bank has 0 seeds"}.`, "");
  out.push("**Coverage against document 09, section 5.6.**", "", ...coverageSection(input.coverage ?? []), "");
  out.push("**Mutation score (section 5.5, target " + MUTATION_TARGET + "%).**", "");
  const mutation = input.mutation;
  if (mutation === undefined) out.push("Not applicable to this work package, or not run.");
  else {
    out.push(`${pct(mutation.score)} killed (${mutation.killed} of ${mutation.counted} mutants): ${mutation.score >= MUTATION_TARGET ? "meets" : "BELOW"} the target.`, "", "| File | Killed | Survived | Uncovered | Score |", "|---|---|---|---|---|");
    for (const r of mutation.rows) out.push(`| ${r.file} | ${r.killed} | ${r.survived} | ${r.noCoverage} | ${r.score.toFixed(1)}% |`);
  }
  out.push("", "**Performance figures against document 10.1.**", "", ...(notes.performance === undefined || notes.performance.length === 0 ? ["Not applicable: no performance marks exist yet."] : notes.performance.map((p) => `- ${p}`)), "");
  out.push("**Defects found while building.**", ...list(notes.defects, "none"), "");
  out.push("**Decisions made.**", ...list(notes.decisions, "none"), "");
  out.push("**Permission rows added.**", ...list(notes.permissionRows, "none"), "");
  out.push("**Not applicable, with reason.**", ...list((notes.notApplicable ?? []).map((n) => `${n.item}: ${n.reason}`), "(nothing marked)"), "");
  out.push("**Open risks.**", ...list(notes.risks, "none"), "");
  return `${out.join("\n")}\n`;
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** Reads the files a run wrote into build-output/. Every part is optional; a missing part is reported as missing, never invented. */
export function collectInputs(root, notesPath) {
  const out = join(root, "build-output");
  const input = { notes: readJson(notesPath), env: { FC_SEED: process.env["FC_SEED"], FC_RUNS: process.env["FC_RUNS"] } };
  const file = (...p) => join(out, ...p);
  if (existsSync(file("vitest-results.json"))) input.vitest = readJson(file("vitest-results.json"));
  if (existsSync(file("check-report.json"))) input.checkReport = readJson(file("check-report.json"));
  const dir = (...p) => (existsSync(file(...p)) ? readdirSync(file(...p)).sort() : []);
  input.coverage = dir("coverage").filter((f) => f.endsWith(".json")).map((f) => readJson(file("coverage", f)));
  input.scenarios = dir("scenarios").filter((f) => f.endsWith(".json")).map((f) => readJson(file("scenarios", f)));
  const mutationFiles = dir("mutation").filter((f) => f.endsWith(".json")).map((f) => file("mutation", f));
  if (mutationFiles.length > 0 && input.notes.mutation !== false) input.mutation = summarizeMutation(mutationFiles);
  if (existsSync(file("seeds.jsonl"))) {
    input.seeds = readFileSync(file("seeds.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }
  return input;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const notes = get("--notes");
  if (notes === undefined) {
    console.error("usage: node tools/report/generate.mjs --notes <notes.json> [--out <report.md>]");
    process.exit(2);
  }
  const text = generateReport(collectInputs(root, resolve(notes)));
  const target = get("--out");
  if (target === undefined) process.stdout.write(text);
  else {
    writeFileSync(resolve(target), text);
    console.log(`report written to ${target}`);
  }
}
