import { resolve } from "node:path";
import { scanProject } from "./scan.mjs";

// usage: node tools/secret-scan/cli.mjs [--root <dir>] [--json] [file ...]
const args = process.argv.slice(2);
let root = process.cwd();
let json = false;
const files = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--root") root = resolve(args[++i]);
  else if (args[i] === "--json") json = true;
  else files.push(args[i]);
}
const { findings, scanned, allowedByConfig } = scanProject(root, files.length > 0 ? { files } : {});
if (json) {
  console.log(JSON.stringify({ scanned, allowedByConfig, findings }, null, 2));
} else if (findings.length === 0) {
  console.log(`secret-scan: ${scanned} files scanned, no secrets found (${allowedByConfig} allow-listed)`);
} else {
  for (const f of findings) console.error(`${f.path}:${f.line}  [${f.rule}]  ${f.preview}`);
  console.error(`\nsecret-scan: ${findings.length} finding(s). A secret found in the repository is treated as leaked: rotate it, then remove it (SEC-1).`);
}
process.exit(findings.length === 0 ? 0 : 1);
