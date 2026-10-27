import { existsSync, readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`PTD site-definition sync test failed: ${message}`);
}

const definitions = {
  fhpt: readFileSync("app/src/packages/site/definitions/fhpt.ts", "utf8"),
  yzyy: readFileSync("app/src/packages/site/definitions/yzyy.ts", "utf8"),
};

for (const [id, source] of Object.entries(definitions)) {
  assert(existsSync(`app/src/packages/site/definitions/${id}.ts`), `${id} definition exists`);
  assert(source.includes("export const siteMetadata"), `${id} exports site metadata`);
  assert(source.includes(`id: "${id}"`), `${id} keeps a stable site id`);
  assert(!/\b(?:fetch|eval|new Function|import\s*\()\b/.test(source), `${id} has no dynamic remote code`);
}

assert(definitions.fhpt.includes('schema: "NexusPHP"'), "fhpt uses the PTPP NexusPHP schema");
assert(definitions.yzyy.includes('schema: "AbstractPrivateSite"'), "yzyy uses the PTPP private-site schema");
assert(definitions.yzyy.includes("getTorrentDownloadLink"), "yzyy keeps its explicit download-link adapter");
assert(definitions.yzyy.includes('urls: ["uggcf://jjj.lmll.bet/"'), "yzyy keeps obfuscated upstream URLs");

console.log("PTD controlled site-definition sync tests passed.");
