import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertRenderDocument, createRenderDocument } from "../contracts/render-document.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

async function readFixture() {
  return readJson("examples/flovvas-massing.diagram.json");
}

async function readComponents() {
  const registry = await readJson("examples/flovvas-template-registry.json");
  const catalog = await readJson("examples/flovvas-template-catalog.json");
  const resolved = await Promise.all(registry.templates.map(({ path }) => readJson(path)));
  const resolvedIds = new Set(resolved.map((component) => component.id));
  return [
    ...resolved,
    ...catalog.templates.filter((component) => !resolvedIds.has(component.id)),
  ];
}

test("RenderDocument resolves effective layout without exposing source layers", async () => {
  const artifact = await readFixture();
  const document = createRenderDocument(artifact, {
    revision: "sha256:golden-case-v1",
    components: await readComponents(),
  });

  assert.deepEqual(Object.keys(document).sort(), [
    "annotations",
    "artifactId",
    "assets",
    "components",
    "composition",
    "effectiveLayout",
    "exportCamera",
    "presentation",
    "revision",
    "semantic",
  ]);
  assert.equal(document.artifactId, artifact.id);
  assert.equal(document.revision, "sha256:golden-case-v1");
  assert.equal(document.effectiveLayout.nodes["stage-workbench"].x, 522);
  assert.equal(document.effectiveLayout.nodes["stage-workbench"].y, 35);
  assert.equal(document.effectiveLayout.view.projection, "orthographic");
  assert.deepEqual(document.exportCamera, {
    projection: "orthographic",
    preset: "isometric",
    azimuthDeg: 45,
    elevationDeg: 35.264,
    target: { x: 0, y: 0 },
    orthoScale: 1,
  });
  assert.equal(document.components["flovvas-workbench"].id, "flovvas-workbench");
  assert.equal(document.assets["asset-card-slab"].uri, "loom://builtin/primitive/card-slab");
  assert.equal("layout" in document, false);
  assert.equal("generated" in document.effectiveLayout, false);
  assert.equal("overrides" in document.effectiveLayout, false);
});

test("RenderDocument is isolated and read-only for an Adapter", async () => {
  const artifact = await readFixture();
  const document = createRenderDocument(artifact, {
    revision: "sha256:golden-case-v1",
    components: await readComponents(),
  });

  assert.throws(() => {
    document.semantic.nodes[0].label = "mutated";
  }, TypeError);
  assert.equal(artifact.semantic.nodes[0].label, "LINE");
  assert.doesNotThrow(() => assertRenderDocument(document));
});

test("RenderDocument rejects missing component resolution and revision", async () => {
  const artifact = await readFixture();
  const components = await readComponents();
  const incomplete = components.filter((component) => component.id !== "flovvas-line");

  assert.throws(
    () => createRenderDocument(artifact, { revision: "sha256:test", components: incomplete }),
    /component is missing: flovvas-line/,
  );
  assert.throws(
    () => createRenderDocument(artifact, { components }),
    /revision must be a non-empty string/,
  );
  assert.throws(
    () => createRenderDocument(artifact, { revision: "sha256:test", components, assets: [] }),
    /asset is missing: asset-card-slab/,
  );
});
