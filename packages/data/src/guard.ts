import type { Kysely } from "kysely";
import type { PlatformDatabase } from "./model";

/**
 * Document 06, D-3 and section 12: projection tables accept writes only while `apply_guard` is
 * open. Only `applyBundle` (BC-04) calls this. It must run inside a transaction: the guard is
 * opened and closed inside it, and if `work` throws the transaction's rollback restores the closed
 * guard, so it can never stay open.
 */
export async function withApplyGuard<T>(db: Kysely<PlatformDatabase>, work: () => Promise<T>): Promise<T> {
  if (!db.isTransaction) {
    throw new Error("the apply guard can only be opened inside a transaction");
  }
  const open = await db.updateTable("apply_guard").set({ is_open: true }).where("id", "=", 1n).executeTakeFirstOrThrow();
  if (open.numUpdatedRows !== 1n) throw new Error("apply_guard row is missing");
  const result = await work();
  await db.updateTable("apply_guard").set({ is_open: false }).where("id", "=", 1n).execute();
  return result;
}
