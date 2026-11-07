import { describe, expect, it } from "vitest";
import { buildDataSet } from "../world/build";
import type { DataSet } from "../world/dataset";
import { compareExpected } from "./compare";
import { parseScenario, ScenarioError } from "./parse";
import { runScenario } from "./runner";
import type { CheckResult, Decimal, Observation, ScenarioDriver, Step, StepOutcome } from "./types";

const dec = (value: bigint, scale = 2): Decimal => ({ kind: "decimal", value, scale });

const GOOD = `
# a comment
scenario: tiny
data: DS-1
steps:
  - post: purchase_receipt   # inputs follow
    item: RICE-BAS
    qty_kg: "10000"
    freight: { payee: CAR-FAST, amount: "20000" }
expect:
  accounts: { INVENTORY: "525000.00" }
  integrity: all_pass
`;

describe("parseScenario (document 09, section 7.1)", () => {
  it("reads the parts, keeps every value as text, and keeps nested inputs", () => {
    const s = parseScenario(GOOD);
    expect(s).toMatchObject({ name: "tiny", data: "DS-1" });
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0]).toMatchObject({ command: "post purchase_receipt", params: { item: "RICE-BAS", qty_kg: "10000", freight: { payee: "CAR-FAST", amount: "20000" } }, line: 6 });
    expect(s.expect).toEqual({ accounts: { INVENTORY: "525000.00" }, integrity: "all_pass" });
  });

  it("never turns a number into a float: 525000.00, 007 and 1e3 stay exactly as written", () => {
    const s = parseScenario("scenario: n\ndata: DS-1\nsteps:\n  - post: x\n    a: 525000.00\n    b: 007\n    c: 1e3\nexpect: { integrity: all_pass }\n");
    expect(s.steps[0]?.params).toEqual({ a: "525000.00", b: "007", c: "1e3" });
  });

  it("takes an optional seed", () => {
    expect(parseScenario(GOOD.replace("data: DS-1", "data: DS-2\nseed: my-seed")).seed).toBe("my-seed");
  });

  const bad = (text: string, message: RegExp, line?: number) => {
    try {
      parseScenario(text);
      expect.unreachable("should have been refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ScenarioError);
      expect((e as ScenarioError).message).toMatch(message);
      if (line !== undefined) expect((e as ScenarioError).line).toBe(line);
    }
  };

  it.each<[string, string, RegExp, number?]>([
    ["an unknown part", GOOD.replace("expect:", "surprise: 1\nexpect:"), /unknown part "surprise"/, 10],
    ["no name", GOOD.replace("scenario: tiny\n", ""), /needs a "scenario" name/],
    ["no data set", GOOD.replace("data: DS-1\n", ""), /needs "data"/],
    ["an unknown data set", GOOD.replace("DS-1", "DS-9"), /unknown data set "DS-9"/, 4],
    ["no steps", GOOD.replace(/steps:[\s\S]*expect:/, "steps: []\nexpect:"), /at least one step/],
    ["no expect", GOOD.replace(/expect:[\s\S]*$/, ""), /needs "expect"/],
    ["a step without a verb", "scenario: a\ndata: DS-1\nsteps:\n  - item: X\n    qty: \"1\"\nexpect: {}\n", /has no verb/, 4],
    ["a step with two verbs", GOOD.replace("- post: purchase_receipt", "- post: a\n    reverse: b"), /two verbs/, 6],
    ["a step that is not a set of inputs", GOOD.replace("- post: purchase_receipt   # inputs follow\n    item: RICE-BAS\n    qty_kg: \"10000\"\n    freight: { payee: CAR-FAST, amount: \"20000\" }", "- just text"), /set of named inputs/, 6],
    ["a repeated key", "scenario: a\nscenario: b\ndata: DS-1\nsteps:\n  - post: x\nexpect: {}\n", /unique|duplicate|twice/i],
    ["a file that is not a set of parts", "- a\n- b\n", /set of named parts/],
    ["broken syntax", "scenario: [unclosed\n", /./],
  ])("refuses %s, with its line where it has one", (_name, text, message, line) => {
    bad(text, message, line);
  });

  it("refuses an empty verb target and a missing value", () => {
    bad("scenario: a\ndata: DS-1\nsteps:\n  - post:\nexpect: {}\n", /must name what is posted/);
    bad("scenario: a\ndata: DS-1\nsteps:\n  - post: x\n    qty:\nexpect: {}\n", /a value is missing/);
  });
});

