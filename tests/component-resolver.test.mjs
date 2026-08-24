import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createComponentResolver } from "../core/component-resolver.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

async function fixture() {
  const [catalog, registry, artifact] = await Promise.all([
    readJson("examples/flovvas-template-catalog.json"),
    readJson("examples/flovvas-template-registry.json"),
    readJson("examples/flovvas-massing.diagram.json"),
  ]);
  const manifests = await Promise.all(registry.templates.map((entry) => readJson(entry.path)));
  const capabilities = {
    adapterId: "reference-webgl",
    adapterVersion: "0.1.0",
    projections: ["orthographic"],
    componentKinds: ["parametric-scene", "fallback"],
    interactions: ["pick", "move-plane"],
    exports: ["png"],
    assetFormats: ["glb", "gltf"],
    features: ["orthographic-camera", "instancing"],
  };
  return { artifact, resolver: createComponentResolver({ catalog, registry, manifests, capabilities }) };
}

test("one resolver resolves all seven Golden Templates with match reasons and stable fingerprints", async () => {
  const { artifact, resolver } = await fixture();
  const goldenNodes = artifact.semantic.nodes.filter((node) => node.id.startsWith("stage-"));
  assert.equal(goldenNodes.length, 7);
  const results = goldenNodes.map((node) => resolver.resolveNode(node));
  for (const [index, result] of results.entries()) {
    assert.equal(result.status, "mapped", goldenNodes[index].id);
    assert.equal(result.nodeId, goldenNodes[index].id);
    assert.ok(result.matches.length > 0);
    assert.ok(result.selectedMatch.reasons?.some((reason) => reason.kind === "node-type"));
    assert.deepEqual(result.parameters, resolver.resolveNode(goldenNodes[index]).parameters);
    assert.match(result.parameterFingerprint, /^sha256:[0-9a-f]{64}$/);
  }
  assert.equal(new Set(results.map((result) => result.parameterFingerprint)).size, 7);
});

test("semantic query is retained and capability loss becomes an explicit fallback", async () => {
  const { artifact, resolver } = await fixture();
  const node = artifact.semantic.nodes.find((candidate) => candidate.id === "stage-workbench");
  const result = resolver.resolveNode(node, { semanticQuery: "工作台" });
  assert.equal(result.selectedMatch.templateId, "flovvas-workbench");
  assert.ok(result.selectedMatch.reasons.some((reason) => reason.kind === "semantic-term"));

  const fallbackResolver = createComponentResolver({
    catalog: await readJson("examples/flovvas-template-catalog.json"),
    registry: await readJson("examples/flovvas-template-registry.json"),
    manifests: await Promise.all((await readJson("examples/flovvas-template-registry.json")).templates.map((entry) => readJson(entry.path))),
    capabilities: {
      adapterId: "reference-webgl",
      adapterVersion: "0.1.0",
      projections: ["orthographic"],
      componentKinds: ["parametric-scene", "fallback"],
      interactions: [],
      exports: [],
      assetFormats: [],
      features: ["orthographic-camera"],
    },
  });
  const fallback = fallbackResolver.resolveNode(node);
  assert.equal(fallback.status, "fallback");
  assert.equal(fallback.nodeId, node.id);
  assert.equal(fallback.semanticType, node.type);
  assert.equal(fallback.componentRef, node.componentRef);
  assert.match(fallback.warnings.join(" "), /Missing capabilities: instancing/);
});

test("missing asset availability remains visible and blocks PNG without deleting semantic nodes", async () => {
  const { artifact, resolver } = await fixture();
  const withAsset = structuredClone(artifact);
  withAsset.assets.push({
    id: "asset-authorized-model",
    kind: "gltf-model",
    uri: "/definitely/missing/authorized-model.glb",
    license: "User-owned; local authorization",
  });
  const result = await resolver.resolveArtifact(withAsset);
  assert.equal(result.nodes["stage-line"].nodeId, "stage-line");
  assert.equal(result.pngGate.status, "blocked");
  assert.deepEqual(result.pngGate.error.objectIds, ["asset-authorized-model"]);
  assert.equal(result.assets["asset-authorized-model"].availability.status, "missing");
});

test("invalid parameters produce a structured error while preserving node identity", async () => {
  const { artifact, resolver } = await fixture();
  const node = artifact.semantic.nodes.find((candidate) => candidate.id === "stage-workbench");
  const result = resolver.resolveNode(node, { parameters: { modules: 99 } });
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "unsupported-template");
  assert.equal(result.error.fieldPath, "parameters");
  assert.deepEqual(
    { nodeId: result.nodeId, semanticType: result.semanticType, componentRef: result.componentRef },
    { nodeId: node.id, semanticType: node.type, componentRef: node.componentRef },
  );
});

test("artifact results expose only contract data, never Renderer-private runtime objects", async () => {
  const { artifact, resolver } = await fixture();
  const result = await resolver.resolveArtifact(artifact);
  assert.equal(Object.hasOwn(result, "scene"), false);
  assert.equal(Object.hasOwn(result, "mesh"), false);
  assert.equal(Object.hasOwn(result, "camera"), false);
  assert.equal(Object.keys(result.components).length, 9);
  assert.equal(result.pngGate.status, "ready");
});
