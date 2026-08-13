import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist-chrome");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  assert(fs.existsSync(absolute), `Missing Chrome Web Store artifact: ${relativePath}`);
  return fs.readFileSync(absolute);
}

function readText(relativePath) {
  return read(relativePath).toString("utf8");
}

function pngSize(relativePath) {
  const data = read(relativePath);
  assert(data.length >= 24 && data.subarray(1, 4).toString("ascii") === "PNG", `${relativePath} is not a PNG`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

const manifest = JSON.parse(readText("dist-chrome/manifest.json"));
const privacy = readText("PRIVACY.md");

assert(manifest.manifest_version === 3, "Chrome Web Store package must use Manifest V3");
assert(/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version), "Manifest version is not Web Store compatible");
assert(manifest.version === JSON.parse(readText("package.json")).version, "Manifest and package versions differ");
assert(manifest.minimum_chrome_version, "minimum_chrome_version is required");
assert(manifest.homepage_url?.startsWith("https://"), "homepage_url must use HTTPS");
assert(!manifest.permissions?.includes("activeTab"), "Unused activeTab permission must not ship");
assert(manifest.optional_permissions?.length === 0, "Unexpected optional permissions require review");
assert(manifest.content_security_policy === undefined, "Generated MV3 CSP should use Chrome's secure default");

for (const permission of manifest.permissions ?? []) {
  assert(privacy.includes(`\`${permission}\``), `PRIVACY.md does not explain the ${permission} permission`);
}
assert(privacy.includes("`*://*/*` host access"), "PRIVACY.md does not explain broad host access");

for (const size of [16, 19, 64, 128]) {
  const relativePath = `dist-chrome/${manifest.icons?.[size]}`;
  const dimensions = pngSize(relativePath);
  assert(
    dimensions.width === size && dimensions.height === size,
    `${relativePath} is ${dimensions.width}x${dimensions.height}; expected ${size}x${size}`,
  );
}

for (const locale of ["en", "zh_CN"]) {
  const messages = JSON.parse(readText(`dist-chrome/_locales/${locale}/messages.json`));
  assert(messages.extName?.message, `${locale} locale is missing extName`);
  assert(messages.extDesc?.message, `${locale} locale is missing extDesc`);
}

for (const document of ["README.md", "CHANGELOG.md", "PRIVACY.md", "LICENSE"]) read(document);

const executableFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (/\.(?:html|js|json)$/i.test(entry.name)) executableFiles.push(absolute);
  }
}
walk(output);
for (const absolute of executableFiles) {
  const source = fs.readFileSync(absolute, "utf8");
  const relative = path.relative(root, absolute);
  assert(!/<script[^>]+src=["']https?:/i.test(source), `Remote script found in ${relative}`);
  assert(!/unsafe-eval|\beval\s*\(|new\s+Function\s*\(/.test(source), `Dynamic executable code found in ${relative}`);
}

console.log(
  `Chrome Web Store static audit passed for ${manifest.name} ${manifest.version}: ${manifest.permissions.length} documented permissions, ${executableFiles.length} executable assets, and 4 verified icons.`,
);
