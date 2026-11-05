import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * BC-01 exit proof (document 10, section 5.1): "a deliberate float, a raw SQL string and a committed
 * fake secret each fail the build". Each violation is planted in a real package file, the real tools
 * are run on it, and the file is removed afterwards. A clean control file must pass, so the proof
 * cannot succeed just because the tools fail on everything.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = "packages/core/src";
const bin = (...p) => join(root, "node_modules", ...p);
const awsKey = ["AKIA", "IOSFODNN7EXAMPLE"].join(""); // built at run time: this file holds no secret

const files = {
  "__proof_clean.ts": "export function mix(a: bigint, b: bigint): bigint {\n  return a / b + a * b;\n}\n",
  "__proof_float.ts": "export const price = 1.5;\n",
  "__proof_division.ts": "export function half(a: number): number {\n  return a / 2;\n}\n",
  "__proof_sql.ts": `export const q = ${JSON.stringify(["SELECT", "*", "FROM", "items"].join(" "))};\n`,
  "__proof_clock.ts": "export const now = Date.now();\n",
  "__proof_company.ts": 'export function all(db: { selectFrom(table: string): unknown }): unknown {\n  return db.selectFrom("items");\n}\n',
  "__proof_secret.ts": `export const cloudKey = ${JSON.stringify(awsKey)};\n`,
};
const path = (name) => `${SRC}/${name}`;
const planted = Object.keys(files);

function plant(names) {
  for (const name of names) writeFileSync(join(root, path(name)), files[name]);
}
function cleanUp() {
  for (const name of planted) rmSync(join(root, path(name)), { force: true });
}
const run = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });

afterAll(cleanUp);

describe("the commit pipeline fails the build on each deliberate violation (BC-01)", () => {
  it("passes a clean file, including bigint division (control)", () => {
    cleanUp();
    plant(["__proof_clean.ts"]);
    const r = run(bin("eslint", "bin", "eslint.js"), [path("__proof_clean.ts")]);
    expect(r.stdout + r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("lint fails every planted violation with the rule that is meant to catch it", () => {
    cleanUp();
    plant(planted.filter((n) => n !== "__proof_clean.ts" && n !== "__proof_secret.ts"));
    const r = run(bin("eslint", "bin", "eslint.js"), ["--format", "json", ...planted.filter((n) => n.startsWith("__proof_") && !["__proof_clean.ts", "__proof_secret.ts"].includes(n)).map(path)]);
    expect(r.status).toBe(1);
    const byFile = new Map(JSON.parse(r.stdout).map((f) => [f.filePath.replaceAll("\\", "/").split("/").pop(), f.messages.map((m) => m.ruleId)]));
    expect(byFile.get("__proof_float.ts")).toContain("mandi/no-floating-point");
    expect(byFile.get("__proof_division.ts")).toContain("mandi/no-floating-point"); // number division, found with type information
    expect(byFile.get("__proof_sql.ts")).toContain("mandi/no-raw-sql");
    expect(byFile.get("__proof_clock.ts")).toContain("mandi/no-ambient-time-random");
    expect(byFile.get("__proof_company.ts")).toContain("mandi/company-context");
  });

  it("the secret scan fails a committed fake secret and names the file", () => {
    cleanUp();
    plant(["__proof_secret.ts"]);
    const r = run(join(root, "tools", "secret-scan", "cli.mjs"), [path("__proof_secret.ts")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("__proof_secret.ts:1");
    expect(r.stderr).toContain("aws-access-key");
    expect(r.stderr).not.toContain(awsKey);
  });

  it("`npm run check` itself exits non-zero and marks the failing steps", () => {
    cleanUp();
    plant(["__proof_float.ts", "__proof_secret.ts"]);
    const r = run(join(root, "tools", "ci", "check.mjs"), ["--offline", "--only", "lint,secret-scan"]);
    expect(r.status).toBe(1);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/lint\s+FAILED/);
    expect(out).toMatch(/secret-scan\s+FAILED/);
    expect(out).toContain("FAILED: lint, secret-scan");
  });

  it("goes back to green once the violations are removed", () => {
    cleanUp();
    expect(planted.some((n) => existsSync(join(root, path(n))))).toBe(false);
    const r = run(join(root, "tools", "ci", "check.mjs"), ["--offline", "--only", "lint,secret-scan"]);
    expect(r.status).toBe(0);
  });
});
