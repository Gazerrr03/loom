import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRenderDocument } from "../contracts/render-document.mjs";
import {
  assertIcraftSceneMapping,
  resolveIcraftSceneMapping,
} from "../contracts/icraft-scene-mapping.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

async function readDocument() {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const registry = await readJson("examples/flovvas-template-registry.json");
  const catalog = await readJson("examples/flovvas-template-catalog.json");
  const resolved = await Promise.all(registry.templates.map(({ path }) => readJson(path)));
  const resolvedIds = new Set(resolved.map((component) => component.id));
  return createRenderDocument(artifact, {
    revision: "sha256:golden-case-v1",
    components: [
      ...resolved,
      ...catalog.templates.filter((component) => !resolvedIds.has(component.id)),
    ],
  });
}

function capabilities() {
  return {
    adapterId: "icraft-player",
    adapterVersion: "public-player-api",
    projections: ["orthographic", "perspective"],
    componentKinds: ["parametric-scene", "fallback"],
    interactions: ["pick", "orbit-view"],
    exports: ["png"],
    assetFormats: ["iplayer"],
    features: ["scene-load", "remote-iplayer", "orthographic-camera", "png-export"],
  };
}

async function readMapping() {
  return readJson("examples/icraft-scene-mapping.json");
}

function sceneElements(mapping) {
  return mapping.nodes.map(({ elementKey }) => ({ elementKey }));
}

test("the mapping joins every public scene element to stable Loom identity and overlays", async () => {
  const document = await readDocument();
  const mapping = await readMapping();
  const result = resolveIcraftSceneMapping(document, mapping, {
    capabilities: capabilities(),
    sceneElements: sceneElements(mapping),
  });

  assert.equal(result.status, "ready");
  assert.equal(result.coordinateSpace, "diagram");
  assert.equal(result.sceneNodes.length, mapping.nodes.length);
  assert.deepEqual(result.sceneNodes.map(({ nodeId }) => nodeId), document.semantic.nodes.map(({ id }) => id));
  assert.equal(result.overlays.routes.length, document.semantic.edges.length);
  assert.equal(result.overlays.phaseZones.length, 4);
  assert.equal(result.overlays.annotations.length, document.annotations.length);
  assert.deepEqual(result.unmappedLoomNodeIds, []);
  const workbench = result.sceneNodes.find(({ nodeId }) => nodeId === "stage-workbench");
  assert.equal(workbench.componentRef, "flovvas-workbench");
  assert.deepEqual(workbench.warnings, []);
});

test("reloading the same revision is stable while a view change stays in Diagram space", async () => {
  const document = await readDocument();
  const mapping = await readMapping();
  const first = resolveIcraftSceneMapping(document, mapping, {
    capabilities: capabilities(),
    sceneElements: sceneElements(mapping),
  });
  const reloaded = resolveIcraftSceneMapping(structuredClone(document), structuredClone(mapping), {
    capabilities: capabilities(),
    sceneElements: sceneElements(mapping),
  });
  assert.deepEqual(reloaded, first);

  const viewed = structuredClone(document);
  viewed.effectiveLayout.view = { ...viewed.effectiveLayout.view, preset: "perspective", scale: 1.25 };
  const changed = resolveIcraftSceneMapping(viewed, mapping, {
    capabilities: capabilities(),
    sceneElements: sceneElements(mapping),
  });
  assert.equal(changed.view.preset, "perspective");
  assert.equal(changed.view.scale, 1.25);
  assert.deepEqual(changed.sceneNodes.map(({ nodeId }) => nodeId), first.sceneNodes.map(({ nodeId }) => nodeId));
  assert.equal(changed.overlays.coordinateSpace, "diagram");
});

test("missing, duplicate, and inconsistent mapping inputs return structured errors", async () => {
  const document = await readDocument();
  const mapping = await readMapping();

  const missing = resolveIcraftSceneMapping(document, mapping, {
    capabilities: capabilities(),
    sceneElements: sceneElements(mapping).slice(1),
  });
  assert.equal(missing.status, "error");
  assert.equal(missing.error.code, "dangling-reference");

  const duplicate = structuredClone(mapping);
  duplicate.nodes[1].elementKey = duplicate.nodes[0].elementKey;
  const duplicateResult = resolveIcraftSceneMapping(document, duplicate, {
    capabilities: capabilities(),
    sceneElements: sceneElements(mapping),
  });
  assert.equal(duplicateResult.status, "error");
  assert.equal(duplicateResult.error.code, "duplicate-id");

  const inconsistent = structuredClone(mapping);
  inconsistent.nodes[0].componentRef = "flovvas-branch";
  const inconsistentResult = resolveIcraftSceneMapping(document, inconsistent, {
    capabilities: capabilities(),
    sceneElements: sceneElements(mapping),
  });
  assert.equal(inconsistentResult.status, "error");
  assert.equal(inconsistentResult.error.code, "invalid-tool-input");
  assert.deepEqual(inconsistentResult.error.objectIds, ["stage-line"]);
});

test("mapping validation rejects duplicate Loom identities before projection", async () => {
  const mapping = await readMapping();
  const duplicate = structuredClone(mapping);
  duplicate.nodes[1].nodeId = duplicate.nodes[0].nodeId;

  assert.throws(
    () => assertIcraftSceneMapping(duplicate),
    (error) => error.code === "duplicate-id" && error.objectIds.includes("stage-line"),
  );
});
