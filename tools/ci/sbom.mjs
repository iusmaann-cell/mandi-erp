import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// SEC-2: a software bill of materials is produced for every release (CycloneDX JSON), using the
// SBOM command built into npm so that no extra package enters the supply chain.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
mkdirSync(join(root, "build-output"), { recursive: true });
const result = spawnSync("npm", ["sbom", "--sbom-format", "cyclonedx", "--sbom-type", "application", "--omit", "dev"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 1 << 28,
  shell: process.platform === "win32",
});
if (result.status !== 0) {
  console.error(result.stderr);
  process.exit(result.status ?? 1);
}
writeFileSync(join(root, "build-output", "sbom.cdx.json"), result.stdout);
console.log(`sbom: wrote build-output/sbom.cdx.json (${result.stdout.length} bytes)`);
