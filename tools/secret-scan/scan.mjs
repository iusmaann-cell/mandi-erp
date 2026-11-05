import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * SEC-1: no secrets in the repository. A scanner runs on every commit; a found secret is treated
 * as leaked and rotated. This one needs nothing installed and behaves the same on Linux and Windows.
 *
 * Silence a line only with:   secret-scan:allow <reason>   on the same line
 * Silence a known file with an entry (path, rule, reason) in .secret-scan.json
 */

const MAX_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules", "build-output", "dist", "coverage", "playwright-report", "test-results"]);
const LOCK_FILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]);
const BARE_VALUE_EXTENSIONS = new Set([".env", ".ini", ".properties", ".yml", ".yaml", ".toml", ".cfg", ".conf", ".sh", ".ps1", ".bat", ".cmd", ".md", ".txt"]);

export const RULES = [
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: "aws-access-key", re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/ },
  { id: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { id: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "stripe-live-key", re: /\b[sr]k_live_[0-9A-Za-z]{16,}\b/ },
  { id: "npm-token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"<>`]+:([^\s@/'"<>`]{4,})@[^\s/'"<>`]+/gi;
const SECRET_NAME = "(?:pass(?:word|wd|phrase)?|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|auth[_-]?key|credential|client[_-]?secret)";
const ASSIGNMENT = new RegExp(
  `(["']?)([A-Za-z0-9_.-]*${SECRET_NAME}[A-Za-z0-9_.-]*)\\1\\s*[:=]\\s*(?:"([^"\\n]{8,})"|'([^'\\n]{8,})'|\`([^\`\\n]{8,})\`|([A-Za-z0-9_\\-+/=.!@#$%^&*]{8,}))`,
  "gi",
);
const PLACEHOLDER = /(\(\?:|^(?:password|passwd|pass|pwd|secret|token)$|change[-_ ]?me|change[-_ ]?it|example|sample|placeholder|dummy|your[-_ ]|<[^>]*>|\$\{|\$\(|%[a-z_]+%|process\.env|import\.meta|os\.environ|getenv|redacted|todo|not[-_ ]?a[-_ ]?secret|xxxx|\*{4,}|^(?:null|none|true|false|undefined|string|number|boolean)$)/i;

function entropy(text) {
  const counts = new Map();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Does this value look like a real secret rather than a name, a path or a placeholder? */
export function looksSecret(value) {
  // Real tokens and generated passwords contain no whitespace; commands, prose and code fragments do.
  // (A pass-phrase with spaces is not caught here: that is a known limit of this check.)
  if (value.length < 8 || /\s/.test(value) || PLACEHOLDER.test(value)) return false;
  if (/^[A-Za-z_.:/-]+$/.test(value)) return value.length >= 20 && entropy(value) >= 3.8; // words and names
  if (/^[./\\~][\w./\\-]*$/.test(value)) return false; // paths
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(value)).length;
  if (value.length >= 16) return entropy(value) >= 3.2;
  return classes >= 3 && entropy(value) >= 2.8;
}

function redact(text) {
  const t = text.length > 4 ? `${text.slice(0, 4)}…` : "…";
  return `${t} (${text.length} chars)`;
}

function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
        if (glob[i + 1] === "/") i += 1;
      } else out += "[^/]*";
    } else out += c.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/** Scan one text. Returns findings { line, rule, preview }. */
export function scanText(text, { bareValues = false, skipGeneric = false } = {}) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const allow = /secret-scan:allow\s*(.*)$/.exec(line);
    if (allow) {
      if (allow[1].replace(/[*/\-\s]+$/, "").trim().length < 3) {
        findings.push({ line: i + 1, rule: "allow-without-reason", preview: "secret-scan:allow needs a reason" });
      }
      return;
    }
    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (m) findings.push({ line: i + 1, rule: rule.id, preview: redact(m[0]) });
    }
    if (skipGeneric) return;
    for (const m of line.matchAll(URL_CREDENTIALS)) {
      if (!PLACEHOLDER.test(m[1])) findings.push({ line: i + 1, rule: "url-credentials", preview: redact(m[1]) });
    }
    for (const m of line.matchAll(ASSIGNMENT)) {
      const quoted = m[3] ?? m[4] ?? m[5];
      const value = quoted ?? m[6];
      if (quoted === undefined && !bareValues) continue;
      if (value !== undefined && looksSecret(value)) {
        findings.push({ line: i + 1, rule: "generic-secret-assignment", preview: `${m[2]} = ${redact(value)}` });
      }
    }
  });
  return findings;
}

function extensionOf(file) {
  const name = file.split("/").pop() ?? "";
  if (name === ".env" || name.startsWith(".env.")) return ".env";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export function loadConfig(root) {
  const file = join(root, ".secret-scan.json");
  if (!existsSync(file)) return { allow: [] };
  const config = JSON.parse(readFileSync(file, "utf8"));
  for (const entry of config.allow ?? []) {
    if (!entry.path || !entry.rule || !entry.reason || entry.reason.trim().length < 10) {
      throw new Error(`.secret-scan.json: every allow entry needs path, rule and a reason of at least 10 characters (${JSON.stringify(entry)})`);
    }
  }
  return config;
}

function listFiles(root) {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 });
    return out.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return walk(root, root);
  }
}

function walk(root, dir) {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) result.push(...walk(root, join(dir, entry.name)));
    } else if (entry.isFile()) {
      result.push(relative(root, join(dir, entry.name)).split(sep).join("/"));
    }
  }
  return result;
}

/**
 * Scan a project folder (tracked and untracked files that are not ignored) or an explicit list of
 * files (paths relative to root). Returns { findings, scanned, allowedByConfig }.
 */
export function scanProject(root, { files } = {}) {
  const config = loadConfig(root);
  const allow = (config.allow ?? []).map((e) => ({ ...e, re: globToRegExp(e.path) }));
  const list = files ?? listFiles(root);
  const findings = [];
  let scanned = 0;
  let allowedByConfig = 0;
  for (const rel of list) {
    const path = rel.split(sep).join("/");
    const name = path.split("/").pop() ?? "";
    if (/^\.env(\..+)?$/.test(name) && name !== ".env.example") {
      findings.push({ path, line: 0, rule: "env-file", preview: "an .env file must not be committed" });
    }
    if (/\.(pem|p12|pfx|jks|keystore)$/i.test(name) || /^id_(rsa|dsa|ecdsa|ed25519)$/.test(name)) {
      findings.push({ path, line: 0, rule: "key-file", preview: "a key or certificate file must not be committed" });
    }
    const full = join(root, path);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_BYTES) continue;
    const buffer = readFileSync(full);
    if (buffer.subarray(0, 8000).includes(0)) continue; // binary
    scanned += 1;
    const text = buffer.toString("utf8");
    for (const f of scanText(text, { bareValues: BARE_VALUE_EXTENSIONS.has(extensionOf(path)), skipGeneric: LOCK_FILES.has(name) })) {
      if (allow.some((e) => e.re.test(path) && e.rule === f.rule)) {
        allowedByConfig += 1;
      } else {
        findings.push({ path, ...f });
      }
    }
  }
  return { findings, scanned, allowedByConfig };
}
