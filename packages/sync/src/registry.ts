import type { Catalogue, platform, TxHandles } from "@mandi/data";
import type { Bundle } from "./bundle";
import type { DecodedRow } from "./rows";

export type ExceptionReason = (typeof platform.EXCEPTION_REASONS)[number];

export interface Rejection {
  readonly code: ExceptionReason;
  readonly detail: string;
}

export interface SeriesKey {
  readonly locationId: string;
  readonly deviceId: string;
  readonly docType: string;
  readonly fiscalYearCode: string;
}

export interface NumberedRow {
  readonly series: SeriesKey;
  readonly seq: bigint;
  /** The printed number, `<type>-<location>-<device>-<fiscal year>-<sequence>`. */
  readonly docNo: string;
}

/** What applyBundle needs to know about one class 1 table beyond the catalogue. */
export interface TableRule {
  /** For a table that issues numbers: which series and number a row used. */
  readonly numbering?: (app: Readonly<Record<string, unknown>>) => NumberedRow;
  /** The column that holds the printed number (default `doc_no`); it must be unique in the company. */
  readonly docNoColumn?: string;
}

export interface ApplyContext {
  readonly tx: TxHandles;
  readonly bundle: Bundle;
  readonly rows: readonly DecodedRow[];
  readonly catalogue: Catalogue;
}

/** Step 2 of applyBundle: a content check beyond the database's constraints (balanced journal, unknown item, locked period ...). */
export type Validator = (context: ApplyContext) => Promise<Rejection | undefined>;
/** Step 4: derive projections from the rows just inserted. Runs while the apply guard is open. */
export type Projector = (context: ApplyContext) => Promise<void>;

export interface ApplyRegistry {
  readonly tables: ReadonlyMap<string, TableRule>;
  readonly validators: readonly Validator[];
  readonly projectors: readonly Projector[];
}

/** The posting rules of the later work packages register themselves here; the machinery does not change. */
export function createRegistry(parts: { readonly tables?: Readonly<Record<string, TableRule>>; readonly validators?: readonly Validator[]; readonly projectors?: readonly Projector[] } = {}): ApplyRegistry {
  return { tables: new Map(Object.entries(parts.tables ?? {})), validators: parts.validators ?? [], projectors: parts.projectors ?? [] };
}
