import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Rewrites the golden files on purpose (TR-11): the data sets, the schema fixture of the newest version and
 * the golden bundles. Read the diff afterwards: a golden file changes only when a rule changed.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const result = spawnSync(process.execPath, [join(root, "node_modules", "vitest", "vitest.mjs"), "run", "--project", "testkit", "--project", "sync"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, UPDATE_FIXTURES: "1", UPDATE_GOLDEN: "1" },
});
process.exit(result.status ?? 1);
