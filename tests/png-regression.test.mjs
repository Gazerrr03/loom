import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRenderDocument } from "../contracts/render-document.mjs";
import { projectOverlays } from "../contracts/overlay-projection.mjs";
import { createPngCaptureRequest } from "../contracts/png-capture.mjs";
import { createPngComposition } from "../contracts/png-composition.mjs";
import { createPngExportPreset, captureOptionsFromPreset } from "../contracts/png-presets.mjs";
import {
  assertPngRegressionEvidence,
  comparePngRegressionEvidence,
  createPngRegressionEvidence,
} from "../contracts/png-regression.mjs";
import { projectSceneNodes } from "../contracts/scene-projection.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

async function fixture() {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const registry = await readJson("examples/flovvas-template-registry.json");
  const catalog = await readJson("examples/flovvas-template-catalog.json");
  const resolved = await Promise.all(registry.templates.map(({ path }) => readJson(path)));
  const ids = new Set(resolved.map((component) => component.id));
  const document = createRenderDocument(artifact, {
    revision: "sha256:golden-case-v1",
    components: [...resolved, ...catalog.templates.filter((component) => !ids.has(component.id))],
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
  const preset = createPngExportPreset(artifact.composition);
  const request = createPngCaptureRequest(document, captureOptionsFromPreset(preset));
  const composition = createPngComposition(request, {
    sceneNodes: projectSceneNodes(document, { capabilities }),
    overlays: projectOverlays(document),
    composition: artifact.composition,
  });
  const receipt = {
    format: "loom.png.export-receipt",
    schemaVersion: "0.1.0",
    artifactId: document.artifactId,
    revision: document.revision,
    widthPx: request.options.widthPx,
    heightPx: request.options.heightPx,
    pixelRatio: request.options.pixelRatio,
    warnings: [],
    outputRef: "memory://png/golden-case",
  };
  return { artifact, document, preset, request, composition, receipt };
}

test("regression evidence binds Golden Case revision, preset, layer structure and author conclusion", async () => {
  const values = await fixture();
  const evidence = createPngRegressionEvidence({ ...values, authorConclusion: "continue-refinement", authorNote: "Technical structure is stable; author visual review remains open." });
  assertPngRegressionEvidence(evidence);
  assert.equal(evidence.revision, values.document.revision);
  assert.equal(evidence.presetId, values.preset.presetId);
  assert.equal(evidence.requested.widthPx, values.preset.widthPx);
  assert.equal(evidence.receipt.outputRef, "memory://png/golden-case");
  assert.equal(evidence.pixelDiffBlocking, false);
  assert.equal(evidence.checks.structure.status, "pass");
  assert.equal(evidence.checks.gutter.status, "pending");
});

test("same revision, preset and structure compare as stable; intended structural change is visible", async () => {
  const values = await fixture();
  const first = createPngRegressionEvidence(values);
  const second = createPngRegressionEvidence(values);
  assert.deepEqual(comparePngRegressionEvidence(first, second), { status: "stable", differences: [], pixelDiffBlocking: false });

  const changedComposition = structuredClone(values.composition);
  changedComposition.routes[0].points[0].x += 4;
  const changed = createPngRegressionEvidence({ ...values, composition: changedComposition });
  const comparison = comparePngRegressionEvidence(first, changed);
  assert.equal(comparison.status, "changed");
  assert.ok(comparison.differences.includes("structuralFingerprint"));
  assert.equal(comparison.pixelDiffBlocking, false);
});

test("author checks can record a pass or fail without changing the technical fingerprint policy", async () => {
  const values = await fixture();
  const evidence = createPngRegressionEvidence({
    ...values,
    checks: {
      structure: { status: "pass", evidence: "All required layers present." },
      dimensions: { status: "pass", evidence: "Requested and actual dimensions recorded." },
      gutter: { status: "pass", evidence: "The shared gutter remains clear." },
      textReadability: { status: "fail", evidence: "Title needs another visual pass." },
      seam: { status: "pending", evidence: null },
    },
    authorConclusion: "continue-refinement",
  });
  assertPngRegressionEvidence(evidence);
  assert.equal(evidence.checks.textReadability.status, "fail");
  assert.equal(evidence.pixelDiffBlocking, false);
});

test("mismatched receipt identity or invalid evidence cannot be recorded", async () => {
  const values = await fixture();
  assert.throws(() => createPngRegressionEvidence({ ...values, receipt: { ...values.receipt, revision: "sha256:other" } }), /receipt revision/);
  const evidence = createPngRegressionEvidence(values);
  assert.throws(() => assertPngRegressionEvidence({ ...evidence, pixelDiffBlocking: true }), /pixelDiffBlocking/);
  assert.throws(() => assertPngRegressionEvidence({ ...evidence, structuralFingerprint: "sha256:bad" }), /structuralFingerprint/);
});
