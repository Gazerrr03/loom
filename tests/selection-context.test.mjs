import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createComponentResolver } from "../core/component-resolver.mjs";
import {
  createSelectionContext,
  proposeComponentReplacement,
  queryReplacementCandidates,
} from "../workspace/selection-context.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

async function fixture() {
  const [artifact, catalog, registry] = await Promise.all([
    readJson("examples/flovvas-massing.diagram.json"),
    readJson("examples/flovvas-template-catalog.json"),
    readJson("examples/flovvas-template-registry.json"),
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
  const resolver = createComponentResolver({ catalog, registry, manifests, capabilities });
  return { artifact, catalog, resolver };
}

test("node, edge, group and annotation selection expose one inspector context", async () => {
  const { artifact, catalog, resolver } = await fixture();
  for (const selection of [
    { kind: "node", id: "stage-line" },
    { kind: "edge", id: "edge-split" },
    { kind: "group", id: "phase-conversation" },
    { kind: "annotation", id: "annotation-thesis" },
  ]) {
    const context = createSelectionContext(artifact, selection, { catalog, resolver });
    assert.deepEqual(context.selection, selection);
    assert.equal(context.inspector.id, selection.id);
    assert.equal(context.inspector.kind, selection.kind);
    assert.equal(context.canReplaceComponent, selection.kind === "node");
  }
});

test("node selection shares the Resolver result and component search reasons", async () => {
  const { artifact, catalog, resolver } = await fixture();
  const context = createSelectionContext(artifact, { kind: "node", id: "stage-workbench" }, {
    catalog,
    resolver,
    semanticQuery: "工作台",
  });
  assert.equal(context.componentResolution.status, "mapped");
  assert.equal(context.componentResolution.nodeId, "stage-workbench");
  assert.ok(context.componentCandidates.some((candidate) => candidate.id === "flovvas-workbench"));
  assert.ok(context.componentCandidates.find((candidate) => candidate.id === "flovvas-workbench").reasons.some((reason) => reason.kind === "semantic-term"));
  const queried = queryReplacementCandidates(catalog, { nodeType: "product-stage", semanticQuery: "分支", resolver });
  assert.equal(queried[0].id, "flovvas-branch");
  assert.ok(queried[0].manifest.parametersSchema);
});

test("user GLB asset candidates preserve path/license and remain export-blocked in MVP", async () => {
  const { artifact, catalog, resolver } = await fixture();
  const withAsset = structuredClone(artifact);
  withAsset.assets.push({
    id: "asset-user-model",
    kind: "gltf-model",
    uri: "file:///Users/example/model.glb",
    license: "User-owned; local authorization",
  });
  const context = createSelectionContext(withAsset, { kind: "node", id: "stage-line" }, {
    catalog,
    resolver,
    assetAvailability: [{ assetId: "asset-user-model", status: "available", sourceKind: "local-file-url" }],
  });
  const candidate = context.assetCandidates.find((entry) => entry.id === "asset-user-model");
  assert.equal(candidate.preview.status, "available");
  assert.equal(candidate.assetReference.uri, "file:///Users/example/model.glb");
  assert.equal(candidate.export.status, "blocked");
});

test("replacement proposal is immutable, explicit, and accepts either a template or an asset", async () => {
  const { artifact } = await fixture();
  const templateProposal = proposeComponentReplacement(artifact, {
    nodeId: "stage-line",
    componentRef: "flovvas-branch",
    parameters: { cardCount: 4 },
  });
  assert.deepEqual(templateProposal, {
    type: "component.replace",
    targetId: "stage-line",
    baseComponentRef: "flovvas-line",
    nextComponentRef: "flovvas-branch",
    assetId: null,
    parameters: { cardCount: 4 },
  });
  const assetArtifact = structuredClone(artifact);
  assetArtifact.assets.push({ id: "asset-user-model", kind: "gltf-model", uri: "model.glb", license: "User-owned" });
  const assetProposal = proposeComponentReplacement(assetArtifact, { nodeId: "stage-line", assetId: "asset-user-model" });
  assert.equal(assetProposal.assetId, "asset-user-model");
  assert.equal(assetArtifact.semantic.nodes.find((node) => node.id === "stage-line").componentRef, "flovvas-line");
  assert.throws(() => proposeComponentReplacement(artifact, { nodeId: "stage-line" }), /exactly one/);
});

test("missing selection target fails before a misleading Inspector is shown", async () => {
  const { artifact } = await fixture();
  assert.throws(() => createSelectionContext(artifact, { kind: "node", id: "missing-node" }), /does not resolve/);
  assert.throws(() => createSelectionContext(artifact, { kind: "edge", id: "stage-line" }), /does not resolve/);
});
