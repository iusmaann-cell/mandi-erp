import type { Clock, IdSource } from "@mandi/core";
import { withApplyGuard, type CompanyContext, type DataStore, type TxHandles } from "@mandi/data";
import { canonicalize } from "./canonical";
import { derivedId } from "./ids";
import type { SeriesKey } from "./registry";

/**
 * Document 06, section 5 and document 05, section 9. A printed number is
 * `<type>-<location code>-<device code>-<fiscal year>-<sequence>`, for example SI-GA-02-2627-000045:
 * the sequence is padded to six digits and keeps growing past them. The series key is (company, location,
 * device, document type, fiscal year); only the device that issues a number writes the counter.
 */
export const DEFAULT_PADDING = 6;
export const RECOVERY_MARGIN = 100n; // working default, OPEN (document 06, section 16)

/** The fiscal year of a document date (R-26: July to June), as the two-digit start and end years: 2026-07-01 is "2627". */
export function fiscalYearCodeOf(date: string, startMonth = 7): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`not a date: ${date}`);
  const year = Number.parseInt(date.slice(0, 4), 10);
  const month = Number.parseInt(date.slice(5, 7), 10);
  const startYear = month >= startMonth ? year : year - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const yy = (y: number): string => String(y % 100).padStart(2, "0");
  return `${yy(startYear)}${yy(endYear)}`;
}

export function formatDocNo(prefix: string, seq: bigint, padding = DEFAULT_PADDING): string {
  return `${prefix}-${seq.toString().padStart(padding, "0")}`;
}

/** The series key as text, for lost_numbers and for ids derived from it. */
export const seriesKeyText = (key: SeriesKey): string => canonicalize({ deviceId: key.deviceId, docType: key.docType, fiscalYearCode: key.fiscalYearCode, locationId: key.locationId });

async function seriesPrefix(tx: TxHandles, key: SeriesKey): Promise<string> {
  const location = await tx.scoped.selectFrom("locations").select("code").where("id", "=", key.locationId).executeTakeFirst();
  const device = await tx.installation.selectFrom("devices").select("code").where("id", "=", key.deviceId).executeTakeFirst();
  if (location === undefined) throw new Error(`unknown location ${key.locationId}`);
  if (device === undefined) throw new Error(`unknown device ${key.deviceId}`);
  return `${key.docType}-${location.code}-${device.code}-${key.fiscalYearCode}`;
}

export interface IssuedNumber {
  readonly seq: bigint;
  readonly docNo: string;
}

/**
 * Issues numbers inside the posting transaction. It only READS the counter and counts what this
 * transaction has already issued; the counter itself moves when applyBundle applies the bundle (step 4),
 * in the same transaction as the document. So a rolled-back save never burns a number, and two numbers
 * of one series in one bundle are consecutive.
 */
export class NumberIssuer {
  readonly #tx: TxHandles;
  readonly #issued = new Map<string, bigint>();

  constructor(tx: TxHandles) {
    this.#tx = tx;
  }

  async issue(key: SeriesKey): Promise<IssuedNumber> {
    const row = await this.#tx.scoped
      .selectFrom("number_series")
      .select(["next_number", "prefix", "padding"])
      .where("location_id", "=", key.locationId)
      .where("device_id", "=", key.deviceId)
      .where("doc_type", "=", key.docType)
      .where("fiscal_year_code", "=", key.fiscalYearCode)
      .executeTakeFirst();
    const text = seriesKeyText(key);
    const already = this.#issued.get(text) ?? 0n;
    const seq = decode(row?.next_number, 1n) + already;
    this.#issued.set(text, already + 1n);
    const prefix = row?.prefix ?? (await seriesPrefix(this.#tx, key));
    return { seq, docNo: formatDocNo(prefix, seq, Number(decode(row?.padding, BigInt(DEFAULT_PADDING)))) };
  }
}

/** A counter read from SQLite arrives as bigint on both databases (the drivers see to that); this keeps the type honest. */
function decode(value: bigint | undefined, fallback: bigint): bigint {
  return value === undefined ? fallback : BigInt(value);
}

export interface RecoverOptions {
  readonly reason: "lost_device" | "restore";
  /** The highest number known to have been issued (from the cloud, when a device is rebuilt). Defaults to what the counter shows. */
  readonly knownHighest?: bigint;
  readonly margin?: bigint;
}

/**
 * Document 06, section 5.2: before a replacement device issues its first number it jumps its counter ahead
 * by a safety margin (100) beyond the highest number it knows, and records the skipped range in
 * lost_numbers with the reason, so the gap is explained. A document later found on the old device syncs
 * normally, because its number is below the jump.
 */
export async function recoverSeries(store: DataStore, context: CompanyContext, runtime: { readonly clock: Clock; readonly ids: IdSource }, key: SeriesKey, options: RecoverOptions): Promise<{ readonly from: bigint; readonly to: bigint; readonly nextNumber: bigint }> {
  const margin = options.margin ?? RECOVERY_MARGIN;
  const now = new Date(runtime.clock.nowMs()).toISOString();
  return store.transaction(context, async (tx) => {
    const row = await tx.scoped
      .selectFrom("number_series")
      .select(["id", "next_number"])
      .where("location_id", "=", key.locationId)
      .where("device_id", "=", key.deviceId)
      .where("doc_type", "=", key.docType)
      .where("fiscal_year_code", "=", key.fiscalYearCode)
      .executeTakeFirst();
    const counted = decode(row?.next_number, 1n) - 1n;
    const highest = options.knownHighest !== undefined && options.knownHighest > counted ? options.knownHighest : counted;
    const from = highest + 1n;
    const to = highest + margin;
    const nextNumber = to + 1n;
    await withApplyGuard(tx.scoped, async () => {
      if (row === undefined) {
        await tx.scoped
          .insertInto("number_series")
          .values({ id: derivedId("number_series", `${tx.companyId}|${seriesKeyText(key)}`), location_id: key.locationId, device_id: key.deviceId, doc_type: key.docType, fiscal_year_code: key.fiscalYearCode, prefix: await seriesPrefix(tx, key), next_number: nextNumber, last_issued_at: null })
          .execute();
      } else {
        await tx.scoped.updateTable("number_series").set({ next_number: nextNumber }).where("id", "=", row.id).execute();
      }
    });
    await tx.scoped.insertInto("lost_numbers").values({ id: runtime.ids.newId(), series_key_json: seriesKeyText(key), number_from: from, number_to: to, reason: options.reason, recorded_at: now }).execute();
    return { from, to, nextNumber };
  });
}
