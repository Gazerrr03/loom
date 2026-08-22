import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("iCraft spike record keeps capability and authorization conclusions separate", async () => {
  const requirements = await readFile(join(repoRoot, "AI Native 3D Diagram Workspace MVP 需求池.md"), "utf8");
  const contract = await readFile(join(repoRoot, "contracts/renderer-contract.md"), "utf8");
  for (const boundary of ["create", "update", "reopen", "export", "authorization"]) {
    assert.match(requirements, new RegExp(`\\| ${boundary}：`));
    assert.match(contract, new RegExp(`\\| ${boundary} \\|`));
  }
  assert.match(requirements, /聚合结论：`partial`/);
  assert.match(requirements, /自动创建、更新并保存 iCraft 场景.*`no-go`/s);
  assert.match(contract, /Reference Renderer 保持默认主路径/);
  assert.match(contract, /书面授权/);
});

test("iCraft evidence cites official capability and license sources", async () => {
  const requirements = await readFile(join(repoRoot, "AI Native 3D Diagram Workspace MVP 需求池.md"), "utf8");
  for (const source of [
    "https://icraft.gantcloud.com/blog/mermaid",
    "https://icraft.gantcloud.com/player-javascript/api",
    "https://github.com/gantFDT/icraft/blob/main/LICENSE",
    "https://icraft.gantcloud.com/pricing",
  ]) {
    assert.match(requirements, new RegExp(source.replaceAll(".", "\\.")));
  }
});
