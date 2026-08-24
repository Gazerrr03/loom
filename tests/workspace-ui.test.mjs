import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const indexHtml = await readFile(resolve(root, "workspace/index.html"), "utf8");
const appModule = await readFile(resolve(root, "workspace/workspace-app.mjs"), "utf8");

test("Workspace 壳层声明三个可见协作表面", () => {
  assert.match(indexHtml, /id="component-list"/);
  assert.match(indexHtml, /id="workspace-canvas"/);
  assert.match(indexHtml, /id="inspector-body"/);
  assert.match(indexHtml, /id="workspace-status"/);
  assert.match(indexHtml, /<script type="module" src="\.\/workspace-app\.mjs"><\/script>/);
});

test("Workspace 壳层提供 Diagram 打开与 Golden Case 载入入口", () => {
  assert.match(indexHtml, /id="open-button"/);
  assert.match(indexHtml, /id="load-golden-button"/);
  assert.match(indexHtml, /id="file-input"/);
  assert.match(indexHtml, /accept="\.json,\.diagram\.json,application\/json"/);
  assert.match(appModule, /loadUrl\(GOLDEN_CASE_URL/);
  assert.match(appModule, /handleFile\(file\)/);
});

test("Workspace 只在本地内存中展示 canonical Diagram，并暴露可测试入口", () => {
  assert.match(appModule, /format !== "loom\.diagram"/);
  assert.match(appModule, /schemaVersion !== "0\.1\.0"/);
  assert.match(appModule, /window\.LoomWorkspace/);
  assert.match(appModule, /loadArtifact: \(artifact, fileName\) => setArtifact/);
  assert.doesNotMatch(appModule, /from\s+["']node:/);
  assert.doesNotMatch(appModule, /innerHTML\s*=/);
});
