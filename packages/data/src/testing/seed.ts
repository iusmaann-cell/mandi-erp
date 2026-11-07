import type { TestRuntime } from "@mandi/core";
import type { DataStore } from "../store";

export interface SeededCompany {
  readonly id: string;
  readonly locationId: string;
  readonly fiscalYearId: string;
  /** A real bundle row of this company, for class 1 rows to point at. */
  readonly bundleId: string;
}
export interface World {
  readonly ownerGroupId: string;
  readonly nodeId: string;
  readonly deviceId: string;
  readonly a: SeededCompany;
  readonly b: SeededCompany;
}

/** An owner group, a node, a device, and two companies (AA and BB) each with one location, one fiscal year and one (minimal) bundle. */
export async function seedWorld(store: DataStore, rt: TestRuntime): Promise<World> {
  const now = new Date(rt.clock.nowMs()).toISOString();
  const ownerGroupId = rt.ids.newId();
  const nodeId = rt.ids.newId();
  const deviceId = rt.ids.newId();
  const installation = store.installation();
  await installation.insertInto("owner_groups").values({ id: ownerGroupId, name_en: "Test Traders", name_ur: "ٹیسٹ ٹریڈرز", updated_at: now }).execute();
  await installation.insertInto("nodes").values({ id: nodeId, kind: "site_node", name: "Godown node", updated_at: now }).execute();
  await installation.insertInto("devices").values({ id: deviceId, node_id: nodeId, kind: "windows_pc", code: "01", name: "Godown PC", updated_at: now }).execute();

  let sequence = 0n;
  const company = async (code: string): Promise<SeededCompany> => {
    const id = rt.ids.newId();
    const db = store.scoped({ companyId: id });
    await db.insertInto("companies").values({ id, owner_group_id: ownerGroupId, code, name_en: `Company ${code}`, name_ur: `کمپنی ${code}`, updated_at: now }).execute();
    const locationId = rt.ids.newId();
    await db.insertInto("locations").values({ id: locationId, code: "GD", name_en: "Godown", name_ur: "گودام", kind: "godown", authority_kind: "site_node", current_node_id: nodeId, updated_at: now }).execute();
    const fiscalYearId = rt.ids.newId();
    await db.insertInto("fiscal_years").values({ id: fiscalYearId, code: "FY27", start_date: "2026-07-01", end_date: "2027-06-30", updated_at: now }).execute();
    sequence += 1n;
    const bundleId = rt.ids.newId();
    await db
      .insertInto("bundles")
      .values({ id: bundleId, location_id: locationId, node_id: nodeId, epoch: 1n, node_seq: sequence, prev_hash: "0".repeat(64), hash: sequence.toString().padStart(64, "0"), schema_version: 1n, kind: "document", payload_json: "{}", created_at: now, state: "accepted" })
      .execute();
    return { id, locationId, fiscalYearId, bundleId };
  };
  return { ownerGroupId, nodeId, deviceId, a: await company("AA"), b: await company("BB") };
}
