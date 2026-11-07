import { readFileSync } from "node:fs";

/**
 * The mutation score of Stryker JSON reports (document 09, section 5.5). The score is killed plus timed
 * out over every mutant that was run or not covered. Reports of slices of one file (line ranges) are
 * merged by mutant position; a later report wins for the same mutant.
 */
const mutantKey = (m) => `${m.location.start.line}:${m.location.start.column}-${m.location.end.line}:${m.location.end.column}:${m.mutatorName}:${m.replacement ?? ""}`;

export function summarizeMutation(reportFiles) {
  const perFile = new Map();
  for (const report of reportFiles) {
    const data = JSON.parse(readFileSync(report, "utf8"));
    for (const [file, info] of Object.entries(data.files)) {
      const merged = new Map((perFile.get(file)?.info.mutants ?? []).map((m) => [mutantKey(m), m]));
      for (const m of info.mutants) merged.set(mutantKey(m), m);
      perFile.set(file, { info: { ...info, mutants: [...merged.values()] } });
    }
  }
  const rows = [];
  let killed = 0;
  let counted = 0;
  for (const [file, { info }] of [...perFile].sort()) {
    const count = (s) => info.mutants.filter((m) => m.status === s).length;
    const k = count("Killed") + count("Timeout");
    const total = k + count("Survived") + count("NoCoverage");
    killed += k;
    counted += total;
    rows.push({ file: file.replace(/^.*packages\//, "packages/"), killed: k, survived: count("Survived"), noCoverage: count("NoCoverage"), total, score: total === 0 ? 100 : (k * 100) / total, source: info.source, mutants: info.mutants });
  }
  return { rows, killed, counted, score: counted === 0 ? 100 : (killed * 100) / counted };
}
