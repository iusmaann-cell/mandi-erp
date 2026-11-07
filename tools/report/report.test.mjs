import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectInputs, generateReport, summarizeVitest } from "./generate.mjs";

const NOTES = {
  workPackage: "BC-99",
  title: "A test package",
  chat: "C9",
  date: "2026-12-01",
  commit: "abc1234",
  built: ["the thing", "the other thing"],
  tests: [{ level: "unit and property", what: "the thing", count: 12 }],
  decisions: ["X-99: a decision"],
  defects: ["a bug that was fixed"],
  notApplicable: [{ item: "permission rows", reason: "no commands yet" }],
  risks: ["a risk"],
};
const vitest = (files) => ({ testResults: files.map(([name, statuses]) => ({ name, assertionResults: statuses.map((status, i) => ({ status, title: `t${i}`, fullName: `suite t${i}` })) })) });
const RESULTS = vitest([
  ["/repo/packages/numeric/src/a.test.ts", ["passed", "passed", "passed"]],
  ["/repo/packages/sync/src/b.test.ts", ["passed", "failed", "skipped"]],
  ["C:\\repo\\packages\\data\\src\\c.test.ts", ["passed"]],
  ["/repo/tools/ci/d.test.mjs", ["passed", "passed"]],
]);

describe("summarizeVitest", () => {
  it("counts per project from the file path, on Linux and Windows paths, and names the failures", () => {
    const s = summarizeVitest(RESULTS);
    expect(s.rows).toEqual([
      { project: "data", passed: 1, failed: 0, skipped: 0 },
      { project: "numeric", passed: 3, failed: 0, skipped: 0 },
      { project: "sync", passed: 1, failed: 1, skipped: 1 },
      { project: "tools", passed: 2, failed: 0, skipped: 0 },
    ]);
    expect([s.passed, s.failed, s.skipped]).toEqual([7, 1, 1]);
    expect(s.failedNames).toEqual(["sync: suite t1"]);
  });
  it("copes with an empty report", () => {
    expect(summarizeVitest({})).toEqual({ rows: [], passed: 0, failed: 0, skipped: 0, failedNames: [] });
  });
});

describe("generateReport (document 09, 15.2)", () => {
  const input = {
    notes: NOTES,
    vitest: RESULTS,
    checkReport: { platform: "linux", node: "v22.16.0", totalSeconds: 190, results: [{ step: "typecheck", status: "passed", seconds: 30 }, { step: "test", status: "passed", seconds: 120 }] },
    coverage: [
      { package: "numeric", statements: 99.47, branches: 92.09, functions: 100, lines: 99.69 },
      { package: "core", statements: 96, branches: 88.5, functions: 100, lines: 97 },
      { package: "sync", statements: 82.1, branches: 60, functions: 90, lines: 85 },
      { package: "data", statements: 79.9, branches: 91, functions: 90, lines: 85 },
    ],
    mutation: { score: 98, killed: 98, counted: 100, rows: [{ file: "packages/numeric/src/round.ts", killed: 25, survived: 3, noCoverage: 0, score: 89.29 }] },
    scenarios: [{ scenario: "WE-1 two purchases and a FIFO sale", driver: "stub engine", dataSet: "DS-1", dataFingerprint: "0123456789abcdef", seed: "ds-1", steps: [{}, {}, {}], passed: true, checks: [{ id: "I-1", status: "pass" }, { id: "I-2", status: "not_applicable", detail: "no manual journals" }] }],
    seeds: [{ kind: "scenario", seed: "ds-1", note: "WE-1 | DS-1" }],
    env: { FC_SEED: "42", FC_RUNS: "500" },
  };
  const text = generateReport(input);

  it("has every part of the report of 15.2, in order", () => {
    const heads = ["# Test report: BC-99 A test package", "**Built.**", "**Tests added, by level", "**Result of the full run.**", "**Scenario runs (TR-7).**", "**Seeds (TS-8).**", "**Coverage against document 09, section 5.6.**", "**Mutation score", "**Performance figures", "**Defects found", "**Decisions made.**", "**Permission rows added.**", "**Not applicable, with reason.**", "**Open risks.**"];
    let at = -1;
    for (const h of heads) {
      const i = text.indexOf(h);
      expect(i, h).toBeGreaterThan(at);
      at = i;
    }
  });

  it("states the run's own figures: counts per project, totals, the failed test, the pipeline time", () => {
    expect(text).toContain("| sync | 1 | 1 | 1 |");
    expect(text).toContain("| **Total** | **7** | **1** | **1** |");
    expect(text).toContain("- sync: suite t1");
    expect(text).toContain("total 190 s of the 900 s budget");
    expect(text).toContain("Chat C9, 2026-12-01. Commit `abc1234`.");
  });

  it("judges coverage by section 5.6: engine and numeric packages 95% and 90%, the others 80% statements", () => {
    expect(text).toContain("| numeric | 99.47% | 92.09% | 100.00% | 99.69% | 95% statements, 90% branches | meets |");
    expect(text).toContain("| core | 96.00% | 88.50% | 100.00% | 97.00% | 95% statements, 90% branches | BELOW TARGET |");
    expect(text).toContain("| sync | 82.10% | 60.00% | 90.00% | 85.00% | 80% statements | meets |");
    expect(text).toContain("| data | 79.90% | 91.00% | 90.00% | 85.00% | 80% statements | BELOW TARGET |");
  });

  it("reports the mutation score against 85%, scenarios with their data fingerprint and seed, and the checks that could not be made and why", () => {
    expect(text).toContain("98.00% killed (98 of 100 mutants): meets the target.");
    expect(text).toContain("| packages/numeric/src/round.ts | 25 | 3 | 0 | 89.3% |");
    expect(generateReport({ ...input, mutation: { ...input.mutation, score: 80 } })).toContain("BELOW the target");
    expect(text).toContain("| WE-1 two purchases and a FIFO sale | stub engine | DS-1 (0123456789abcdef) | ds-1 | 3 | 1 / 0 / 1 | pass |");
    expect(text).toContain("I-2 (no manual journals)");
    expect(text).toContain("Property tests: seed 42, 500 runs");
    expect(text).toContain("| scenario | ds-1 | WE-1 \\| DS-1 |"); // a pipe in a note cannot break the table
  });

  it("carries the narrative of the notes, and 'none' where there is none", () => {
    expect(text).toContain("- the thing\n- the other thing");
    expect(text).toContain("| unit and property | the thing | 12 |");
    expect(text).toContain("- permission rows: no commands yet");
    expect(text).toContain("**Permission rows added.**\n- none");
    expect(text).toContain("no simulator exists yet (BC-08)");
  });

  it("says so plainly when a part is missing, and never invents figures", () => {
    const bare = generateReport({ notes: { workPackage: "BC-0", title: "x" } });
    expect(bare).toContain("No test results file was found");
    expect(bare).toContain("No coverage was measured");
    expect(bare).toContain("No scenario files were run.");
    expect(bare).toContain("No seeds were recorded");
    expect(bare).toContain("Not applicable to this work package, or not run.");
    expect(bare).toContain("date not given");
    expect(bare).toContain("(nothing listed)");
  });

  it("flags a failing scenario, and is a pure function of its input (the same run gives the same report)", () => {
    const failing = generateReport({ ...input, scenarios: [{ ...input.scenarios[0], passed: false }] });
    expect(failing).toContain("| FAIL |");
    expect(generateReport(input)).toBe(text);
  });

  it("lists known failures with their defect numbers", () => {
    expect(generateReport({ ...input, notes: { ...NOTES, knownFailures: ["D-12: flaky on Windows"] } })).toContain("- D-12: flaky on Windows");
  });
});

