import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist-chrome");
const releases = path.join(root, "releases");
const fixedTimestamp = new Date("2000-01-01T00:00:00.000Z");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(absolute) : [absolute];
    })
    .sort((left, right) => left.localeCompare(right, "en"));
}

assert(fs.existsSync(path.join(output, "manifest.json")), "Run pnpm build before packaging Chrome");
const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
assert(manifest.manifest_version === 3, "Release package must contain a Manifest V3 build");

const files = walk(output);
const zip = new JSZip();
for (const absolute of files) {
  const relative = path.relative(output, absolute).replaceAll("\\", "/");
  zip.file(relative, fs.readFileSync(absolute), {
    date: fixedTimestamp,
    createFolders: false,
    unixPermissions: 0o100644,
  });
}

const archive = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
  platform: "UNIX",
});
const loaded = await JSZip.loadAsync(archive);
const archiveFiles = Object.values(loaded.files).filter((entry) => !entry.dir);
assert(loaded.file("manifest.json"), "Release ZIP must contain manifest.json at its root");
assert(
  archiveFiles.length === files.length,
  `Release ZIP file count changed: ${archiveFiles.length} != ${files.length}`,
);
const archivedManifest = JSON.parse(await loaded.file("manifest.json").async("string"));
assert(archivedManifest.manifest_version === 3, "Archived manifest is not Manifest V3");
assert(archivedManifest.version === manifest.version, "Archived manifest version changed");

fs.mkdirSync(releases, { recursive: true });
const filename = `PT-Plugin-Plus-v${manifest.version}-chrome.zip`;
const archivePath = path.join(releases, filename);
const hash = crypto.createHash("sha256").update(archive).digest("hex");
fs.writeFileSync(archivePath, archive);
fs.writeFileSync(`${archivePath}.sha256`, `${hash}  ${filename}\n`);

console.log(`Created ${path.relative(root, archivePath)} (${files.length} files, ${archive.length} bytes)`);
console.log(`SHA-256 ${hash}`);
