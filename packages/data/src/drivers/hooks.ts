/**
 * A test seam for the crash-point tests (document 09, section 8.6): called after every statement a
 * connection runs. `abandon` drops the connection without committing or rolling back, which is what the
 * database sees when a process dies in the middle of a transaction. Nothing in the product sets it.
 */
export interface StatementInfo {
  readonly sql: string;
  /** 1, 2, 3 ... counted per store from its creation. */
  readonly index: number;
  abandon(): void;
}
export type StatementHook = (info: StatementInfo) => void;
export interface DriverHooks {
  readonly afterStatement?: StatementHook;
}
