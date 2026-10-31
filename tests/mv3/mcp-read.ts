import assert from "node:assert/strict";
import { createMcpReadCapabilities } from "../../app/src/entries/offscreen/utils/mcpReadCapabilities.ts";

const calls: Array<{ type: string; data: unknown }> = [];
const state = {
  groups: [{ id: "g1", name: "动画", color: "#123456", description: "收藏", count: 1 }],
  defaultGroupId: "g1",
  items: [{ siteId: "audiences", title: "K-On", subTitle: "BD", link: "https://private.example/detail/1", url: "https://private.example/torrent/1", size: 123, groups: ["g1"], time: 10, imdbId: "tt1410218" }],
};
const sendMessage = async (type: string, data?: unknown): Promise<any> => {
  calls.push({ type, data });
  if (type === "getPtppCollectionState") return state;
  if (type === "getDownloadHistory") return [{ id: "h1", siteId: "audiences", title: "K-On", downloaderId: "qb", downloadAt: 20, downloadStatus: "completed", torrent: { title: "K-On", size: 456, link: "https://private.example/torrent/2" }, errorMessage: "request failed at https://private.example/api" }];
  if (type === "getKeepUploadTasks") return [{ id: "task1", title: "K-On", size: 789, time: 30, downloadOptions: { downloaderId: "qb", savePath: "C:\\private" }, items: [{ site: "audiences", title: "K-On", size: 789, url: "magnet:?xt=private" }] }];
  if (type === "getClientTorrents") return { success: true, action: "list", downloaderId: data, data: [{ id: "hash1", name: "K-On", hash: "abc", status: "seeding", progress: 1, size: 100, savePath: "C:\\private" }] };
  if (type === "getExtStorage") return { snap1: { searchResult: [{ site: "audiences", title: "K-On", link: "https://private.example/detail/1", size: 100, seeders: 2 }] } };
  if (type === "getSearchResultSnapshotData") return { searchResult: [{ site: "audiences", title: "K-On", link: "https://private.example/detail/1", size: 100, seeders: 2 }] };
  throw new Error(`unexpected ${type}`);
};

const registry = createMcpReadCapabilities(sendMessage);
assert.deepEqual(registry.descriptors.map((item) => item.id), [
  "ptpp.collections.list",
  "ptpp.download_history.list",
  "ptpp.reseed.list",
  "ptpp.downloaders.torrents",
  "ptpp.snapshots.list",
  "ptpp.snapshots.get",
]);

const collection = await registry.handlers.get("ptpp.collections.list")!({ offset: 0, limit: 1 });
assert.equal(collection.items[0].title, "K-On");
assert.equal("link" in collection.items[0], false);
assert.equal("url" in collection.items[0], false);

const history = await registry.handlers.get("ptpp.download_history.list")!({});
assert.equal(history.items[0].status, "completed");
assert.equal("link" in history.items[0], false);
assert.equal(String(history.items[0].error).includes("http"), false);

const reseed = await registry.handlers.get("ptpp.reseed.list")!({});
assert.equal(reseed.items[0].itemCount, 1);
assert.equal("savePath" in reseed.items[0], false);
assert.equal("url" in reseed.items[0].items[0], false);

const torrents = await registry.handlers.get("ptpp.downloaders.torrents")!({ downloaderId: "qb" });
assert.equal(torrents.items[0].status, "seeding");
assert.equal("savePath" in torrents.items[0], false);

const snapshots = await registry.handlers.get("ptpp.snapshots.list")!({});
assert.equal(snapshots.items[0].snapshotId, "snap1");
const snapshot = await registry.handlers.get("ptpp.snapshots.get")!({ snapshotId: "snap1" });
assert.equal(snapshot.items[0].title, "K-On");
assert.equal("link" in snapshot.items[0], false);

assert.ok(calls.some((call) => call.type === "getClientTorrents"));
console.log("MCP read capability tests passed: collections, history, reseed, downloader torrents and snapshots are projected without URLs or paths.");
