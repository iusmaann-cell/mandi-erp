import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScenarioResult } from "./scenario/types";

/**
 * Where a run leaves what the test report generator (TR-12) reads. Both functions do nothing unless
 * MANDI_RESULTS_DIR names a folder (`npm run check` sets it to build-output), so an ordinary test run
 * writes no files. Seeds are printed with every result (TS-8): a failure can be replayed from its seed.
 */
const dir = (): string | undefined => process.env["MANDI_RESULTS_DIR"];

export function registerSeed(kind: string, seed: string, note?: string): void {
  const target = dir();
  if (target === undefined) return;
  mkdirSync(target, { recursive: true });
  appendFileSync(join(target, "seeds.jsonl"), `${JSON.stringify({ kind, seed, ...(note === undefined ? {} : { note }) })}\n`);
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function writeScenarioResult(result: ScenarioResult): void {
  const target = dir();
  if (target === undefined) return;
  mkdirSync(join(target, "scenarios"), { recursive: true });
  writeFileSync(join(target, "scenarios", `${slug(result.scenario)}--${slug(result.driver)}.json`), `${JSON.stringify(result, null, 2)}\n`);
}
