import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { NumericError } from "./errors";
import { INT64_MAX, INT64_MIN } from "./limits";
import { sum } from "./arith";
import { consumptionCost, costOf, lineAmount, percentOf, unitCostMicro } from "./money";
import { micro, milli, p4, paisa, r4 } from "./types";
import { factor } from "./units";

const i64 = fc.bigInt({ min: INT64_MIN, max: INT64_MAX });

/** Independent oracle: half away from zero as floor((2n + d) / 2d) on magnitudes. */
function oracle(n: bigint, d: bigint): bigint {
  const sign = n < 0n ? -1n : 1n;
  const a = n < 0n ? -n : n;
  return sign * ((2n * a + d) / (2n * d));
}

describe("worked numbers (documents 03 and 06)", () => {
  it("10,000 kg at Rs 202.000000 costs Rs 2,020,000.00 (document 06, 2.1)", () => {
    expect(costOf(milli(10_000_000), micro(202_000_000))).toBe(202_000_000n);
  });

  it("10,000 kg at Rs 230.0000 per kg is Rs 2,300,000.00", () => {
    expect(lineAmount(milli(10_000_000), r4(2_300_000))).toBe(230_000_000n);
  });

  it("18% of Rs 1,000.00 is Rs 180.00", () => {
    expect(percentOf(paisa(100_000), p4(180_000))).toBe(18_000n);
  });

  it("0.25% of Rs 1,000.00 is Rs 2.50", () => {
    expect(percentOf(paisa(100_000), p4(2_500))).toBe(250n);
  });

  it("100 bags of 50 kg, rate Rs 1,800.00 per maund of 40 kg (R-3: entry unit and rate unit differ)", () => {
    // 5,000 kg = 125 maund; 125 x 1,800 = Rs 225,000.00
    expect(lineAmount(milli(5_000_000), r4(18_000_000), factor(40))).toBe(22_500_000n);
  });

  it("a rate per bag of 50 kg on 12.5 bags (625 kg)", () => {
    // 625 kg / 50 = 12.5 bags x Rs 2,400.00 = Rs 30,000.00
    expect(lineAmount(milli(625_000), r4(24_000_000), factor(50))).toBe(3_000_000n);
  });

  it("a rate per carton of 12 pieces on 30 pieces, with an awkward fraction", () => {
    // 30 pieces = 2.5 cartons x Rs 1,000.0000 = Rs 2,500.00
    expect(lineAmount(milli(30_000), r4(10_000_000), factor(12))).toBe(250_000n);
    // a rate per 1/3 of a base unit: 7 base units = 21 thirds
    expect(lineAmount(milli(7_000), r4(10_000), factor(1, 3))).toBe(2_100n);
  });

  it("zero quantity and zero rate give zero", () => {
    expect(lineAmount(milli(0), r4(2_300_000))).toBe(0n);
    expect(lineAmount(milli(10_000_000), r4(0))).toBe(0n);
    expect(costOf(milli(0), micro(5))).toBe(0n);
  });

  it("a negative quantity (a return) gives a negative amount that mirrors the positive", () => {
    expect(lineAmount(milli(-10_000_000), r4(2_300_000))).toBe(-230_000_000n);
  });
});