describe("compareExpected: expected tables against what an engine reports", () => {
  it("a number is read at the scale of what it is compared with, and equal means equal", () => {
    expect(compareExpected("525000.00", dec(52_500_000n))).toEqual([]);
    expect(compareExpected("525000", dec(52_500_000n))).toEqual([]);
    expect(compareExpected("2500", dec(2_500_000n, 3))).toEqual([]);
    expect(compareExpected("202.000000", dec(202_000_000n, 6))).toEqual([]);
    expect(compareExpected("-12.50", dec(-1250n))).toEqual([]);
  });

  it("different numbers are reported with both values, written readably", () => {
    expect(compareExpected("525000.01", dec(52_500_000n), "expect.accounts.INVENTORY")).toEqual([{ path: "expect.accounts.INVENTORY", expected: "525000.01", actual: "525,000.00" }]);
  });

  it("a number with more decimals than the thing has is refused, never rounded to match", () => {
    const [m] = compareExpected("525000.001", dec(52_500_000n));
    expect(m?.actual).toMatch(/too-many-decimals/);
    expect(compareExpected("abc", dec(1n))[0]?.actual).toMatch(/invalid-character/);
  });

  it("text must be equal; a missing value, a list where a value was expected and a table where text was expected are reported", () => {
    expect(compareExpected("purchase_receipt", "purchase_receipt")).toEqual([]);
    expect(compareExpected("a", "b")).toEqual([{ path: "expect", expected: "a", actual: "b" }]);
    expect(compareExpected("a", undefined, "expect.x")).toEqual([{ path: "expect.x", expected: "a", actual: "(nothing reported)" }]);
    expect(compareExpected("a", [])[0]?.actual).toBe("a list of 0");
    expect(compareExpected("a", { k: "v" })[0]?.actual).toBe("a table (k)");
  });

  it("tables: every expected key must be reported; extra reported keys are not compared", () => {
    const observed = { a: dec(100n), b: dec(200n), extra: dec(1n) };
    expect(compareExpected({ a: "1.00", b: "2.00" }, observed)).toEqual([]);
    expect(compareExpected({ a: "1.00", c: "3" }, observed)).toEqual([{ path: "expect.c", expected: "3", actual: "(nothing reported)" }]);
    expect(compareExpected({ a: "1.00" }, "text")[0]?.expected).toBe("a table of values");
  });

  it("rows are matched by no, code, id, account or name, not by position, and unmentioned fields and rows are ignored", () => {
    const observed = [
      { no: "B2", remaining_kg: dec(2_500_000n, 3), value: dec(52_500_000n) },
      { no: "B1", remaining_kg: dec(0n, 3), value: dec(0n) },
      { no: "B3", remaining_kg: dec(1n, 3) },
    ];
    expect(compareExpected([{ no: "B1", remaining_kg: "0" }, { no: "B2", value: "525000.00" }], observed)).toEqual([]);
    const wrong = compareExpected([{ no: "B2", value: "525000.01" }, { no: "B9", value: "1" }], observed, "expect.batches");
    expect(wrong).toEqual([
      { path: "expect.batches[no=B2].value", expected: "525000.01", actual: "525,000.00" },
      { path: "expect.batches[no=B9]", expected: "a row", actual: "(no such row)" },
    ]);
    expect(compareExpected([{ code: "X", v: "1" }], [{ code: "X", v: dec(100n) }])).toEqual([]);
  });

  it("a list of plain values, and rows with no key, are matched by position", () => {
    expect(compareExpected(["a", "b"], ["a", "b"])).toEqual([]);
    expect(compareExpected(["a", "c"], ["a", "b"])).toEqual([{ path: "expect[1]", expected: "c", actual: "b" }]);
    expect(compareExpected([{ x: "1.00" }], [{ x: dec(100n) }])).toEqual([]);
    expect(compareExpected(["a"], "not a list")[0]?.expected).toBe("a list");
  });
});

class FakeDriver implements ScenarioDriver {
  readonly name = "fake";
  readonly calls: string[] = [];
  constructor(
    private readonly observation: Observation,
    private readonly checks: readonly CheckResult[],
    private readonly failAt = -1,
    private readonly throwAt = -1,
  ) {}
  load(_: DataSet): Promise<void> {
    this.calls.push("load");
    return Promise.resolve();
  }
  execute(_step: Step, index: number): Promise<StepOutcome> {
    this.calls.push(`execute ${String(index)}`);
    if (index === this.throwAt) return Promise.reject(new Error("the engine exploded"));
    return Promise.resolve(index === this.failAt ? { ok: false, detail: "refused" } : { ok: true, documentNo: `DOC-${String(index)}` });
  }
  observe(): Promise<Observation> {
    this.calls.push("observe");
    return Promise.resolve(this.observation);
  }
  finalChecks(): Promise<readonly CheckResult[]> {
    this.calls.push("checks");
    return Promise.resolve(this.checks);
  }
}