describe("collectInputs reads the files a run wrote", () => {
  const roots = [];
  afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });
  const make = () => {
    const root = mkdtempSync(join(tmpdir(), "mandi-report-"));
    roots.push(root);
    mkdirSync(join(root, "build-output", "coverage"), { recursive: true });
    mkdirSync(join(root, "build-output", "scenarios"), { recursive: true });
    writeFileSync(join(root, "notes.json"), JSON.stringify(NOTES));
    return root;
  };

  it("gathers results, check report, coverage, scenarios and seeds", () => {
    const root = make();
    const out = join(root, "build-output");
    writeFileSync(join(out, "vitest-results.json"), JSON.stringify(RESULTS));
    writeFileSync(join(out, "check-report.json"), JSON.stringify({ platform: "linux", node: "v22", totalSeconds: 1, results: [] }));
    writeFileSync(join(out, "coverage", "numeric.json"), JSON.stringify({ package: "numeric", statements: 99, branches: 95, functions: 100, lines: 99 }));
    writeFileSync(join(out, "scenarios", "we-1--stub.json"), JSON.stringify({ scenario: "WE-1", driver: "stub", dataSet: "DS-1", dataFingerprint: "f", seed: "s", steps: [], checks: [], passed: true }));
    writeFileSync(join(out, "seeds.jsonl"), `${JSON.stringify({ kind: "k", seed: "1" })}\n${JSON.stringify({ kind: "k", seed: "2" })}\n`);
    const input = collectInputs(root, join(root, "notes.json"));
    expect(input.vitest).toEqual(RESULTS);
    expect(input.coverage).toEqual([{ package: "numeric", statements: 99, branches: 95, functions: 100, lines: 99 }]);
    expect(input.scenarios).toHaveLength(1);
    expect(input.seeds).toEqual([{ kind: "k", seed: "1" }, { kind: "k", seed: "2" }]);
    expect(input.mutation).toBeUndefined();
    expect(generateReport(input)).toContain("| numeric | 99.00% |");
  });

  it("a folder with nothing in it gives a report that says nothing was found", () => {
    const root = mkdtempSync(join(tmpdir(), "mandi-report-"));
    roots.push(root);
    writeFileSync(join(root, "notes.json"), JSON.stringify(NOTES));
    const input = collectInputs(root, join(root, "notes.json"));
    expect(input.vitest).toBeUndefined();
    expect(input.coverage).toEqual([]);
    expect(generateReport(input)).toContain("No test results file was found");
  });
});
