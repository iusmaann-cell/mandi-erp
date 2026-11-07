import { consumptionCost, formatScaled, lineAmount, micro, milli, paisa, parseScaled, r4, unitCostMicro } from "@mandi/numeric";
import { fiscalYearCodeOf, formatDocNo } from "@mandi/sync";
import type { DataSet } from "../world/dataset";
import type { CheckResult, Decimal, Observation, Observed, ScenarioDriver, Step, StepOutcome } from "./types";

/**
 * A STUB ENGINE, not the product's engine and not the reference model. It knows two commands, enough to
 * run WE-1 (document 03, section 9.1) through the scenario runner: `post purchase_receipt` (goods and
 * freight borne by us, capitalised into the batch) and `post sale_dispatch` (FIFO from the batches of the
 * location). It refuses what it does not know (negative stock, tax, transfers) instead of guessing. The
 * real engine arrives in the posting packages; the reference model (VC-0a) is written separately, by a
 * party that has not seen this file. Its job here is only to prove that the runner works.
 */
type Natural = "debit" | "credit";
const ACCOUNTS: Readonly<Record<string, Natural>> = { INVENTORY: "debit", COGS: "debit", AR: "debit", GRNI: "credit", SALES: "credit", AP: "credit", TRANSPORT_PAYABLE: "credit" };

interface Line {
  readonly account: string;
  readonly debit: bigint;
  readonly credit: bigint;
  readonly party?: string;
}
interface Entry {
  readonly document: string;
  readonly lines: readonly Line[];
}
interface Lot {
  readonly no: string;
  readonly item: string;
  readonly location: string;
  remaining: bigint;
  value: bigint;
  readonly unitCost: bigint;
  profit: bigint;
}
interface Doc {
  readonly no: string;
  readonly type: "purchase_receipt" | "sale_dispatch";
  readonly party: string;
  readonly amount: bigint;
  readonly qty: bigint;
  readonly rate: bigint;
  readonly series: string;
  readonly seq: bigint;
}

class Rejected extends Error {}

const dec = (value: bigint, scale: number): Decimal => ({ kind: "decimal", value, scale });

export class StubEngine implements ScenarioDriver {
  readonly name = "stub engine (WE-1 only)";
  #data: DataSet | undefined;
  #entries: Entry[] = [];
  #lots: Lot[] = [];
  #docs: Doc[] = [];
  #lastInvoiceProfit = 0n;

  load(dataSet: DataSet): Promise<void> {
    this.#data = dataSet;
    this.#entries = [];
    this.#lots = [];
    this.#docs = [];
    this.#lastInvoiceProfit = 0n;
    return Promise.resolve();
  }

