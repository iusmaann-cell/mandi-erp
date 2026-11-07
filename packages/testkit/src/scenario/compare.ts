import { formatScaled, parseScaled } from "@mandi/numeric";
import type { ExpectValue, Mismatch, Observed } from "./types";

/** The field that names a row when expected rows are matched to observed rows. */
const ROW_KEYS = ["no", "code", "id", "account", "name"] as const;

const show = (d: { value: bigint; scale: number }): string => formatScaled(d.value, { scale: d.scale, grouping: "million" });

function isDecimal(o: Observed): o is { kind: "decimal"; value: bigint; scale: number } {
  return typeof o === "object" && !Array.isArray(o) && (o as { kind?: unknown }).kind === "decimal";
}
const isRecord = (o: unknown): o is Record<string, Observed> => typeof o === "object" && o !== null && !Array.isArray(o) && (o as { kind?: unknown }).kind !== "decimal";

/**
 * Expected results against what an engine reported. Expected values are text: against a number they are
 * read at the number's own scale (so "525000.00" equals 52500000 paisa and "525000.001" is refused, not
 * rounded), against text they must be equal. Expected rows are matched by `no`, `code`, `id`, `account`
 * or `name`; fields and rows the scenario does not mention are not compared. Everything that differs is returned.
 */
export function compareExpected(expected: ExpectValue, observed: Observed | undefined, path = "expect"): Mismatch[] {
  if (observed === undefined) return [{ path, expected: describe(expected), actual: "(nothing reported)" }];
  if (typeof expected === "string") {
    if (isDecimal(observed)) {
      const read = parseScaled(expected, { scale: observed.scale, allowNegative: true });
      if (!read.ok) return [{ path, expected, actual: `${show(observed)} (expected value is not a number with at most ${String(observed.scale)} decimals: ${read.code})` }];
      return read.value === observed.value ? [] : [{ path, expected, actual: show(observed) }];
    }
    return typeof observed === "string" && observed === expected ? [] : [{ path, expected, actual: describe(observed) }];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(observed)) return [{ path, expected: "a list", actual: describe(observed) }];
    const out: Mismatch[] = [];
    (expected as readonly ExpectValue[]).forEach((row, i) => {
      const key = typeof row === "object" && !Array.isArray(row) ? ROW_KEYS.find((k) => typeof (row as Record<string, ExpectValue>)[k] === "string") : undefined;
      if (key === undefined) {
        out.push(...compareExpected(row, (observed as readonly Observed[])[i], `${path}[${String(i)}]`));
        return;
      }
      const wanted = (row as Record<string, string>)[key];
      const found = (observed as readonly Observed[]).find((o) => isRecord(o) && o[key] === wanted);
      if (found === undefined) out.push({ path: `${path}[${key}=${String(wanted)}]`, expected: "a row", actual: "(no such row)" });
      else out.push(...compareExpected(row, found, `${path}[${key}=${String(wanted)}]`));
    });
    return out;
  }
  if (!isRecord(observed)) return [{ path, expected: "a table of values", actual: describe(observed) }];
  const out: Mismatch[] = [];
  for (const [key, value] of Object.entries(expected)) out.push(...compareExpected(value, observed[key], `${path}.${key}`));
  return out;
}

function describe(v: ExpectValue | Observed): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return `a list of ${String(v.length)}`;
  if (isDecimal(v)) return show(v);
  return `a table (${Object.keys(v).join(", ")})`;
}
