import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertAssetReference,
  evaluatePngAssetGate,
  inspectAssetAvailability,
  inspectAssets,
} from "../contracts/asset-reference.mjs";

test("built-in and user GLB references validate without embedding binary bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loom-assets-"));
  const glbPath = join(directory, "workbench.glb");
  await writeFile(glbPath, "placeholder model bytes");
  const builtin = {
    id: "asset-card-slab",
    kind: "primitive",
    uri: "loom://builtin/primitive/card-slab",
    license: "Loom built-in",
  };
  const userAsset = {
    id: "asset-user-workbench",
    kind: "gltf-model",
    uri: glbPath,
    license: "User-owned; local authorization",
  };

  assert.doesNotThrow(() => assertAssetReference(builtin));
  assert.doesNotThrow(() => assertAssetReference(userAsset));
  assert.equal((await inspectAssetAvailability(builtin)).status, "available");
  assert.equal((await inspectAssetAvailability(userAsset)).status, "available");
});

test("missing local assets remain addressable and produce a precise warning", async () => {
  const asset = {
    id: "asset-missing-workbench",
    kind: "gltf-model",
    uri: "/path/that/does/not/exist/workbench.glb",
    license: "User-owned",
  };
  const result = await inspectAssetAvailability(asset);
  assert.equal(result.status, "missing");
  assert.equal(result.assetId, asset.id);
  assert.match(result.warning, /unavailable/);

  const gate = evaluatePngAssetGate([asset], [result]);
  assert.equal(gate.status, "blocked");
  assert.deepEqual(gate.error.objectIds, [asset.id]);
  assert.equal(gate.error.fieldPath, "assets");
});

test("PNG is ready only when every referenced source is available", () => {
  const assets = [
    { id: "asset-one", kind: "primitive", uri: "loom://builtin/one", license: "Loom" },
    { id: "asset-two", kind: "image", uri: "loom://builtin/two", license: "Loom" },
  ];
  const availability = assets.map((asset) => ({ assetId: asset.id, status: "available" }));
  assert.deepEqual(evaluatePngAssetGate(assets, availability), { status: "ready", warnings: [], error: null });
});

test("embedded data, missing license, and wrong model extension are rejected", () => {
  assert.throws(() => assertAssetReference({ id: "asset-data", kind: "image", uri: "data:model/gltf-binary;base64,AAAA", license: "x" }), /must not embed/);
  assert.throws(() => assertAssetReference({ id: "asset-no-license", kind: "image", uri: "loom://builtin/image" }), /license is required/);
  assert.throws(() => assertAssetReference({ id: "asset-wrong-ext", kind: "gltf-model", uri: "loom://builtin/model.obj", license: "x" }), /\.glb or \.gltf/);
});

test("asset collections reject duplicate IDs before availability checks", async () => {
  const assets = [
    { id: "asset-duplicate", kind: "primitive", uri: "loom://builtin/one", license: "Loom" },
    { id: "asset-duplicate", kind: "primitive", uri: "loom://builtin/two", license: "Loom" },
  ];
  await assert.rejects(() => inspectAssets(assets), /Duplicate asset ID/);
});
