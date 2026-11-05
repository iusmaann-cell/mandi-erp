import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { looksSecret, scanProject, scanText } from "./scan.mjs";

// Fake secrets are built at run time so that this file itself holds none (and the scan of the repo stays clean).
const awsKey = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
const ghToken = ["ghp", "_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"].join("");
const privateKeyHeader = ["-----BEGIN ", "RSA PRIVATE KEY", "-----"].join("");
const slackToken = ["xoxb", "-", "123456789012-abcdefghijkl"].join("");
const stripeKey = ["sk", "_live_", "4eC39HqLyjWDarjtT1zdp7dc"].join("");
const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"].join(".");
const strongPassword = ["Zx9!kQ2", "#mV7$pL4wRt"].join("");

const rules = (text, options) => scanText(text, options).map((f) => f.rule);

describe("scanText finds", () => {
  it.each([
    ["an AWS access key", `const k = "${awsKey}";`, "aws-access-key"],
    ["a GitHub token", `token ${ghToken}`, "github-token"],
    ["a private key block", privateKeyHeader, "private-key"],
    ["a Slack token", `SLACK=${slackToken}`, "slack-token"],
    ["a live Stripe key", `const s = '${stripeKey}'`, "stripe-live-key"],
    ["a JWT", `Authorization: Bearer ${jwt}`, "jwt"],
    ["a password inside a URL", `const u = "postgres://app:${strongPassword}@db.example.org:5432/x";`, "url-credentials"],
    ["a quoted secret assignment", `const password = "${strongPassword}";`, "generic-secret-assignment"],
    ["a quoted api key in an object", `{ apiKey: "${strongPassword}" }`, "generic-secret-assignment"],
    ["a quoted key in JSON", `{ "client_secret": "${strongPassword}" }`, "generic-secret-assignment"],
  ])("%s", (_name, line, rule) => {
    expect(rules(line)).toContain(rule);
  });

  it("a bare value in an .env style file, but not in code", () => {
    expect(rules(`DB_PASSWORD=${strongPassword}`, { bareValues: true })).toEqual(["generic-secret-assignment"]);
    expect(rules(`DB_PASSWORD=${strongPassword}`, { bareValues: false })).toEqual([]);
  });

  it("reports the line number and never prints the whole secret", () => {
    const [finding] = scanText(`line one\nconst k = "${awsKey}";`);
    expect(finding?.line).toBe(2);
    expect(finding?.preview).not.toContain(awsKey);
    expect(finding?.preview).toMatch(/AKIA…/);
  });
});

describe("scanText leaves alone", () => {
  it.each([
    ["an environment lookup", "const password = process.env.DB_PASSWORD;"],
    ["a placeholder", 'const password = "change-me-please";'],
    ["a template placeholder", 'const apiKey = "${API_KEY}";'],
    ["a type annotation", "password: SecretString,"],
    ["an identifier-like value", 'const tokenName = "refresh_token";'],
    ["a command", '"secret-scan": "node tools/secret-scan/cli.mjs"'],
    ["a short value", 'const password = "abc";'],
    ["a path", 'const keyFile = "/etc/ssl/private/server.key.pem";'],
    ["a URL without credentials", 'const u = "https://example.org/a/b";'],
    ["a placeholder URL", 'const u = "postgresql://user:password@host:5432/myapp";'],
    ["ordinary words", "The password must be at least ten characters long."],
    ["an integrity hash line (no assignment)", '"integrity": "sha512-Zm9vYmFyYmF6cXV4"'],
  ])("%s", (_name, line) => {
    expect(rules(line, { bareValues: true })).toEqual([]);
  });

  it("looksSecret agrees", () => {
    expect(looksSecret(strongPassword)).toBe(true);
    expect(looksSecret("hello")).toBe(false);
    expect(looksSecret("ChangeMe12345")).toBe(false);
    expect(looksSecret("has some spaces in it 12345")).toBe(false);
    expect(looksSecret("process.env.FOO_BAR_BAZ")).toBe(false);
  });
});

describe("the allow comment", () => {
  it("silences a line when it gives a reason", () => {
    expect(rules(`const k = "${awsKey}"; // secret-scan:allow documented AWS example key`)).toEqual([]);
  });
  it("is itself a finding without a reason", () => {
    expect(rules(`const k = "${awsKey}"; // secret-scan:allow`)).toEqual(["allow-without-reason"]);
  });
});

