import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRenderDocument } from "../contracts/render-document.mjs";
import { projectOverlays } from "../contracts/overlay-projection.mjs";
import { createPngCaptureRequest } from "../contracts/png-capture.mjs";
import { assertPngComposition, createPngComposition } from "../contracts/png-composition.mjs";
import { projectSceneNodes } from "../contracts/scene-projection.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

async function readFixture() {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const registry = await readJson("examples/flovvas-template-registry.json");
  const catalog = await readJson("examples/flovvas-template-catalog.json");
  const resolved = await Promise.all(registry.templates.map(({ path }) => readJson(path)));
  const resolvedIds = new Set(resolved.map((component) => component.id));
  const document = createRenderDocument(artifact, {
    revision: "sha256:golden-case-v1",
    components: [...resolved, ...catalog.templates.filter((component) => !resolvedIds.has(component.id))],
  });
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
  return {
    artifact,
    document,
    sceneNodes: projectSceneNodes(document, { capabilities }),
    overlays: projectOverlays(document),
  };
}

function options(overrides = {}) {
  return {
    widthPx: 2400,
    heightPx: 900,
    pixelRatio: 2,
    transparentBackground: false,
    includeSafeAreaGuides: false,
    ...overrides,
  };
}

test("composition contains Scene, Route, Phase Zone and Annotation layers at one revision", async () => {
  const { artifact, document, sceneNodes, overlays } = await readFixture();
  const request = createPngCaptureRequest(document, options());
  const composition = createPngComposition(request, { sceneNodes, overlays, composition: artifact.composition });
  assertPngComposition(composition);
  assert.equal(composition.revision, document.revision);
  assert.equal(composition.scene.length, document.semantic.nodes.length);
  assert.equal(composition.routes.length, document.semantic.edges.length);
  assert.equal(composition.phaseZones.length, 4);
  assert.equal(composition.annotations.length, document.annotations.length);
  assert.deepEqual(composition.view, document.effectiveLayout.view);
  assert.deepEqual(composition.editorChrome, []);
  assert.deepEqual(composition.warnings, []);
});

test("missing layers become explicit warnings and editor chrome cannot enter composition", async () => {
  const { artifact, document, sceneNodes, overlays } = await readFixture();
  const request = createPngCaptureRequest(document, options());
  const incomplete = createPngComposition(request, { sceneNodes: null, overlays: null, composition: artifact.composition });
  assert.ok(incomplete.warnings.some((warning) => /scene layer is unavailable/.test(warning)));
  assert.ok(incomplete.warnings.some((warning) => /routes layer is unavailable/.test(warning)));
  assert.ok(incomplete.warnings.some((warning) => /annotations layer is unavailable/.test(warning)));
  assert.equal(incomplete.editorChrome.length, 0);
  assert.throws(
    () => createPngComposition(request, { sceneNodes, overlays: { ...overlays, includeEditorChrome: true }, composition: artifact.composition }),
    /cannot include editor chrome/,
  );
});

test("safe-area guides are opt-in and overlay revision/view mismatches fail", async () => {
  const { artifact, document, sceneNodes, overlays } = await readFixture();
  const request = createPngCaptureRequest(document, options({ includeSafeAreaGuides: true }));
  const composition = createPngComposition(request, { sceneNodes, overlays, composition: artifact.composition });
  assert.equal(composition.safeAreaGuides.length, artifact.composition.safeAreas.length);
  assert.throws(
    () => createPngComposition(request, { sceneNodes, overlays: { ...overlays, revision: "sha256:other" }, composition: artifact.composition }),
    /overlay revision/,
  );
  assert.throws(
    () => createPngComposition(request, { sceneNodes, overlays: { ...overlays, view: { ...overlays.view, zoom: 2 } }, composition: artifact.composition }),
    /overlay view/,
  );
  assert.throws(() => createPngComposition(request, { sceneNodes, overlays }), /composition is required/);
});

test("composition validation rejects a non-empty editor chrome layer or malformed scene node", async () => {
  const { artifact, document, sceneNodes, overlays } = await readFixture();
  const request = createPngCaptureRequest(document, options());
  const composition = createPngComposition(request, { sceneNodes, overlays, composition: artifact.composition });
  const withChrome = structuredClone(composition);
  withChrome.editorChrome.push({ type: "selection-box" });
  assert.throws(() => assertPngComposition(withChrome), /editorChrome must be empty/);
  const withBadScene = structuredClone(composition);
  withBadScene.scene[0].bounds.width = "wide";
  assert.throws(() => assertPngComposition(withBadScene), /bounds.width/);
});
