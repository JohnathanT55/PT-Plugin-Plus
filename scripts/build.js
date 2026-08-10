const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const output = path.resolve(root, "dist");
const publicDirectory = path.resolve(root, "public");

if (path.dirname(output) !== root || path.basename(output) !== "dist") {
  throw new Error(`Refusing to clean unexpected output path: ${output}`);
}

async function main() {
  fs.rmSync(output, { recursive: true, force: true });
  fs.cpSync(publicDirectory, output, { recursive: true });

  const shared = {
    bundle: true,
    format: "iife",
    target: "chrome116",
    sourcemap: false,
    minify: false,
    legalComments: "none"
  };

  await Promise.all([
    esbuild.build({
      ...shared,
      entryPoints: [path.join(root, "src/background/index.ts")],
      outfile: path.join(output, "js/background.js")
    }),
    esbuild.build({
      ...shared,
      entryPoints: [path.join(root, "src/offscreen/index.ts")],
      outfile: path.join(output, "js/offscreen.js")
    })
  ]);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
