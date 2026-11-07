/**
 * The data sets of document 09, section 6.2, as plain data. They are produced by one seeded generator
 * (the world builder) and never edited by hand. Whole numbers are decimal strings, as on the wire, so a
 * data set written as JSON and read back is identical and no digit is ever lost. The master-data tables
 * do not exist yet (items and parties arrive with their modules); later packages load these into them.
 */
export type DataSetId = "DS-1" | "DS-2";

export interface FactorDef {
  /** Base units in one of this unit is num / den. */
  readonly num: string;
  readonly den: string;
}
export interface UnitDef {
  readonly code: string;
  readonly name_en: string;
  readonly name_ur: string;
  readonly factor: FactorDef;
}
export interface ItemDef {
  readonly id: string;
  readonly code: string;
  readonly name_en: string;
  /** null on purpose in a few places: R-29 point 5 (a missing Urdu name) must be handled everywhere. */
  readonly name_ur: string | null;
  readonly base_unit: "kg" | "pcs";
  readonly units: readonly UnitDef[];
}
export type PartyKind = "supplier" | "customer" | "carrier" | "both";
export interface PartyDef {
  readonly id: string;
  readonly code: string;
  readonly kind: PartyKind;
  readonly name_en: string;
  readonly name_ur: string | null;
  /** Paisa, as a decimal string. */
  readonly credit_limit_paisa: string;
}
export interface LocationDef {
  readonly id: string;
  readonly code: string;
  readonly kind: "godown" | "shop" | "office";
  readonly name_en: string;
  readonly name_ur: string;
}
export interface OpeningBatch {
  readonly item_code: string;
  readonly location_code: string;
  /** Base-unit milli, as a decimal string. */
  readonly qty_milli: string;
  /** Micro-rupees per base unit, as a decimal string. */
  readonly unit_cost_micro: string;
  readonly received_on: string;
}
export interface OpeningBalance {
  readonly party_code: string;
  readonly side: "receivable" | "payable";
  readonly amount_paisa: string;
}
export interface DataSet {
  readonly id: DataSetId;
  readonly seed: string;
  readonly company: { readonly id: string; readonly code: string; readonly name_en: string; readonly name_ur: string; readonly fiscal_year_start_month: number };
  readonly locations: readonly LocationDef[];
  readonly items: readonly ItemDef[];
  readonly parties: readonly PartyDef[];
  readonly opening: { readonly batches: readonly OpeningBatch[]; readonly balances: readonly OpeningBalance[] };
}
