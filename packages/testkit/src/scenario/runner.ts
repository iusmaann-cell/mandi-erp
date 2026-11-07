import type { DataSet } from "../world/dataset";
import { fingerprint } from "../world/export";
import { compareExpected } from "./compare";
import type { CheckResult, Mismatch, Scenario, ScenarioDriver, ScenarioResult, StepResult } from "./types";

/**
 * The scenario runner (TR-7). One runner reads the scenario of document 09, section 7.1 and drives any
 * engine through `ScenarioDriver`: the real engine, the reference model and, for the screens that matter,
 * the acceptance runner. After the last step it ALWAYS runs the books integrity checks, even if a step
 * failed, and the scenario passes only if every step succeeded, every expected value matched and no
 * check failed. A check the engine cannot make is reported as "not_applicable" with its reason, never
 * silently passed.
 */
export async function runScenario(scenario: Scenario, dataSet: DataSet, driver: ScenarioDriver): Promise<ScenarioResult> {
  await driver.load(dataSet);
  const steps: StepResult[] = [];
  let failed = false;
  for (const [index, step] of scenario.steps.entries()) {
    if (failed) break;
    try {
      const outcome = await driver.execute(step, index);
      steps.push({ index, command: step.command, line: step.line, ok: outcome.ok, ...(outcome.detail === undefined ? {} : { detail: outcome.detail }), ...(outcome.documentNo === undefined ? {} : { documentNo: outcome.documentNo }) });
      if (!outcome.ok) failed = true;
    } catch (error) {
      steps.push({ index, command: step.command, line: step.line, ok: false, detail: `the engine failed: ${error instanceof Error ? error.message : "unknown error"}` });
      failed = true;
    }
  }

  const { integrity, ...expected } = scenario.expect;
  let mismatches: Mismatch[] = [];
  if (!failed) {
    const observation = await driver.observe();
    mismatches = Object.entries(expected).flatMap(([key, value]) => compareExpected(value, observation[key], `expect.${key}`));
  }

  const checks: readonly CheckResult[] = await driver.finalChecks();
  const checkFailed = checks.some((c) => c.status === "fail");
  if (integrity !== undefined && integrity !== "all_pass") {
    // a list of check ids that must pass
    const wanted = Array.isArray(integrity) ? (integrity as readonly string[]) : [];
    for (const id of wanted) {
      const found = checks.find((c) => c.id === id);
      if (found === undefined || found.status === "fail") mismatches = [...mismatches, { path: `expect.integrity.${id}`, expected: "pass", actual: found === undefined ? "(not run)" : "fail" }];
      else if (found.status === "not_applicable") mismatches = [...mismatches, { path: `expect.integrity.${id}`, expected: "pass", actual: "not applicable to this engine" }];
    }
  } else if (integrity === undefined) {
    mismatches = [...mismatches, { path: "expect.integrity", expected: "all_pass", actual: "(the scenario does not say; every scenario ends with the integrity checks)" }];
  }

  return {
    scenario: scenario.name,
    driver: driver.name,
    dataSet: dataSet.id,
    seed: scenario.seed ?? dataSet.seed,
    dataFingerprint: fingerprint(dataSet),
    steps,
    mismatches,
    checks,
    passed: !failed && mismatches.length === 0 && !checkFailed,
  };
}
