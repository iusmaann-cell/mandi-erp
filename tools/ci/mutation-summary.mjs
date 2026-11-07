import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Combines Stryker JSON reports (build-output/mutation/*.json, one per slice or one for the whole run)
 * into one score per file and in total, and lists surviving mutants with their source line.
 *   node tools/ci/mutation-summary.mjs [--survivors] [--break 85] [report.json ...]
 * The score is killed + timed out, over all mutants that were run or not covered (document 09, 5.5).
 * When a file appears in several reports (slices of one file), their mutants are merged by position (mutation-core.mjs).
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const showSurvivors = args.includes("--survivors");
const breakAt = args.includes("--break") ? Number(args[args.indexOf("--break") + 1]) : 85;
const explicit = args.filter((a, i) => a.endsWith(".json") && args[i - 1] !== "--break");
const dir = join(root, "build-output", "mutation");
const reports = explicit.length > 0 ? explicit : readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => join(dir, f));

import { summarizeMutation } from "./mutation-core.mjs";

const summary = summarizeMutation(reports);
const rows = summary.rows;
const perFile = new Map(summary.rows.map((r) => [r.file, { info: { source: r.source, mutants: r.mutants } }]));
const killed = summary.killed;
const counted = summary.counted;
for (const r of rows) console.log(`${r.file.padEnd(40)} killed ${String(r.killed).padStart(4)}  survived ${String(r.survived).padStart(3)}  uncovered ${String(r.noCoverage).padStart(3)}  score ${r.score.toFixed(1).padStart(5)}%`);
const score = summary.score;
console.log(`${"TOTAL".padEnd(40)} killed ${String(killed).padStart(4)}  of ${counted}  score ${score.toFixed(2)}%  (target ${breakAt}%)`);

if (showSurvivors) {
  for (const [file, { info }] of [...perFile].sort()) {
    const lines = info.source.split("\n");
    for (const m of info.mutants.filter((x) => x.status === "Survived" || x.status === "NoCoverage")) {
      const at = m.location.start;
      console.log(`${m.status === "NoCoverage" ? "UNCOVERED" : "SURVIVED "} ${file.replace(/^.*packages\//, "")}:${at.line}:${at.column} ${m.mutatorName} -> ${JSON.stringify(m.replacement ?? "").slice(0, 50)}\n          ${(lines[at.line - 1] ?? "").trim().slice(0, 110)}`);
    }
  }
}
process.exit(score >= breakAt ? 0 : 1);
