import { createTestRuntime, type Runtime } from "@mandi/core";
import type { DataSet, DataSetId, ItemDef, LocationDef, OpeningBalance, OpeningBatch, PartyDef, UnitDef } from "./dataset";
import { ITEM_NAMES, PARTY_NAMES, type ItemName, type PartyName } from "./names";

/**
 * The world builder (document 09, section 6.2): one seeded generator for every data set, so any of them
 * can be rebuilt exactly. The same seed always gives the same data set, down to the identifiers.
 */
export const DEFAULT_SEEDS: Readonly<Record<DataSetId, string>> = { "DS-1": "ds-1", "DS-2": "ds-2" };

const bag = (code: string, name_en: string, name_ur: string, kg: number): UnitDef => ({ code, name_en, name_ur, factor: { num: String(kg), den: "1" } });
const BAG_50 = bag("BAG", "Bag of 50 kg", "50 کلو بوری", 50);
const BAG_25 = bag("BAG", "Bag of 25 kg", "25 کلو بوری", 25);
const MAUND = bag("MAUND", "Maund (40 kg)", "من (40 کلو)", 40);
const CARTON_12 = bag("CARTON", "Carton of 12", "12 کا کارٹن", 12);

function unitsFor(name: ItemName): UnitDef[] {
  if (name.base === "pcs") return [CARTON_12];
  return name.pack === 25 ? [BAG_25, MAUND] : [BAG_50, MAUND];
}

function item(runtime: Runtime, name: ItemName, ur: string | null = name.ur): ItemDef {
  return { id: runtime.ids.newId(), code: name.code, name_en: name.en, name_ur: ur, base_unit: name.base, units: unitsFor(name) };
}

function party(runtime: Runtime, name: PartyName, creditLimitRupees: number, ur: string | null = name.ur): PartyDef {
  return { id: runtime.ids.newId(), code: name.code, kind: name.kind, name_en: name.en, name_ur: ur, credit_limit_paisa: String(BigInt(creditLimitRupees) * 100n) };
}

function locations(runtime: Runtime): LocationDef[] {
  return [
    { id: runtime.ids.newId(), code: "GA", kind: "godown", name_en: "Godown A", name_ur: "گودام اے" },
    { id: runtime.ids.newId(), code: "SB", kind: "shop", name_en: "Shop B", name_ur: "دکان بی" },
  ];
}

const pickNamed = <T extends { readonly code: string }>(list: readonly T[], code: string): T => {
  const found = list.find((x) => x.code === code);
  if (found === undefined) throw new Error(`no name for ${code}`);
  return found;
};

/**
 * DS-1 "Golden minimal": exactly the inputs of the worked examples WE-1 to WE-4 (document 03, section 9):
 * one company; Godown A, and Shop B because WE-3 transfers stock there (document 09 says "one location": see
 * the build log); three items; four parties (a supplier, a carrier, and two customers, one of whom pays by cheque).
 */
function buildDs1(seed: string): DataSet {
  const runtime = createTestRuntime({ seed });
  const company = { id: runtime.ids.newId(), code: "MT", name_en: "Mandi Test Traders", name_ur: "منڈی ٹیسٹ ٹریڈرز", fiscal_year_start_month: 7 };
  return {
    id: "DS-1",
    seed,
    company,
    locations: locations(runtime),
    items: [item(runtime, pickNamed(ITEM_NAMES, "RICE-BAS")), item(runtime, pickNamed(ITEM_NAMES, "WHEAT")), item(runtime, pickNamed(ITEM_NAMES, "OIL"))],
    parties: [
      party(runtime, pickNamed(PARTY_NAMES, "SUP-NOOR"), 0),
      party(runtime, pickNamed(PARTY_NAMES, "CAR-FAST"), 0),
      party(runtime, pickNamed(PARTY_NAMES, "CUS-KARIM"), 5_000_000),
      party(runtime, pickNamed(PARTY_NAMES, "CUS-BILAL"), 3_000_000),
    ],
    opening: { batches: [], balances: [] },
  };
}

function shuffled<T>(runtime: Runtime, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = runtime.random.nextInt(i + 1);
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

/**
 * DS-2 "Day in the life": 20 items, 15 parties, opening stock as batches and opening balances (document 02,
 * acceptance step 1), two locations. It is a skeleton: the acceptance steps that use it arrive with the modules.
 * One item and one party have no Urdu name on purpose (R-29 point 5).
 */
function buildDs2(seed: string): DataSet {
  const runtime = createTestRuntime({ seed });
  const company = { id: runtime.ids.newId(), code: "DL", name_en: "Day-in-the-Life Traders", name_ur: "ڈے اِن دی لائف ٹریڈرز", fiscal_year_start_month: 7 };
  const places = locations(runtime);
  const names = shuffled(runtime, ITEM_NAMES).slice(0, 20);
  let partyNames: PartyName[] = [];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    partyNames = shuffled(runtime, PARTY_NAMES).slice(0, 15);
    const kinds = new Set(partyNames.map((p) => p.kind));
    if (kinds.has("supplier") && kinds.has("customer") && kinds.has("carrier")) break;
  }
  const noUrduItem = runtime.random.nextInt(names.length);
  const noUrduParty = runtime.random.nextInt(partyNames.length);
  const items = names.map((n, i) => item(runtime, n, i === noUrduItem ? null : n.ur));
  const parties = partyNames.map((p, i) => party(runtime, p, (1 + runtime.random.nextInt(10)) * 500_000, i === noUrduParty ? null : p.ur));

  const batches: OpeningBatch[] = [];
  for (const it of items.slice(0, 12)) {
    const place = places[runtime.random.nextInt(places.length)];
    const kg = 500 + runtime.random.nextInt(19_500);
    const rupees = 40 + runtime.random.nextInt(460);
    batches.push({
      item_code: it.code,
      location_code: place?.code ?? "GA",
      qty_milli: String(BigInt(kg) * 1000n),
      unit_cost_micro: String(BigInt(rupees) * 1_000_000n + BigInt(runtime.random.nextInt(1_000)) * 1000n),
      received_on: `2026-06-${String(1 + runtime.random.nextInt(28)).padStart(2, "0")}`,
    });
  }
  const balances: OpeningBalance[] = [];
  for (const p of parties.slice(0, 8)) {
    const side = p.kind === "supplier" || p.kind === "carrier" ? "payable" : p.kind === "customer" ? "receivable" : runtime.random.nextInt(2) === 0 ? "receivable" : "payable";
    balances.push({ party_code: p.code, side, amount_paisa: String((BigInt(10_000) + BigInt(runtime.random.nextInt(1_990_000))) * 100n) });
  }
  return { id: "DS-2", seed, company, locations: places, items, parties, opening: { batches, balances } };
}

export function buildDataSet(id: DataSetId, seed: string = DEFAULT_SEEDS[id]): DataSet {
  return id === "DS-1" ? buildDs1(seed) : buildDs2(seed);
}
