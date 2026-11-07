import type { Clock, IdSource } from "@mandi/core";
import type { TxHandles } from "@mandi/data";
import { BUNDLE_SCHEMA_VERSION, GENESIS_HASH, sealBundle, type Bundle, type BundleKind, type WireRow } from "./bundle";

export interface AuthorInput {
  readonly locationId: string | null;
  readonly nodeId: string;
  readonly kind: BundleKind;
  readonly rows: readonly WireRow[];
}

/**
 * Builds the next bundle of a node inside the posting transaction: the next node_seq, the previous
 * hash, the location's current epoch, its own id and time, sealed with its hash. The caller then
 * applies it (applyBundleInTransaction, mode "author") in the same transaction.
 */
export async function authorBundle(tx: TxHandles, runtime: { readonly clock: Clock; readonly ids: IdSource }, input: AuthorInput): Promise<Bundle> {
  const head = await tx.installation.selectFrom("node_chain_heads").select(["last_seq", "last_hash"]).where("node_id", "=", input.nodeId).executeTakeFirst();
  let epoch = 1n;
  if (input.locationId !== null) {
    const location = await tx.scoped.selectFrom("locations").select("current_epoch").where("id", "=", input.locationId).executeTakeFirst();
    if (location === undefined) throw new Error(`unknown location ${input.locationId}`);
    epoch = BigInt(location.current_epoch);
  }
  return sealBundle({
    bundle_id: runtime.ids.newId(),
    company_id: tx.companyId,
    location_id: input.locationId,
    node_id: input.nodeId,
    epoch: Number(epoch),
    node_seq: Number((head === undefined ? 0n : BigInt(head.last_seq)) + 1n),
    prev_hash: head === undefined ? GENESIS_HASH : head.last_hash,
    schema_version: BUNDLE_SCHEMA_VERSION,
    kind: input.kind,
    created_at: new Date(runtime.clock.nowMs()).toISOString(),
    rows: input.rows,
  });
}
