import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assessIcraftSceneSelection,
  assertIcraftSceneCatalog,
  searchIcraftScenes,
  selectIcraftScene,
} from "../contracts/icraft-scene-catalog.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readCatalog() {
  return JSON.parse(await readFile(join(repoRoot, "examples/icraft-scene-catalog.json"), "utf8"));
}

test("the catalog contains an auditable personal-use iCraft scene reference", async () => {
  const catalog = await readCatalog();
  assertIcraftSceneCatalog(catalog);
  assert.equal(catalog.scenes.length, 1);
  const [scene] = catalog.scenes;
  assert.equal(scene.source.kind, "iplayer");
  assert.equal(scene.source.authorizationStatus, "personal-use");
  assert.match(scene.source.uri, /\.iplayer$/);
  assert.ok(scene.source.authorizationEvidence.length >= 2);
  assert.equal(assessIcraftSceneSelection(scene).status, "selectable-with-warning");
});

test("semantic search returns stable catalog entries and selection preserves only a Loom asset reference", async () => {
  const catalog = await readCatalog();
  const results = searchIcraftScenes(catalog, "云");
  assert.deepEqual(results.map((scene) => scene.id), ["icraft-aws-cloud"]);

  const selection = selectIcraftScene(catalog, "icraft-aws-cloud");
  assert.equal(selection.assessment.status, "selectable-with-warning");
  assert.deepEqual(selection.assetReference, {
    id: "icraft-aws-cloud",
    kind: "parametric-scene",
    uri: "https://icraft.gantcloud.com/api/static/templates/AWSCloud.iplayer",
    mediaType: "application/vnd.icraft.iplayer",
    license: "iCraft Player personal use",
  });
  assert.equal("scene" in selection.assetReference, false);
  assert.equal("privateSceneTree" in selection.assetReference, false);
});

test("missing, unconfirmed, and duplicate source records are visible and cannot silently enter a Diagram", async () => {
  const catalog = await readCatalog();
  const base = catalog.scenes[0];
  const missing = { ...base, id: "icraft-missing", availability: "missing" };
  assert.equal(assessIcraftSceneSelection(missing).status, "blocked");
  const missingSelection = selectIcraftScene({ ...catalog, scenes: [missing] }, missing.id);
  assert.equal(missingSelection.assetReference, null);
  assert.deepEqual(missingSelection.assessment.reasons, ["scene source is missing"]);

  const unconfirmed = {
    ...base,
    id: "icraft-unconfirmed",
    source: { ...base.source, authorizationStatus: "unknown" },
  };
  assert.equal(assessIcraftSceneSelection(unconfirmed).status, "blocked");

  assert.throws(
    () => assertIcraftSceneCatalog({ ...catalog, scenes: [base, { ...base }] }),
    /Duplicate iCraft scene ID/,
  );
  assert.throws(
    () => assertIcraftSceneCatalog({ ...catalog, scenes: [{ ...base, source: { ...base.source, uri: "https://example.com/scene.glb" } }] }),
    /\.iplayer reference/,
  );
});

test("the semantic template catalog points to the external iCraft scene catalog without embedding it", async () => {
  const catalog = JSON.parse(await readFile(join(repoRoot, "examples/flovvas-template-catalog.json"), "utf8"));
  assert.deepEqual(catalog.externalSceneCatalogs, [
    { id: "icraft-official-scenes", path: "examples/icraft-scene-catalog.json", renderer: "icraft-player" },
  ]);
  assert.equal(JSON.stringify(catalog).includes("AWSCloud.iplayer"), false);
});
