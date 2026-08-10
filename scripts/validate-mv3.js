const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const output = path.join(root, "dist");
const required = [
  "manifest.json",
  "offscreen.html",
  "js/background.js",
  "js/offscreen.js"
];

required.forEach(file => {
  const absolute = path.join(output, file);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Missing MV3 build output: ${file}`);
  }
});

const manifestText = fs.readFileSync(path.join(output, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestText);
if (manifest.manifest_version !== 3) {
  throw new Error("MV3 manifest_version must be 3");
}
if (!manifest.background || manifest.background.service_worker !== "js/background.js") {
  throw new Error("MV3 service worker entry is missing");
}
if (manifestText.indexOf("unsafe-eval") !== -1) {
  throw new Error("MV3 manifest contains unsafe-eval");
}

["js/background.js", "js/offscreen.js"].forEach(file => {
  const source = fs.readFileSync(path.join(output, file), "utf8");
  if (/\beval\s*\(|new\s+Function\s*\(/.test(source)) {
    throw new Error(`Executable dynamic code found in ${file}`);
  }
});

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

walk(output)
  .filter(file => /\.(js|html|json)$/i.test(file))
  .forEach(file => {
    const source = fs.readFileSync(file, "utf8");
    if (/unsafe-eval|\beval\s*\(|new\s+Function\s*\(/.test(source)) {
      throw new Error(
        `Executable dynamic code found in ${path.relative(output, file)}`
      );
    }
  });
