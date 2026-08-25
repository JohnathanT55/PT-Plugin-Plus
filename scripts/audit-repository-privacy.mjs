import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedRoots = ["legacy-mv2/", "dist-chrome/", "dist-firefox/", "node_modules/"];
const rules = [
  {
    label: "private IPv4 address",
    pattern: /\b(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})\b/g,
  },
  {
    label: "local user-profile path",
    pattern:
      /(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\s"'<>]+|\/(?:Users|home)\/[^/\s"'<>]+\/(?:Desktop|Downloads|Documents)(?:\/[^\s"'<>]*)?)/g,
  },
  {
    label: "concrete retention audit directory",
    pattern: /\bptpp-cdp-retention-[a-z0-9]{6,}-[a-z0-9]{6,}\b/gi,
  },
  {
    label: "private key block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    label: "high-confidence access token",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },
];

const repositoryFiles = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
})
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .filter((name) => !excludedRoots.some((prefix) => name.startsWith(prefix)));

const findings = [];
for (const relativePath of repositoryFiles) {
  const buffer = fs.readFileSync(path.join(root, relativePath));
  if (buffer.includes(0)) continue;
  const source = buffer.toString("utf8");
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      findings.push(`${relativePath}:${line}: ${rule.label}`);
    }
  }
}

if (findings.length > 0) {
  throw new Error(`Repository privacy audit failed:\n${findings.join("\n")}`);
}

console.log(`Privacy-audited ${repositoryFiles.length} repository files (legacy archive excluded).`);
