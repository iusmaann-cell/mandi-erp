import { NumericError } from "./errors";
import { divRound } from "./round";
import { BASE_UNIT, type Factor } from "./units";
import { type Micro, type Milli, type P4, type Paisa, type R4, micro, paisa } from "./types";

/*
 * Every product of money, quantity, cost, rate and percentage in the system lives here, computed
 * with exact integers (BigInt) and rounded once, at the end, by divRound (document 05, section 10;
 * document 06, section 2.1). The scale of each divisor is derived in the comment above it.
 */

/**
 * Line amount in paisa = quantity x rate, where the rate is quoted per a rate unit of `rateUnit`.
 *   qty_milli/1000 base units  /  (num/den)  =  rate units;   x  rate_r4/10000 rupees  x  100 paisa
 *   = qty_milli x den x rate_r4 / (num x 100,000)
 */
export function lineAmount(qty: Milli, rate: R4, rateUnit: Factor = BASE_UNIT): Paisa {
  return paisa(divRound(qty * rateUnit.den * rate, rateUnit.num * 100_000n));
}

/**
 * Cost in paisa of a quantity at a unit cost.
 *   qty_milli/1000 x cost_micro/1,000,000 rupees x 100 paisa = qty_milli x cost_micro / 10,000,000
 */
export function costOf(qty: Milli, unitCost: Micro): Paisa {
  return paisa(divRound(qty * unitCost, 10_000_000n));
}

/**
 * Unit cost (micro-rupees per base unit) of a quantity bought for a total.
 *   cost_micro = total_paisa x 10,000,000 / qty_milli      (the inverse of costOf)
 */
export function unitCostMicro(total: Paisa, qty: Milli): Micro {
  if (qty <= 0n) {
    throw new NumericError("bad-argument", "a unit cost needs a quantity above zero");
  }
  return micro(divRound(total * 10_000_000n, qty));
}

/**
 * A percentage of an amount. 100% is 1,000,000 p4.
 *   amount_paisa x pct_p4 / 1,000,000        (18% = 180,000: Rs 1,000.00 gives Rs 180.00)
 */
export function percentOf(amount: Paisa, pct: P4): Paisa {
  return paisa(divRound(amount * pct, 1_000_000n));
}

/** What is left in a lot: its quantity and the value still carried for it. */
export interface Lot {
  readonly qty: Milli;
  readonly value: Paisa;
}

/**
 * The cost taken when `consumed` leaves a lot (document 03, section 2): quantity x unit cost,
 * except that taking the entire remaining quantity takes the remaining value, so rounding never
 * leaves a few paisa behind in a lot with no quantity. Taking more than is there is refused here;
 * negative stock is the inventory engine's business, not this module's.
 */
export function consumptionCost(lot: Lot, consumed: Milli, unitCost: Micro): Paisa {
  if (consumed < 0n || consumed > lot.qty) {
    throw new NumericError("bad-argument", "consumption must be between zero and the quantity in the lot");
  }
  return consumed === lot.qty ? lot.value : costOf(consumed, unitCost);
}
