import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRenderDocument } from "../contracts/render-document.mjs";
import { assertSceneNode, projectSceneNodes } from "../contracts/scene-projection.mjs";

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
  const components = [
    ...resolved,
    ...catalog.templates.filter((component) => !resolvedIds.has(component.id)),
  ];
  return createRenderDocument(artifact, {
    revision: "sha256:golden-case-v1",
    components,
  });
}

function capabilities(overrides = {}) {
  return {
    adapterId: "reference-webgl",
    adapterVersion: "0.1.0",
    projections: ["orthographic"],
    componentKinds: ["parametric-scene", "fallback"],
    interactions: ["pick", "move-plane", "rotate-y"],
    exports: ["png"],
    assetFormats: ["glb", "gltf"],
    features: ["orthographic-camera", "instancing"],
    ...overrides,
  };
}

test("scene projection is stable and exposes Effective Layout transforms", async () => {
  const document = await readDocument();
  const first = projectSceneNodes(document, { capabilities: capabilities() });
  const second = projectSceneNodes(document, { capabilities: capabilities() });

  assert.deepEqual(first, second);
  assert.equal(first.length, document.semantic.nodes.length);
  const workbench = first.find((node) => node.nodeId === "stage-workbench");
  assert.equal(workbench.status, "mapped");
  assert.equal(workbench.componentRef, "flovvas-workbench");
  assert.equal(workbench.bounds.x, 522);
  assert.deepEqual(workbench.worldBounds, { x: 522, y: 10, z: 35, width: 82, depth: 58 });
  assert.equal(workbench.elevation, 10);
  assert.equal(workbench.rotationYDeg, -4);
  assert.equal(workbench.scale, 1);
  assert.equal(workbench.zIndex, 70);
  assert.equal(workbench.parameters.modules, 5);
  first.forEach(assertSceneNode);
});

test("identity-only generic components produce an explicit neutral fallback", async () => {
  const document = await readDocument();
  const nodes = projectSceneNodes(document, { capabilities: capabilities() });
  const input = nodes.find((node) => node.nodeId === "input-files");

  assert.equal(input.status, "fallback");
  assert.equal(input.sourceComponentRef, "generic-input-plinth");
  assert.equal(input.componentRef, "generic-input-plinth");
  assert.equal(input.implementationRef, "builtin://fallback/generic-input-plinth");
  assert.match(input.warnings[0], /neutral fallback/);
});

test("missing mapping or capability stays visible as a labelled fallback", async () => {
  const document = await readDocument();
  const nodes = projectSceneNodes(document, {
    capabilities: capabilities({ adapterId: "unknown-adapter", features: [] }),
  });
  const workbench = nodes.find((node) => node.nodeId === "stage-workbench");

  assert.equal(workbench.status, "fallback");
  assert.equal(workbench.componentRef, "generic-card-slab");
  assert.ok(workbench.warnings.length > 0);
  assert.equal(workbench.error, null);
});

test("a missing Effective Layout entry fails before projection", async () => {
  const document = await readDocument();
  const incomplete = structuredClone(document);
  delete incomplete.effectiveLayout.nodes["stage-line"];

  assert.throws(
    () => projectSceneNodes(incomplete, { capabilities: capabilities() }),
    (error) => error.code === "invalid-layout" && error.objectIds.includes("stage-line"),
  );
});
