import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildDataSet } from "../world/build";
import { parseScenario } from "./parse";
import { registerSeed, writeScenarioResult } from "../results";
import { runScenario } from "./runner";
import { StubEngine } from "./stub-engine";
import type { Decimal, ParamValue, Step } from "./types";

const ds1 = buildDataSet("DS-1");
const step = (command: string, params: Record<string, ParamValue>): Step => ({ command, params, line: 1 });
const purchase = (extra: Record<string, ParamValue> = {}): Step => step("post purchase_receipt", { day: "1", item: "RICE-BAS", supplier: "SUP-NOOR", location: "GA", qty_kg: "1000", rate: "100.00", ...extra });
const sale = (extra: Record<string, ParamValue> = {}): Step => step("post sale_dispatch", { day: "1", item: "RICE-BAS", customer: "CUS-KARIM", location: "GA", qty_kg: "400", rate: "120.00", ...extra });
async function engine(): Promise<StubEngine> {
  const e = new StubEngine();
  await e.load(ds1);
  return e;
}
const val = (o: unknown): bigint => (o as Decimal).value;

describe("WE-1 end to end (the BC-05 exit proof)", () => {
  it("the scenario file runs through the runner with the stub engine: every step, every expected number, every check that can be made", async () => {
    const scenario = parseScenario(readFileSync(new URL("../../../../scenarios/WE-1.yaml", import.meta.url), "utf8"));
    const result = await runScenario(scenario, buildDataSet(scenario.data), new StubEngine());
    registerSeed("scenario", result.seed, `${scenario.name} on ${scenario.data}`); // leaves seed and result for the report generator when MANDI_RESULTS_DIR is set
    writeScenarioResult(result);
    expect(result.mismatches).toEqual([]);
    expect(result.steps.map((s) => s.ok)).toEqual([true, true, true]);
    expect(result.steps.map((s) => s.documentNo)).toEqual(["PR-GA-01-2627-000001", "PR-GA-01-2627-000002", "SD-GA-01-2627-000001"]);
    expect(result.passed).toBe(true);
    const by = (s: string) => result.checks.filter((c) => c.status === s).map((c) => c.id);
    expect(by("pass")).toEqual(["I-1", "I-3", "I-6", "I-11", "I-12", "I-14", "I-16"]);
    expect(by("fail")).toEqual([]);
    expect(by("not_applicable")).toEqual(["I-2", "I-4", "I-5", "I-7", "I-8", "I-9", "I-10", "I-13", "I-15", "I-17", "I-18"]);
    expect(result.checks).toHaveLength(18);
    expect(result.checks.filter((c) => c.status === "not_applicable").every((c) => (c.detail ?? "").length > 5)).toBe(true);
  });

  it("the numbers are those of document 03, section 9.1, one by one (checked here from the document's own working)", async () => {
    const e = await engine();
    await e.execute(step("post purchase_receipt", { day: "1", item: "RICE-BAS", supplier: "SUP-NOOR", location: "GA", qty_kg: "10000", rate: "200.00", freight: { payee: "CAR-FAST", amount: "20000" } }), 0);
    let o = await e.observe();
    expect(val((o["batches"] as Record<string, unknown>[])[0]?.["unit_cost"])).toBe(202_000_000n); // 2,020,000 / 10,000 kg = 202.000000
    expect(val((o["accounts"] as Record<string, unknown>)["INVENTORY"])).toBe(202_000_000n); // Rs 2,020,000.00
    await e.execute(step("post purchase_receipt", { day: "2", item: "RICE-BAS", supplier: "SUP-NOOR", location: "GA", qty_kg: "5000", rate: "210.00" }), 1);
    o = await e.observe();
    expect(val((o["accounts"] as Record<string, unknown>)["INVENTORY"])).toBe(307_000_000n); // Rs 3,070,000.00
    await e.execute(step("post sale_dispatch", { day: "3", item: "RICE-BAS", customer: "CUS-KARIM", location: "GA", qty_kg: "12500", rate: "230.00" }), 2);
    o = await e.observe();
    expect(val((o["accounts"] as Record<string, unknown>)["COGS"])).toBe(254_500_000n); // 2,020,000 + 525,000
    expect(val((o["profit"] as Record<string, unknown>)["invoice"])).toBe(33_000_000n); // Rs 330,000.00
  });
});

