import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist-chrome");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function outputPath(relativePath) {
  const absolute = path.resolve(output, relativePath);
  assert(
    absolute === output || absolute.startsWith(output + path.sep),
    `Build entry escapes dist-chrome: ${relativePath}`,
  );
  return absolute;
}

function requireOutput(relativePath) {
  const absolute = outputPath(relativePath);
  assert(fs.existsSync(absolute), `Missing MV3 build output: ${relativePath}`);
  return absolute;
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

requireOutput("manifest.json");
const manifestText = fs.readFileSync(path.join(output, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestText);

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.homepage_url === "https://github.com/JohnathanT55/PT-Plugin-Plus", "Unexpected homepage_url");
assert(manifest.background?.service_worker, "MV3 service worker entry is missing");
assert(manifest.options_ui?.page && manifest.options_ui.open_in_tab === true, "Options page must open in a tab");
assert(manifest.action?.default_icon, "Extension action is missing");
assert(manifest.permissions?.includes("offscreen"), "Chrome offscreen permission is missing");
assert(manifest.permissions?.includes("storage"), "Storage permission is missing");
assert(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0, "Content script is missing");
assert(manifestText.indexOf("unsafe-eval") === -1, "Manifest contains unsafe-eval");

requireOutput(manifest.background.service_worker);
requireOutput(manifest.options_ui.page);
manifest.content_scripts.forEach((entry) => entry.js.forEach(requireOutput));
requireOutput("src/entries/offscreen/offscreen.html");
requireOutput("_locales/en/messages.json");
requireOutput("_locales/zh_CN/messages.json");
requireOutput("icons/logo/128.png");
requireOutput("pt-plugin-plus-mv3.css");

const accessibleResources = manifest.web_accessible_resources.flatMap((entry) => entry.resources ?? []);
assert(accessibleResources.includes("pt-plugin-plus-mv3.css"), "Content-script stylesheet is not web accessible");

const files = walk(output);
for (const file of files.filter((candidate) => /\.(js|html|json)$/i.test(candidate))) {
  const source = fs.readFileSync(file, "utf8");
  assert(
    !/unsafe-eval|\beval\s*\(|new\s+Function\s*\(/.test(source),
    `Executable dynamic code found in ${path.relative(output, file)}`,
  );
  if (/\.html$/i.test(file)) {
    assert(!/<script[^>]+src=["']https?:/i.test(source), `Remote script found in ${path.relative(output, file)}`);
  }
}

const workerSource = fs.readFileSync(outputPath(manifest.background.service_worker), "utf8");
assert(workerSource.includes("ptppMigrationKey"), "PTPP download-history migration is missing from worker bundle");
assert(workerSource.includes("searchResultSnapshot"), "PTPP search-snapshot migration is missing from worker bundle");
assert(workerSource.includes("keepUploadTask"), "PTPP keep-upload migration is missing from worker bundle");

const requiredSiteChunks = [
  "audiences",
  "azusa",
  "hdkylin",
  "hdsky",
  "hdtime",
  "kamept",
  "mteam",
  "pttime",
  "skyeysnow",
  "u2",
];
const outputNames = files.map((file) => path.relative(output, file).replaceAll("\\", "/"));
for (const siteId of requiredSiteChunks) {
  assert(
    outputNames.some((name) => name.startsWith(`vendor/packages/site/definitions/${siteId}-`) && name.endsWith(".js")),
    `Required site definition was not bundled: ${siteId}`,
  );
}

const zhMessages = JSON.parse(fs.readFileSync(path.join(output, "_locales/zh_CN/messages.json"), "utf8"));
assert(zhMessages.extName?.message === "PT 助手 Plus MV3", "Chinese extension name was not generated");
assert(
  zhMessages.contextMenuSendToSiteDefault?.message?.includes("站点默认配置"),
  "Site-default downloader context-menu localization was not generated",
);

console.log(`Validated ${files.length} MV3 output files in dist-chrome.`);
