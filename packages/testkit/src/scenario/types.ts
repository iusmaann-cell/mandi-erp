import type { DataSet, DataSetId } from "../world/dataset";

/**
 * The scenario file of document 09, section 7.1: the starting data set, a list of commands in order, and
 * the expected results written as tables. Every value in the file is text: a number is written exactly as
 * a person would write it ("525000.00") and read with the numeric module at the scale of what it is
 * compared with, so a scenario can never contain a floating-point number.
 */
export type ParamValue = string | readonly ParamValue[] | { readonly [key: string]: ParamValue };
export interface Step {
  /** For example "post purchase_receipt". */
  readonly command: string;
  readonly params: Readonly<Record<string, ParamValue>>;
  /** 1-based line of the step in the file, for messages. */
  readonly line: number;
}
export type ExpectValue = string | readonly ExpectValue[] | { readonly [key: string]: ExpectValue };
export interface Scenario {
  readonly name: string;
  readonly data: DataSetId;
  /** Overrides the data set's seed. */
  readonly seed?: string;
  readonly steps: readonly Step[];
  readonly expect: { readonly [key: string]: ExpectValue };
}

/** A whole number with a scale, as an engine reports money (scale 2), quantity (3), unit cost (6) and so on. */
export interface Decimal {
  readonly kind: "decimal";
  readonly value: bigint;
  readonly scale: number;
}
export type Observed = string | Decimal | readonly Observed[] | { readonly [key: string]: Observed };
export type Observation = { readonly [key: string]: Observed };

export interface StepOutcome {
  readonly ok: boolean;
  readonly detail?: string;
  readonly documentNo?: string;
}
export type CheckStatus = "pass" | "fail" | "not_applicable";
export interface CheckResult {
  readonly id: string;
  readonly name: string;
  readonly status: CheckStatus;
  /** For a failure what is wrong; for "not_applicable" why. */
  readonly detail?: string;
}

/** What the runner needs from an engine: the real one, the reference model, a stub, and later the screens. */
export interface ScenarioDriver {
  readonly name: string;
  load(dataSet: DataSet): Promise<void>;
  execute(step: Step, index: number): Promise<StepOutcome>;
  observe(): Promise<Observation>;
  /** The books integrity checks of document 06, section 10 (I-1 to I-18). */
  finalChecks(): Promise<readonly CheckResult[]>;
}

export interface Mismatch {
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
}
export interface StepResult {
  readonly index: number;
  readonly command: string;
  readonly line: number;
  readonly ok: boolean;
  readonly detail?: string;
  readonly documentNo?: string;
}
export interface ScenarioResult {
  readonly scenario: string;
  readonly driver: string;
  readonly dataSet: DataSetId;
  readonly seed: string;
  /** Fingerprint of the data set used, so a result says exactly which data it ran on. */
  readonly dataFingerprint: string;
  readonly steps: readonly StepResult[];
  readonly mismatches: readonly Mismatch[];
  readonly checks: readonly CheckResult[];
  readonly passed: boolean;
}