describe("the stub engine", () => {
  it("sells first-in first-out across batches and prices each batch at its own cost", async () => {
    const e = await engine();
    await e.execute(purchase({ qty_kg: "100", rate: "10.00" }), 0);
    await e.execute(purchase({ day: "2", qty_kg: "100", rate: "20.00" }), 1);
    const r = await e.execute(sale({ qty_kg: "150", rate: "30.00" }), 2);
    expect(r.ok).toBe(true);
    const o = await e.observe();
    const batches = o["batches"] as Record<string, unknown>[];
    expect(batches.map((b) => [b["no"], val(b["remaining_kg"])])).toEqual([["B1", 0n], ["B2", 50_000n]]);
    expect(val((o["accounts"] as Record<string, unknown>)["COGS"])).toBe(200_000n); // 100 x 10 + 50 x 20 = Rs 2,000.00
  });

  it("capitalises freight into the batch cost", async () => {
    const e = await engine();
    await e.execute(purchase({ qty_kg: "1000", rate: "100.00", freight: { payee: "CAR-FAST", amount: "500.00" } }), 0);
    const o = await e.observe();
    expect(val((o["batches"] as Record<string, unknown>[])[0]?.["unit_cost"])).toBe(100_500_000n); // (100,000 + 500) / 1,000 kg
    expect(val((o["accounts"] as Record<string, unknown>)["TRANSPORT_PAYABLE"])).toBe(50_000n);
    expect(val(((o["parties"] as Record<string, Record<string, unknown>>)["CAR-FAST"])?.["payable"])).toBe(50_000n);
  });

  it("rounds a half paisa up, through the numeric module", async () => {
    const e = await engine();
    await e.execute(purchase({ qty_kg: "0.001", rate: "5.0000" }), 0); // 0.001 kg at Rs 5 = 0.005 rupee = 0.5 paisa -> 1 paisa
    expect(val(((await e.observe())["accounts"] as Record<string, unknown>)["INVENTORY"])).toBe(1n);
  });

  it("refuses what it does not know, and says why", async () => {
    const e = await engine();
    expect(await e.execute(step("post transfer", {}), 0)).toEqual({ ok: false, detail: 'the stub engine does not know "post transfer"' });
    await e.execute(purchase({ qty_kg: "100" }), 0);
    expect((await e.execute(sale({ qty_kg: "101" }), 1)).detail).toMatch(/only 100 is in stock.*negative stock/);
    expect((await e.execute(purchase({ item: "NOPE" }), 2)).detail).toBe('unknown item "NOPE"');
    expect((await e.execute(purchase({ supplier: "NOPE" }), 2)).detail).toBe('unknown party "NOPE"');
    expect((await e.execute(purchase({ location: "ZZ" }), 2)).detail).toBe('unknown location "ZZ"');
    expect((await e.execute(purchase({ qty_kg: "abc" }), 2)).detail).toMatch(/not a number/);
    expect((await e.execute(purchase({ qty_kg: "0" }), 2)).detail).toMatch(/above zero/);
    expect((await e.execute(purchase({ rate: "1.00001" }), 2)).detail).toMatch(/too-many-decimals/);
    expect((await e.execute(purchase({ day: "30" }), 2)).detail).toMatch(/1 to 28/);
    expect((await e.execute(step("post purchase_receipt", { day: "1" }), 2)).detail).toMatch(/"item" is needed/);
    expect((await e.execute(purchase({ freight: "20000" }), 2)).detail).toMatch(/who is paid/);
    expect((await e.execute(purchase({ freight: { payee: "CAR-FAST", amount: "1.234" } }), 2)).detail).toMatch(/not a money amount/);
    expect((await e.execute(sale({ qty_kg: "-1" }), 2)).detail).toMatch(/negative|not a number|above zero/);
  });

  it("numbers documents per type, location and fiscal year, gap-free", async () => {
    const e = await engine();
    const a = await e.execute(purchase(), 0);
    const b = await e.execute(purchase({ location: "SB" }), 1);
    const c = await e.execute(purchase(), 2);
    expect([a.documentNo, b.documentNo, c.documentNo]).toEqual(["PR-GA-01-2627-000001", "PR-SB-01-2627-000001", "PR-GA-01-2627-000002"]);
  });

  it("a second load starts from nothing", async () => {
    const e = await engine();
    await e.execute(purchase(), 0);
    await e.load(ds1);
    expect(((await e.observe())["batches"] as unknown[]).length).toBe(0);
  });

  it("refuses to run before a data set is loaded", async () => {
    const e = new StubEngine();
    expect((await e.execute(purchase(), 0)).detail).toBe("no data set loaded");
    expect((await e.execute(sale(), 0)).detail).toBe("no data set loaded");
  });

  it("PROPERTY: any mix of purchases and sales conserves cost (what was bought = what was sold + what is left), keeps the Inventory account equal to the lots, and passes every check it can make", async () => {
    const buy = fc.record({ kg: fc.integer({ min: 1, max: 5000 }), rate: fc.integer({ min: 1, max: 900 }), freight: fc.integer({ min: 0, max: 5000 }) });
    await fc.assert(
      fc.asyncProperty(fc.array(buy, { minLength: 1, maxLength: 5 }), fc.array(fc.integer({ min: 1, max: 4000 }), { maxLength: 6 }), async (buys, sells) => {
        const e = await engine();
        let bought = 0n;
        let stock = 0n;
        let index = 0;
        for (const b of buys) {
          const r = await e.execute(purchase({ qty_kg: String(b.kg), rate: `${String(b.rate)}.00`, ...(b.freight > 0 ? { freight: { payee: "CAR-FAST", amount: String(b.freight) } } : {}) }), index++);
          expect(r.ok).toBe(true);
          bought += BigInt(b.kg) * BigInt(b.rate) * 100n + BigInt(b.freight) * 100n;
          stock += BigInt(b.kg);
        }
        for (const kg of sells) {
          const r = await e.execute(sale({ qty_kg: String(kg), rate: "950.00" }), index++);
          expect(r.ok).toBe(BigInt(kg) <= stock);
          if (r.ok) stock -= BigInt(kg);
        }
        const o = await e.observe();
        const accounts = o["accounts"] as Record<string, unknown>;
        expect(val(accounts["COGS"]) + val(accounts["INVENTORY"])).toBe(bought);
        expect((o["batches"] as Record<string, unknown>[]).reduce((a, b) => a + val(b["value"]), 0n)).toBe(val(accounts["INVENTORY"]));
        expect((await e.finalChecks()).filter((c) => c.status === "fail")).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });
});
