import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist-chrome");

function assert(condition, message) {
  if (!condition) throw new Error(`MV3 application smoke test failed: ${message}`);
}

function read(relativePath) {
  const absolute = path.join(output, relativePath);
  assert(fs.existsSync(absolute), `${relativePath} exists`);
  return fs.readFileSync(absolute, "utf8");
}

const manifest = JSON.parse(read("manifest.json"));
const worker = read(manifest.background.service_worker);
const contentScript = read(manifest.content_scripts[0].js[0]);
const optionsHtml = read(manifest.options_ui.page);
const offscreenHtml = read("src/entries/offscreen/offscreen.html");

assert(worker.includes("openOptionsPage"), "action worker contains options-page behavior");
assert(worker.includes("onMessage"), "service worker contains message listeners");
assert(contentScript.includes("pt-plugin-plus-mv3.css"), "content script loads the generated shadow-DOM stylesheet");
assert(optionsHtml.includes('type="module"'), "options page loads its module entry");
assert(offscreenHtml.includes('type="module"'), "offscreen page loads its module entry");

for (const html of [optionsHtml, offscreenHtml]) {
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (reference.startsWith("data:") || reference.startsWith("http")) continue;
    const base = reference.startsWith("/") ? output : path.dirname(path.join(output, manifest.options_ui.page));
    const target = reference.startsWith("/") ? path.join(base, reference.slice(1)) : path.resolve(base, reference);
    assert(fs.existsSync(target), `HTML asset exists: ${reference}`);
  }
}

const requiredSourceModules = [
  "app/src/entries/options/main.ts",
  "app/src/entries/background/main.ts",
  "app/src/entries/content-script/index.ts",
  "app/src/entries/offscreen/offscreen.ts",
  "app/src/packages/downloader/entity/qBittorrent.ts",
  "app/src/packages/downloader/entity/Transmission.ts",
];
for (const sourceModule of requiredSourceModules) {
  assert(fs.existsSync(path.join(root, sourceModule)), `imported framework module exists: ${sourceModule}`);
}

console.log("MV3 application manifest, entries, and imported framework modules passed smoke checks.");
