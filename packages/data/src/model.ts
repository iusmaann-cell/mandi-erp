import type { Generated, Kysely } from "kysely";

/**
 * The platform tables as Kysely sees them, in the canonical application forms of types.ts: ids and
 * timestamps and dates and JSON as strings, whole numbers as bigint, flags as boolean. Columns the
 * database fills in (defaults, company_id) are `Generated`. A test keeps this file and the catalogue
 * in step. Rows come back from SQLite with integers and flags raw; `decodeRow` (rows.ts) makes them canonical.
 */
type Id = string;
type Ts = string;
type DateText = string;
type JsonText = string;

interface ControlledData {
  version: Generated<bigint>;
  updated_at: Ts;
  updated_by_user_id: Id | null;
}

export type NodeStatus = "pending" | "active" | "disabled" | "wipe_requested" | "wiped";

export interface OwnerGroupsTable extends ControlledData {
  id: Id;
  name_en: string;
  name_ur: string;
}

export interface NodesTable extends ControlledData {
  id: Id;
  kind: "cloud" | "site_node" | "standalone_windows" | "standalone_android" | "office_node";
  name: string;
  public_key: string | null;
  status: Generated<NodeStatus>;
  enrolled_at: Ts | null;
  app_version: string | null;
  last_seen_at: Ts | null;
}

export interface DevicesTable extends ControlledData {
  id: Id;
  node_id: Id;
  kind: "windows_pc" | "android";
  code: string;
  name: string;
  public_key: string | null;
  status: Generated<NodeStatus>;
  enrolled_at: Ts | null;
  app_version: string | null;
  last_seen_at: Ts | null;
}

export interface CompaniesTable extends ControlledData {
  id: Id;
  company_id: Generated<Id>;
  owner_group_id: Id;
  code: string;
  name_en: string;
  name_ur: string;
  legal_form: "individual" | "aop" | "company" | null;
  ntn: string | null;
  strn: string | null;
  registration_date: DateText | null;
  fiscal_year_start_month: Generated<bigint>;
  settings_version: Generated<bigint>;
  is_active: Generated<boolean>;
}

export interface LocationsTable extends ControlledData {
  id: Id;
  company_id: Generated<Id>;
  code: string;
  name_en: string;
  name_ur: string;
  kind: "godown" | "shop" | "office";
  authority_kind: "site_node" | "standalone" | "cloud";
  current_node_id: Id | null;
  current_epoch: Generated<bigint>;
  is_active: Generated<boolean>;
}

export interface LocationAuthoritiesTable extends ControlledData {
  id: Id;
  company_id: Generated<Id>;
  location_id: Id;
  node_id: Id;
  epoch: bigint;
  started_at: Ts;
  ended_at: Ts | null;
  reason: string | null;
}

export interface FiscalYearsTable extends ControlledData {
  id: Id;
  company_id: Generated<Id>;
  code: string;
  start_date: DateText;
  end_date: DateText;
  status: Generated<"open" | "closed">;
}

/** Class 1: append-only (document 06, D-2). */
export interface AuditEventsTable {
  id: Id;
  company_id: Generated<Id>;
  user_id: Id | null;
  node_id: Id | null;
  device_id: Id | null;
  entity: string;
  entity_id: Id;
  action: string;
  detail_json: Generated<JsonText>;
  bundle_id: Id;
  created_at: Ts;
}

export interface ApplyGuardTable {
  id: bigint;
  is_open: Generated<boolean>;
}

export interface SchemaMigrationsTable {
  id: bigint;
  name: string;
  checksum: string;
  applied_at: Ts;
}

export interface PlatformDatabase {
  owner_groups: OwnerGroupsTable;
  nodes: NodesTable;
  devices: DevicesTable;
  companies: CompaniesTable;
  locations: LocationsTable;
  location_authorities: LocationAuthoritiesTable;
  fiscal_years: FiscalYearsTable;
  audit_events: AuditEventsTable;
  apply_guard: ApplyGuardTable;
  schema_migrations: SchemaMigrationsTable;
}

/**
 * A query handle over tables the typed model does not describe (the migration runner's own bookkeeping,
 * the schema reader, tests that use fixture tables). Application code uses `ScopedDb` and `InstallationDb`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the point of this type is that the row shapes are not known here
export type UntypedDb = Kysely<Record<string, any>>;
