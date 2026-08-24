import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertDiagramArtifact } from "../core/artifact-store.mjs";
import {
  evaluateComponentExportGate,
  importUserGlbReference,
  listComponentEntries,
  replaceNodeComponent,
  searchComponentCatalog,
} from "../workspace/component-panel.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(fileName) {
  return JSON.parse(await readFile(join(repoRoot, fileName), "utf8"));
}

test("Component panel reuses the shared catalog for node-type and semantic search", async () => {
  const catalog = await readJson("examples/flovvas-template-catalog.json");
  const nodeMatches = searchComponentCatalog(catalog, { nodeType: "product-stage" });
  assert.equal(nodeMatches.length, 7);
  assert.equal(nodeMatches[0].kind, "template");
  const semanticMatches = searchComponentCatalog(catalog, { query: "工作台" });
  assert.deepEqual(semanticMatches.map((match) => match.id), ["flovvas-workbench"]);
  const all = searchComponentCatalog(catalog);
  assert.equal(all.length, catalog.templates.length);
});

test("template replacement changes only componentRef and preserves graph identities", async () => {
  const [artifact, catalog] = await Promise.all([
    readJson("examples/flovvas-massing.diagram.json"),
    readJson("examples/flovvas-template-catalog.json"),
  ]);
  const result = replaceNodeComponent(artifact, { nodeId: "stage-line", componentRef: "flovvas-workbench" });
  assert.deepEqual(result.command, {
    type: "semantic.node.update",
    targetId: "stage-line",
    patch: { componentRef: "flovvas-workbench" },
  });
  assert.equal(result.artifact.semantic.nodes.find((node) => node.id === "stage-line").componentRef, "flovvas-workbench");
  assert.deepEqual(result.preserved.edgeIds, artifact.semantic.edges.filter((edge) => edge.source === "stage-line" || edge.target === "stage-line").map((edge) => edge.id));
  assert.deepEqual(result.preserved.groupIds, artifact.semantic.groups.filter((group) => group.children.includes("stage-line")).map((group) => group.id));
  assert.equal(artifact.semantic.nodes.find((node) => node.id === "stage-line").componentRef, "flovvas-line");
  assert.ok(searchComponentCatalog(catalog, { nodeType: "product-stage" }).some((entry) => entry.id === "flovvas-workbench"));
  assert.doesNotThrow(() => assertDiagramArtifact(result.artifact));
});

test("GLB import stores a reference and explicit unconfirmed authorization, never bytes", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const imported = importUserGlbReference(artifact, { fileName: "My Workbench.glb" });
  const asset = imported.artifact.assets.at(-1);
  assert.equal(asset.kind, "gltf-model");
  assert.equal(asset.uri, "My Workbench.glb");
  assert.match(asset.license, /authorization-unconfirmed/);
  assert.equal(Object.hasOwn(asset, "data"), false);
  assert.equal(imported.export.status, "blocked");
  assert.equal(evaluateComponentExportGate(imported.artifact).status, "blocked");
  const attached = replaceNodeComponent(imported.artifact, { nodeId: "stage-line", assetId: asset.id });
  const attachedNode = attached.artifact.semantic.nodes.find((node) => node.id === "stage-line");
  assert.equal(attachedNode.componentRef, "flovvas-line");
  assert.equal(attachedNode.properties.assetRef, asset.id);
  assert.deepEqual(attached.command.patch.properties.assetRef, asset.id);
  assert.doesNotThrow(() => assertDiagramArtifact(imported.artifact));

  const duplicate = importUserGlbReference(imported.artifact, { fileName: "My Workbench.glb" });
  assert.notEqual(duplicate.asset.id, asset.id);
  assert.equal(duplicate.artifact.assets.length, artifact.assets.length + 2);
});

test("GLB references reject embedded data, wrong extensions and unresolved replacement assets", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  assert.throws(() => importUserGlbReference(artifact, { fileName: "model.obj" }), /Only \.glb or \.gltf/);
  assert.throws(() => importUserGlbReference(artifact, { fileName: "model.glb", uri: "data:model/gltf-binary;base64,AAAA" }), /non-embedded/);
  assert.throws(() => replaceNodeComponent(artifact, { nodeId: "stage-line", assetId: "asset-missing" }), /does not resolve/);
  assert.throws(() => replaceNodeComponent(artifact, { nodeId: "stage-line", componentRef: "Not Valid" }), /stable identifier/);
});

test("Workspace wires catalog load, GLB picker and component replacement without JSON editor", async () => {
  const app = await readFile(join(repoRoot, "workspace/workspace-app.mjs"), "utf8");
  assert.match(app, /COMPONENT_CATALOG_URL/);
  assert.match(app, /import-glb-button/);
  assert.match(app, /glbFileInput\.accept/);
  assert.match(app, /importUserGlbReference/);
  assert.match(app, /replaceNodeComponent/);
  assert.match(app, /evaluateComponentExportGate/);
  assert.match(app, /properties\?\.assetRef/);
  assert.doesNotMatch(app, /contenteditable/);
});