describe("N-2: beyond safe integers, and refusal of overflow", () => {
  it("9,000,000,000 milli x 250,000,000 micro is exact (the product is above 2^53)", () => {
    const product = 9_000_000_000n * 250_000_000n;
    expect(product > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(costOf(milli(9_000_000_000n), micro(250_000_000n))).toBe(225_000_000_000n);
  });

  it("an exact result near the 64-bit limit is kept, one more is refused, never wrapped", () => {
    // qty x cost / 10,000,000 = INT64_MAX needs qty x cost near 9.2e25; pick cost = 10,000,000 so paisa = qty
    expect(costOf(milli(INT64_MAX), micro(10_000_000))).toBe(INT64_MAX);
    expect(() => costOf(milli(INT64_MAX), micro(10_000_001))).toThrow(/does not fit in 64 bits/);
    expect(() => costOf(milli(INT64_MAX), micro(10_000_001))).toThrow(NumericError);
    expect(costOf(milli(INT64_MIN), micro(10_000_000))).toBe(INT64_MIN);
    expect(() => costOf(milli(INT64_MIN), micro(10_000_001))).toThrow(NumericError);
  });

  it("overflow in each money function is refused with the code overflow", () => {
    const code = (fn: () => unknown): string | undefined => {
      try {
        fn();
      } catch (e) {
        return e instanceof NumericError ? e.code : "other";
      }
      return undefined;
    };
    expect(code(() => lineAmount(milli(INT64_MAX), r4(INT64_MAX)))).toBe("overflow");
    expect(code(() => percentOf(paisa(INT64_MAX), p4(INT64_MAX)))).toBe("overflow");
    expect(code(() => unitCostMicro(paisa(INT64_MAX), milli(1)))).toBe("overflow");
    expect(code(() => costOf(milli(INT64_MAX), micro(INT64_MAX)))).toBe("overflow");
  });

  it("values beyond 64 bits cannot even be built", () => {
    expect(() => milli(INT64_MAX + 1n)).toThrow(NumericError);
    expect(() => micro(INT64_MIN - 1n)).toThrow(NumericError);
  });

  it("agrees with the independent oracle for any 64-bit operands (property)", () => {
    fc.assert(
      fc.property(i64, i64, (q, c) => {
        const expected = oracle(q * c, 10_000_000n);
        const inRange = expected >= INT64_MIN && expected <= INT64_MAX;
        let result: bigint | undefined;
        let refusal: string | undefined;
        try {
          result = costOf(milli(q), micro(c));
        } catch (e) {
          refusal = e instanceof NumericError ? e.code : "other";
        }
        return inRange ? result === expected && refusal === undefined : result === undefined && refusal === "overflow";
      }),
    );
  });

  it("line amount agrees with the oracle for any factor (property)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(1n << 40n), max: 1n << 40n }), fc.bigInt({ min: -(1n << 30n), max: 1n << 30n }), fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 1, max: 5000 }), (q, r, num, den) => {
        const f = factor(num, den);
        return lineAmount(milli(q), r4(r), f) === oracle(q * f.den * r, f.num * 100_000n);
      }),
    );
  });

  it("percentOf agrees with the oracle (property)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(1n << 50n), max: 1n << 50n }), fc.bigInt({ min: -(1n << 30n), max: 1n << 30n }), (a, p) => percentOf(paisa(a), p4(p)) === oracle(a * p, 1_000_000n)));
  });
});

describe("unit cost from a total", () => {
  it("Rs 1,000.00 for 1,000 kg is Rs 1.000000 per kg", () => {
    expect(unitCostMicro(paisa(100_000), milli(1_000_000))).toBe(1_000_000n);
  });

  it("a total that does not divide evenly is rounded to the nearest micro", () => {
    // Rs 100.00 for 3 kg = 33.333333... per kg
    expect(unitCostMicro(paisa(10_000), milli(3_000))).toBe(33_333_333n);
    // Rs 200.00 for 3 kg = 66.666666... -> 66.666667
    expect(unitCostMicro(paisa(20_000), milli(3_000))).toBe(66_666_667n);
  });

  it("refuses zero and negative quantities", () => {
    expect(() => unitCostMicro(paisa(1), milli(0))).toThrow("a unit cost needs a quantity above zero");
    expect(() => unitCostMicro(paisa(1), milli(-1))).toThrow("a unit cost needs a quantity above zero");
    expect(unitCostMicro(paisa(1), milli(1))).toBe(10_000_000n);
  });

  it("costing the quantity back at that unit cost stays within a paisa for ordinary sizes (property)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10_000_000_000n }), fc.bigInt({ min: 1_000n, max: 20_000_000n }), (total, q) => {
        const back = costOf(milli(q), unitCostMicro(paisa(total), milli(q)));
        const diff = back - total;
        // the unit cost is within half a micro; the error on the total is at most q / 20,000,000 paisa
        return (diff < 0n ? -diff : diff) <= q / 20_000_000n + 1n;
      }),
    );
  });
});

