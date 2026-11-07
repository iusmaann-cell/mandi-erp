import { LineCounter, parseDocument, type Node, isMap, isScalar, isSeq } from "yaml";
import type { ExpectValue, ParamValue, Scenario, Step } from "./types";

export class ScenarioError extends Error {
  readonly line: number | undefined;
  constructor(message: string, line?: number) {
    super(line === undefined ? message : `line ${String(line)}: ${message}`);
    this.name = "ScenarioError";
    this.line = line;
  }
}

const TOP_KEYS = new Set(["scenario", "data", "seed", "steps", "expect"]);
/** The verb of a step is the one key that names what to do; the rest are its inputs. */
const VERBS = new Set(["post", "reverse", "create", "change", "advance", "set"]);
const DATA_SETS = new Set(["DS-1", "DS-2"]);

function toValue(node: unknown, where: string, line: (n: Node) => number | undefined): ParamValue {
  const n = node as Node | null;
  if (isScalar(n)) {
    if (typeof n.value !== "string") throw new ScenarioError(`${where}: values must be text`, line(n));
    if (n.value === "") throw new ScenarioError(`${where}: a value is missing`, line(n)); // a blank input is almost certainly a mistake
    return n.value;
  }
  if (isSeq(n)) return n.items.map((item, i) => toValue(item, `${where}[${String(i)}]`, line));
  if (isMap(n)) {
    const out: Record<string, ParamValue> = {};
    for (const pair of n.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      if (key === "") throw new ScenarioError(`${where}: a key is missing`, line(n));
      out[key] = toValue(pair.value, `${where}.${key}`, line);
    }
    return out;
  }
  throw new ScenarioError(`${where}: a value is missing`, n === null ? undefined : line(n));
}

/**
 * Reads a scenario file. All scalars are kept as text (YAML's own number reading is switched off), the
 * file must hold exactly the parts of section 7.1, and every problem is reported with its line.
 */
export function parseScenario(text: string): Scenario {
  const counter = new LineCounter();
  const doc = parseDocument(text, { schema: "failsafe", lineCounter: counter, uniqueKeys: true });
  const lineOf = (n: Node): number | undefined => {
    const offset = n.range?.[0];
    return offset === undefined ? undefined : counter.linePos(offset).line;
  };
  const firstError = doc.errors[0];
  if (firstError !== undefined) throw new ScenarioError(firstError.message.split("\n")[0] ?? "not a valid file", firstError.linePos?.[0].line);
  if (!isMap(doc.contents)) throw new ScenarioError("a scenario file is a set of named parts: scenario, data, steps, expect");

  const parts = new Map<string, Node | null>();
  for (const pair of doc.contents.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : "";
    if (!TOP_KEYS.has(key)) throw new ScenarioError(`unknown part "${key}" (a scenario has: ${[...TOP_KEYS].join(", ")})`, lineOf(pair.key));
    parts.set(key, pair.value);
  }
  const scalar = (key: string): string | undefined => {
    const n = parts.get(key);
    if (n === undefined) return undefined;
    if (!isScalar(n) || typeof n.value !== "string" || n.value === "") throw new ScenarioError(`"${key}" must be text`, n === null ? undefined : lineOf(n));
    return n.value;
  };

  const name = scalar("scenario");
  if (name === undefined) throw new ScenarioError('a scenario needs a "scenario" name');
  const data = scalar("data");
  if (data === undefined) throw new ScenarioError('a scenario needs "data" (the starting data set)');
  if (!DATA_SETS.has(data)) throw new ScenarioError(`unknown data set "${data}" (DS-1 or DS-2)`, lineOf(parts.get("data") as Node));
  const seed = scalar("seed");

  const stepsNode = parts.get("steps");
  if (stepsNode === undefined || !isSeq(stepsNode) || stepsNode.items.length === 0) throw new ScenarioError('"steps" must be a list with at least one step');
  const steps: Step[] = stepsNode.items.map((item, i) => {
    const line = lineOf(item as Node) ?? 0;
    if (!isMap(item)) throw new ScenarioError(`step ${String(i + 1)} must be a set of named inputs, for example "post: purchase_receipt"`, line);
    const params: Record<string, ParamValue> = {};
    let command: string | undefined;
    for (const pair of item.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      if (VERBS.has(key)) {
        if (command !== undefined) throw new ScenarioError(`step ${String(i + 1)} has two verbs`, line);
        const what = pair.value;
        if (!isScalar(what) || typeof what.value !== "string" || what.value === "") throw new ScenarioError(`step ${String(i + 1)}: "${key}" must name what is ${key}ed`, line);
        command = `${key} ${what.value}`;
      } else {
        params[key] = toValue(pair.value, `step ${String(i + 1)}.${key}`, lineOf);
      }
    }
    if (command === undefined) throw new ScenarioError(`step ${String(i + 1)} has no verb (one of: ${[...VERBS].join(", ")})`, line);
    return { command, params, line };
  });

  const expectNode = parts.get("expect");
  if (expectNode === undefined || !isMap(expectNode)) throw new ScenarioError('a scenario needs "expect" (the expected results)');
  const expectValue = toValue(expectNode, "expect", lineOf) as { readonly [key: string]: ExpectValue };

  return { name, data: data as Scenario["data"], ...(seed === undefined ? {} : { seed }), steps, expect: expectValue };
}