describe("scanProject", () => {
  const dirs = [];
  const make = (files) => {
    const root = mkdtempSync(join(tmpdir(), "mandi-scan-"));
    dirs.push(root);
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), content);
    }
    return root;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("is clean for ordinary files", () => {
    const root = make({ "a.ts": "export const x = 1;\n", "README.md": "# hello\n" });
    const result = scanProject(root);
    expect(result.findings).toEqual([]);
    expect(result.scanned).toBe(2);
  });

  it("finds a committed fake secret and names the file and line", () => {
    const root = make({ "src/config.ts": `export const key = "${awsKey}";\n` });
    const { findings } = scanProject(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: "src/config.ts", line: 1, rule: "aws-access-key" });
  });

  it("refuses an .env file but accepts .env.example", () => {
    const root = make({ ".env": "A=1\n", ".env.production": "A=1\n", ".env.example": "A=\n" });
    expect(scanProject(root).findings.map((f) => f.path).sort()).toEqual([".env", ".env.production"]);
  });

  it("refuses key and certificate files", () => {
    const root = make({ "certs/server.pem": "x", "id_rsa": "x", "build/app.keystore": "x", "ok/readme.txt": "x" });
    expect(scanProject(root).findings.map((f) => f.rule)).toEqual(["key-file", "key-file", "key-file"]);
  });

  it("reads bare values in .env style files and in notes, not in code files", () => {
    const root = make({ "deploy.env": `DB_PASSWORD=${strongPassword}\n`, "notes.md": `ADMIN_PASSWORD=${strongPassword}\n`, "code.ts": `// DB_PASSWORD=${strongPassword}\n` });
    expect(scanProject(root).findings.map((f) => f.path).sort()).toEqual(["deploy.env", "notes.md"]);
  });

  it("skips binary files and lock files' integrity strings", () => {
    const root = make({ "image.bin": Buffer.from([0, 1, 2, 3, ...Buffer.from(`token = "${strongPassword}"`)]), "package-lock.json": `{"x": {"token": "${strongPassword}"}}\n` });
    expect(scanProject(root).findings).toEqual([]);
  });

  it("still applies the specific rules to lock files", () => {
    const root = make({ "package-lock.json": `{"resolved": "https://x/${awsKey}"}\n` });
    expect(scanProject(root).findings.map((f) => f.rule)).toEqual(["aws-access-key"]);
  });

  it("honours a reasoned allow entry in .secret-scan.json and counts it", () => {
    const root = make({
      "docs/setup.md": `ADMIN_PASSWORD=${strongPassword}\n`,
      ".secret-scan.json": JSON.stringify({ allow: [{ path: "docs/**", rule: "generic-secret-assignment", reason: "throwaway local development password in docs" }] }),
    });
    const result = scanProject(root);
    expect(result.findings).toEqual([]);
    expect(result.allowedByConfig).toBe(1);
  });

  it("does not let an allow entry cover a different rule", () => {
    const root = make({
      "docs/setup.md": `key ${awsKey}\n`,
      ".secret-scan.json": JSON.stringify({ allow: [{ path: "docs/**", rule: "generic-secret-assignment", reason: "throwaway local development password in docs" }] }),
    });
    expect(scanProject(root).findings.map((f) => f.rule)).toEqual(["aws-access-key"]);
  });

  it("rejects an allow entry without a real reason", () => {
    const root = make({ "a.txt": "x", ".secret-scan.json": JSON.stringify({ allow: [{ path: "a.txt", rule: "private-key", reason: "ok" }] }) });
    expect(() => scanProject(root)).toThrow(/reason/);
  });

  it("scans an explicit list of files when given one", () => {
    const root = make({ "a.ts": `const k = "${awsKey}";\n`, "b.ts": "const x = 1;\n" });
    expect(scanProject(root, { files: ["b.ts"] }).findings).toEqual([]);
    expect(scanProject(root, { files: ["a.ts"] }).findings).toHaveLength(1);
  });
});

describe("the command line", () => {
  const cli = join(dirname(fileURLToPath(import.meta.url)), "cli.mjs");
  it("exits 1 with a message on a finding, and 0 when clean", () => {
    const root = mkdtempSync(join(tmpdir(), "mandi-cli-"));
    try {
      writeFileSync(join(root, "clean.ts"), "export const a = 1;\n");
      expect(spawnSync(process.execPath, [cli, "--root", root], { encoding: "utf8" }).status).toBe(0);
      writeFileSync(join(root, "leak.ts"), `export const k = "${ghToken}";\n`);
      const bad = spawnSync(process.execPath, [cli, "--root", root], { encoding: "utf8" });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("leak.ts:1");
      expect(bad.stderr).toContain("github-token");
      expect(bad.stderr).not.toContain(ghToken);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