describe("consumptionCost: the last consumption of a lot takes the remaining value (document 03, section 2)", () => {
  const lot = (qty: bigint, value: bigint) => ({ qty: milli(qty), value: paisa(value) });

  it("takes quantity x unit cost for a part", () => {
    // 250 kg of a 1,000 kg lot at Rs 100.000000 per kg = Rs 25,000.00
    expect(consumptionCost(lot(1_000_000n, 100_000_000n), milli(250_000), micro(100_000_000))).toBe(2_500_000n);
  });

  it("takes the remaining value, not quantity x cost, when it takes everything", () => {
    // 3 kg at 33.333333 would be Rs 100.00 (9,999.9999 -> 10,000) but the lot carries 10,001 paisa
    expect(consumptionCost(lot(3_000n, 10_001n), milli(3_000), micro(33_333_333))).toBe(10_001n);
    expect(consumptionCost(lot(3_000n, 9_999n), milli(3_000), micro(33_333_333))).toBe(9_999n);
  });

  it("a lot with no quantity and no value costs nothing; zero consumed costs nothing", () => {
    expect(consumptionCost(lot(0n, 0n), milli(0), micro(5))).toBe(0n);
    expect(consumptionCost(lot(5n, 7n), milli(0), micro(9_999_999_999n))).toBe(0n);
  });

  it("refuses to take more than is there, or a negative amount (negative stock is the inventory engine's)", () => {
    expect(() => consumptionCost(lot(10n, 5n), milli(11), micro(1))).toThrow(NumericError);
    expect(() => consumptionCost(lot(10n, 5n), milli(-1), micro(1))).toThrow(/between zero and the quantity/);
    expect(consumptionCost(lot(10n, 5n), milli(10), micro(1))).toBe(5n);
  });

  it("N-4 / PB-5: consuming a lot in any number of parts leaves exactly zero quantity and zero value (property)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 5_000_000_000n }), fc.bigInt({ min: 1n, max: 900_000_000n }), fc.array(fc.bigInt({ min: 1n, max: 1_000_000_000n }), { minLength: 1, maxLength: 30 }), (qty, unit, chunks) => {
        const initialValue = costOf(milli(qty), micro(unit));
        let remainingQty = qty;
        let remainingValue: bigint = initialValue;
        let taken = 0n;
        for (const chunk of chunks) {
          if (remainingQty === 0n) break;
          const c = chunk > remainingQty ? remainingQty : chunk;
          const cost = consumptionCost(lot(remainingQty, remainingValue), milli(c), micro(unit));
          taken += cost;
          remainingQty -= c;
          remainingValue -= cost;
        }
        if (remainingQty > 0n) {
          const cost = consumptionCost(lot(remainingQty, remainingValue), milli(remainingQty), micro(unit));
          taken += cost;
          remainingQty = 0n;
          remainingValue -= cost;
        }
        return remainingQty === 0n && remainingValue === 0n && taken === initialValue;
      }),
    );
  });
});

describe("PB-6: line amounts and document totals", () => {
  it("a line amount is quantity times rate, rounded half up to the paisa; a total is the sum of its lines plus charges and tax minus discounts (property)", () => {
    const line = fc.record({ qty: fc.bigInt({ min: 0n, max: 1_000_000_000n }), rate: fc.bigInt({ min: 0n, max: 100_000_000n }) });
    fc.assert(
      fc.property(fc.array(line, { minLength: 1, maxLength: 12 }), fc.bigInt({ min: 0n, max: 10_000_000n }), fc.bigInt({ min: 0n, max: 1_000_000n }), fc.bigInt({ min: 0n, max: 500_000n }), (lines, charges, taxPct, discount) => {
        const amounts = lines.map((l) => lineAmount(milli(l.qty), r4(l.rate)));
        // each line, stated independently: qty/1000 x rate/10000 rupees = qty x rate / 100,000 paisa, half up
        const expected = lines.map((l) => (2n * l.qty * l.rate + 100_000n) / 200_000n);
        const subtotal = sum(amounts);
        const tax = percentOf(subtotal, p4(taxPct));
        const total = subtotal + paisa(charges) + tax - paisa(discount);
        return amounts.every((a, i) => a === expected[i]) && subtotal === expected.reduce((a, b) => a + b, 0n) && total === subtotal + charges + tax - discount;
      }),
    );
  });
});