const THREE = parseScenario("scenario: three\ndata: DS-1\nsteps:\n  - post: a\n  - post: b\n  - post: c\nexpect:\n  total: \"1.00\"\n  integrity: all_pass\n");
const ds1 = buildDataSet("DS-1");
const PASSING: readonly CheckResult[] = [{ id: "I-1", name: "Journals balance", status: "pass" }, { id: "I-2", name: "Manual lines", status: "not_applicable", detail: "none here" }];

describe("runScenario (TR-7)", () => {
  it("loads the data set, runs every step in order, compares the expected tables, runs the checks, and passes", async () => {
    const d = new FakeDriver({ total: dec(100n) }, PASSING);
    const r = await runScenario(THREE, ds1, d);
    expect(d.calls).toEqual(["load", "execute 0", "execute 1", "execute 2", "observe", "checks"]);
    expect(r).toMatchObject({ scenario: "three", driver: "fake", dataSet: "DS-1", seed: "ds-1", passed: true, mismatches: [] });
    expect(r.steps.map((s) => s.documentNo)).toEqual(["DOC-0", "DOC-1", "DOC-2"]);
    expect(r.dataFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("a mismatch fails the scenario and says where", async () => {
    const r = await runScenario(THREE, ds1, new FakeDriver({ total: dec(101n) }, PASSING));
    expect(r.passed).toBe(false);
    expect(r.mismatches).toEqual([{ path: "expect.total", expected: "1.00", actual: "1.01" }]);
  });

  it("a failing check fails the scenario even when every expected value matched", async () => {
    const r = await runScenario(THREE, ds1, new FakeDriver({ total: dec(100n) }, [{ id: "I-3", name: "Trial balance", status: "fail", detail: "differs" }]));
    expect(r.passed).toBe(false);
    expect(r.mismatches).toEqual([]);
  });

  it("not_applicable checks do not fail a scenario, and they stay visible in the result", async () => {
    const r = await runScenario(THREE, ds1, new FakeDriver({ total: dec(100n) }, PASSING));
    expect(r.checks.find((c) => c.id === "I-2")).toMatchObject({ status: "not_applicable", detail: "none here" });
    expect(r.passed).toBe(true);
  });

  it("a refused step stops the run, skips the comparison (it would only add noise), and still runs the integrity checks", async () => {
    const d = new FakeDriver({ total: dec(100n) }, PASSING, 1);
    const r = await runScenario(THREE, ds1, d);
    expect(d.calls).toEqual(["load", "execute 0", "execute 1", "checks"]);
    expect(r.passed).toBe(false);
    expect(r.steps.map((s) => s.ok)).toEqual([true, false]);
    expect(r.steps[1]?.detail).toBe("refused");
    expect(r.mismatches).toEqual([]);
  });

  it("an engine that throws is a failed step, not a crashed run", async () => {
    const d = new FakeDriver({ total: dec(100n) }, PASSING, -1, 0);
    const r = await runScenario(THREE, ds1, d);
    expect(r.passed).toBe(false);
    expect(r.steps[0]).toMatchObject({ ok: false, detail: "the engine failed: the engine exploded" });
    expect(d.calls).toContain("checks");
  });

  it("a scenario that does not end with integrity is flagged: every scenario ends with the integrity checks", async () => {
    const s = parseScenario("scenario: x\ndata: DS-1\nsteps:\n  - post: a\nexpect:\n  total: \"1.00\"\n");
    const r = await runScenario(s, ds1, new FakeDriver({ total: dec(100n) }, PASSING));
    expect(r.passed).toBe(false);
    expect(r.mismatches[0]?.path).toBe("expect.integrity");
  });

  it("integrity can name the checks that must really pass; a failing, missing or inapplicable one is reported", async () => {
    const s = parseScenario("scenario: x\ndata: DS-1\nsteps:\n  - post: a\nexpect:\n  integrity: [I-1, I-2, I-9]\n");
    const r = await runScenario(s, ds1, new FakeDriver({}, [...PASSING, { id: "I-9", name: "x", status: "fail" }]));
    expect(r.mismatches.map((m) => `${m.path}:${m.actual}`)).toEqual(["expect.integrity.I-2:not applicable to this engine", "expect.integrity.I-9:fail"]);
  });

  it("uses the scenario's own seed when it has one, and a repeat run gives an identical result", async () => {
    const s = parseScenario(GOOD.replace("data: DS-1", "data: DS-1\nseed: custom"));
    const a = await runScenario(s, ds1, new FakeDriver({}, PASSING));
    expect(a.seed).toBe("custom");
    const b = await runScenario(THREE, ds1, new FakeDriver({ total: dec(100n) }, PASSING));
    const c = await runScenario(THREE, ds1, new FakeDriver({ total: dec(100n) }, PASSING));
    expect(c).toEqual(b);
  });
});