  execute(step: Step, index: number): Promise<StepOutcome> {
    try {
      if (step.command === "post purchase_receipt") return Promise.resolve(this.#purchase(step, index));
      if (step.command === "post sale_dispatch") return Promise.resolve(this.#sale(step));
      return Promise.resolve({ ok: false, detail: `the stub engine does not know "${step.command}"` });
    } catch (error) {
      if (error instanceof Rejected) return Promise.resolve({ ok: false, detail: error.message });
      throw error;
    }
  }

  // ---- inputs ---------------------------------------------------------------------------------------
  #text(step: Step, key: string): string {
    const v = step.params[key];
    if (typeof v !== "string") throw new Rejected(`${step.command}: "${key}" is needed`);
    return v;
  }
  #number(step: Step, key: string, scale: number): bigint {
    const read = parseScaled(this.#text(step, key), { scale });
    if (!read.ok) throw new Rejected(`${step.command}: "${key}" is not a number with at most ${String(scale)} decimals (${read.code})`);
    return read.value;
  }
  #known<T extends { readonly code: string }>(list: readonly T[], code: string, what: string): T {
    const found = list.find((x) => x.code === code);
    if (found === undefined) throw new Rejected(`unknown ${what} "${code}"`);
    return found;
  }
  #dateOf(day: string): string {
    const n = Number.parseInt(day, 10);
    if (!/^\d{1,2}$/.test(day) || n < 1 || n > 28) throw new Rejected(`"day" must be 1 to 28 (got ${day})`);
    return `2026-08-${String(n).padStart(2, "0")}`;
  }
  #number_(type: "PR" | "SD", location: string, date: string): { no: string; series: string; seq: bigint } {
    const series = `${type}-${location}-01-${fiscalYearCodeOf(date)}`;
    const seq = BigInt(this.#docs.filter((d) => d.series === series).length) + 1n;
    return { no: formatDocNo(series, seq), series, seq };
  }
  #post(document: string, lines: readonly Line[]): void {
    this.#entries.push({ document, lines });
  }

  // ---- commands -------------------------------------------------------------------------------------
  #purchase(step: Step, index: number): StepOutcome {
    const data = this.#data;
    if (data === undefined) throw new Rejected("no data set loaded");
    const item = this.#known(data.items, this.#text(step, "item"), "item");
    const supplier = this.#known(data.parties, this.#text(step, "supplier"), "party");
    const location = this.#known(data.locations, this.#text(step, "location"), "location");
    const qty = milli(this.#number(step, "qty_kg", 3));
    const rate = r4(this.#number(step, "rate", 4));
    if (qty <= 0n) throw new Rejected("the quantity must be above zero");
    const date = this.#dateOf(typeof step.params["day"] === "string" ? step.params["day"] : "1");
    const goods = lineAmount(qty, rate);
    const freightParams = step.params["freight"];
    let freight = 0n;
    let payee = "";
    if (freightParams !== undefined) {
      if (typeof freightParams !== "object" || Array.isArray(freightParams)) throw new Rejected("freight must say who is paid and how much");
      const fp = freightParams as Record<string, unknown>;
      payee = this.#known(data.parties, String(fp["payee"]), "party").code;
      const read = parseScaled(String(fp["amount"]), { scale: 2 });
      if (!read.ok) throw new Rejected(`freight amount is not a money amount (${read.code})`);
      freight = read.value;
    }
    const doc = this.#number_("PR", location.code, date);
    const total = paisa(goods + freight);
    const lot: Lot = { no: `B${String(this.#lots.length + 1)}`, item: item.code, location: location.code, remaining: qty, value: total, unitCost: unitCostMicro(total, qty), profit: 0n };
    this.#lots.push(lot);
    this.#docs.push({ no: doc.no, type: "purchase_receipt", party: supplier.code, amount: goods, qty, rate, series: doc.series, seq: doc.seq });
    this.#post(doc.no, [
      { account: "INVENTORY", debit: goods, credit: 0n },
      { account: "GRNI", debit: 0n, credit: goods },
      { account: "GRNI", debit: goods, credit: 0n },
      { account: "AP", debit: 0n, credit: goods, party: supplier.code },
      ...(freight > 0n
        ? [
            { account: "INVENTORY", debit: freight, credit: 0n },
            { account: "TRANSPORT_PAYABLE", debit: 0n, credit: freight, party: payee },
          ]
        : []),
    ]);
    void index;
    return { ok: true, documentNo: doc.no, detail: `batch ${lot.no}: ${formatScaled(qty, { scale: 3, minDecimals: 0 })} at unit cost ${formatScaled(lot.unitCost, { scale: 6 })}` };
  }

  #sale(step: Step): StepOutcome {
    const data = this.#data;
    if (data === undefined) throw new Rejected("no data set loaded");
    const item = this.#known(data.items, this.#text(step, "item"), "item");
    const customer = this.#known(data.parties, this.#text(step, "customer"), "party");
    const location = this.#known(data.locations, this.#text(step, "location"), "location");
    const qty = milli(this.#number(step, "qty_kg", 3));
    const rate = r4(this.#number(step, "rate", 4));
    if (qty <= 0n) throw new Rejected("the quantity must be above zero");
    const date = this.#dateOf(typeof step.params["day"] === "string" ? step.params["day"] : "1");
    const lots = this.#lots.filter((l) => l.item === item.code && l.location === location.code && l.remaining > 0n);
    const available = lots.reduce((a, l) => a + l.remaining, 0n);
    if (available < qty) throw new Rejected(`only ${formatScaled(available, { scale: 3, minDecimals: 0 })} is in stock; the stub engine does not do negative stock (WE-2)`);
    const sale = lineAmount(qty, rate);
    let need: bigint = qty;
    let cogs = 0n;
    for (const lot of lots) {
      if (need === 0n) break;
      const take = lot.remaining < need ? lot.remaining : need;
      const cost = consumptionCost({ qty: milli(lot.remaining), value: paisa(lot.value) }, milli(take), micro(lot.unitCost));
      lot.profit += lineAmount(milli(take), rate) - cost;
      lot.remaining -= take;
      lot.value -= cost;
      cogs += cost;
      need -= take;
    }
    this.#lastInvoiceProfit = sale - cogs;
    const doc = this.#number_("SD", location.code, date);
    this.#docs.push({ no: doc.no, type: "sale_dispatch", party: customer.code, amount: sale, qty, rate, series: doc.series, seq: doc.seq });
    this.#post(doc.no, [
      { account: "AR", debit: sale, credit: 0n, party: customer.code },
      { account: "SALES", debit: 0n, credit: sale },
      { account: "COGS", debit: cogs, credit: 0n },
      { account: "INVENTORY", debit: 0n, credit: cogs },
    ]);
    return { ok: true, documentNo: doc.no, detail: `sold ${formatScaled(qty, { scale: 3, minDecimals: 0 })} for ${formatScaled(sale, { scale: 2 })}, cost ${formatScaled(cogs, { scale: 2 })}` };
  }

  // ---- what an engine reports -----------------------------------------------------------------------
  #balance(account: string): bigint {
    let debit = 0n;
    let credit = 0n;
    for (const e of this.#entries) {
      for (const l of e.lines) {
        if (l.account !== account) continue;
        debit += l.debit;
        credit += l.credit;
      }
    }
    return ACCOUNTS[account] === "credit" ? credit - debit : debit - credit;
  }

  observe(): Promise<Observation> {
    const accounts: Record<string, Observed> = {};
    for (const a of Object.keys(ACCOUNTS)) accounts[a] = dec(this.#balance(a), 2);
    const profit: Record<string, Observed> = { invoice: dec(this.#lastInvoiceProfit, 2) };
    for (const l of this.#lots) profit[l.no] = dec(l.profit, 2);
    const parties: Record<string, Observed> = {};
    for (const e of this.#entries) {
      for (const l of e.lines) {
        if (l.party === undefined) continue;
        const key = l.account === "AR" ? "receivable" : "payable";
        const current = (parties[l.party] ?? {}) as Record<string, Observed>;
        const before = (current[key] as Decimal | undefined)?.value ?? 0n;
        parties[l.party] = { ...current, [key]: dec(before + (l.account === "AR" ? l.debit - l.credit : l.credit - l.debit), 2) };
      }
    }
    return Promise.resolve({
      batches: this.#lots.map((l) => ({ no: l.no, item: l.item, location: l.location, remaining_kg: dec(l.remaining, 3), unit_cost: dec(l.unitCost, 6), value: dec(l.value, 2) })),
      accounts,
      profit,
      parties,
      documents: this.#docs.map((d) => ({ no: d.no, type: d.type })),
    });
  }

  finalChecks(): Promise<readonly CheckResult[]> {
    const pass = (id: string, name: string): CheckResult => ({ id, name, status: "pass" });
    const fail = (id: string, name: string, detail: string): CheckResult => ({ id, name, status: "fail", detail });
    const na = (id: string, name: string, reason: string): CheckResult => ({ id, name, status: "not_applicable", detail: reason });
    const out: CheckResult[] = [];

    const unbalanced = this.#entries.filter((e) => e.lines.reduce((a, l) => a + l.debit, 0n) !== e.lines.reduce((a, l) => a + l.credit, 0n));
    out.push(unbalanced.length === 0 ? pass("I-1", "Journals balance") : fail("I-1", "Journals balance", `unbalanced: ${unbalanced.map((e) => e.document).join(", ")}`));
    out.push(na("I-2", "No manual line on a control account", "the stub has no manual journals"));
    const debits = this.#entries.reduce((a, e) => a + e.lines.reduce((b, l) => b + l.debit, 0n), 0n);
    const credits = this.#entries.reduce((a, e) => a + e.lines.reduce((b, l) => b + l.credit, 0n), 0n);
    out.push(debits === credits ? pass("I-3", "Trial balance balances") : fail("I-3", "Trial balance balances", `debits ${debits.toString()} credits ${credits.toString()}`));
    out.push(na("I-4", "Lots equal the stock ledger", "the stub has no stock ledger"));
    out.push(na("I-5", "Balances equal lots", "the stub has no stock balances"));
    const lotValue = this.#lots.reduce((a, l) => a + l.value, 0n);
    const inventory = this.#balance("INVENTORY");
    out.push(inventory === lotValue ? pass("I-6", "The Inventory account equals the value of the lots") : fail("I-6", "The Inventory account equals the value of the lots", `account ${inventory.toString()} lots ${lotValue.toString()}`));
    for (const [id, name] of [["I-7", "Goods in transit equals open transfers"], ["I-8", "Goods in transit is never negative"]] as const) out.push(na(id, name, "the stub has no transfers"));
    for (const [id, name] of [["I-9", "Negative stock is consistent"], ["I-10", "Cost corrections are consistent"]] as const) out.push(na(id, name, "the stub refuses negative stock"));
    const wrong = this.#docs.filter((d) => d.amount !== lineAmount(milli(d.qty), r4(d.rate)));
    out.push(wrong.length === 0 ? pass("I-11", "Document arithmetic") : fail("I-11", "Document arithmetic", wrong.map((d) => d.no).join(", ")));
    const unjournaled = this.#docs.filter((d) => !this.#entries.some((e) => e.document === d.no));
    out.push(unjournaled.length === 0 ? pass("I-12", "Every document has its journal") : fail("I-12", "Every document has its journal", unjournaled.map((d) => d.no).join(", ")));
    out.push(na("I-13", "Allocations", "the stub has no payments"));
    const receivableByDocs = new Map<string, bigint>();
    for (const d of this.#docs.filter((x) => x.type === "sale_dispatch")) receivableByDocs.set(d.party, (receivableByDocs.get(d.party) ?? 0n) + d.amount);
    let partiesOk = true;
    for (const [party, amount] of receivableByDocs) {
      const posted = this.#entries.reduce((a, e) => a + e.lines.filter((l) => l.account === "AR" && l.party === party).reduce((b, l) => b + l.debit - l.credit, 0n), 0n);
      if (posted !== amount) partiesOk = false;
    }
    out.push(partiesOk ? pass("I-14", "Party positions") : fail("I-14", "Party positions", "a receivable differs from its documents"));
    out.push(na("I-15", "Sequence and hash chain complete", "the stub has no nodes"));
    const series = new Set(this.#docs.map((d) => d.series));
    let gaps = "";
    for (const s of series) {
      const seqs = this.#docs.filter((d) => d.series === s).map((d) => d.seq).sort((a, b) => (a < b ? -1 : 1));
      if (seqs.some((n, i) => n !== BigInt(i + 1))) gaps += `${s} `;
    }
    out.push(gaps === "" ? pass("I-16", "Numbering gaps are explained") : fail("I-16", "Numbering gaps are explained", `gaps in ${gaps.trim()}`));
    out.push(na("I-17", "Unmatched arrivals are old enough to alert", "the stub has no arrivals"));
    out.push(na("I-18", "Tax account balances equal the postings by tax kind", "the stub has no tax"));
    return Promise.resolve(out);
  }
}
