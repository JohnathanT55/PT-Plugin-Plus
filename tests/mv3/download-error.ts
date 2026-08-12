import assert from "node:assert/strict";

import { sanitizeDownloadErrorMessage } from "../../app/src/entries/shared/downloadError.ts";

assert.equal(
  sanitizeDownloadErrorMessage(new Error("Downloader rejected the torrent")),
  "Downloader rejected the torrent",
);

const sensitiveMessage = sanitizeDownloadErrorMessage(
  "Request https://tracker.example/download.php?passkey=real-secret failed; Authorization: Bearer auth-secret",
);
assert.equal(sensitiveMessage.includes("tracker.example"), false);
assert.equal(sensitiveMessage.includes("real-secret"), false);
assert.equal(sensitiveMessage.includes("auth-secret"), false);
assert.match(sensitiveMessage, /\[redacted URL\]/);
assert.match(sensitiveMessage, /Authorization: \[redacted\]/);

const structuredMessage = sanitizeDownloadErrorMessage({
  message: "Connection refused",
  cookie: "session=private",
  password: "downloader-password",
  nested: { token: "api-token" },
});
assert.equal(structuredMessage.includes("private"), false);
assert.equal(structuredMessage.includes("downloader-password"), false);
assert.equal(structuredMessage.includes("api-token"), false);
assert.match(structuredMessage, /Connection refused/);

assert.equal(sanitizeDownloadErrorMessage("x".repeat(2500)).length, 2000);

console.log("Download error sanitization tests passed.");
