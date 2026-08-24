import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  captureWorkspacePng,
  createWorkspacePngPlan,
  revisionForArtifact,
  saveWorkspaceWithAdapter,
  serializeWorkspaceArtifact,
} from "../workspace/workspace-storage.mjs";
import { importUserGlbReference } from "../workspace/component-panel.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

test("Workspace save serializes native JSON, updates metadata, and never mutates the draft", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const before = structuredClone(artifact);
  const prepared = serializeWorkspaceArtifact(artifact, { now: new Date("2026-08-25T00:00:00.000Z") });
  assert.deepEqual(artifact, before);
  assert.equal(prepared.artifact.metadata.updatedAt, "2026-08-25T00:00:00.000Z");
  assert.match(prepared.text, /^\{\n  "format": "loom\.diagram"/);
  assert.equal(prepared.text.endsWith("\n"), true);
  assert.equal(prepared.text.includes('"mesh"'), false);
  assert.equal(prepared.text.includes('"data"'), false);
});

test("save adapter receives only JSON text and returns a traceable SHA-256 revision", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  let received;
  const receipt = await saveWorkspaceWithAdapter(artifact, {
    fileName: "exports/flovvas-massing.diagram.json",
    now: new Date("2026-08-25T00:00:00.000Z"),
    adapter: { save: async (payload) => { received = payload; return { outputRef: payload.fileName }; } },
  });
  assert.equal(received.fileName, "flovvas-massing.diagram.json");
  assert.equal(typeof received.text, "string");
  assert.equal(received.artifact.assets.every((asset) => !Object.hasOwn(asset, "data")), true);
  assert.match(receipt.revision, /^sha256:[0-9a-f]{64}$/);
  assert.equal(receipt.output.outputRef, "flovvas-massing.diagram.json");
  assert.equal(receipt.revision, await revisionForArtifact(receipt.artifact));
});

test("save revision conflicts are structured and leave the existing draft untouched", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  await assert.rejects(
    () => saveWorkspaceWithAdapter(artifact, {
      expectedRevision: "sha256:old",
      currentRevision: "sha256:new",
      adapter: { save: async () => ({}) },
    }),
    (error) => error.code === "revision-conflict" && error.recoverable === true,
  );
});

test("PNG plan binds Effective Layout to a two-page A4 capture and excludes editor chrome", async () => {
  const [artifact, catalog] = await Promise.all([
    readJson("examples/flovvas-massing.diagram.json"),
    readJson("examples/flovvas-template-catalog.json"),
  ]);
  const plan = await createWorkspacePngPlan(artifact, { catalog: catalog.templates });
  assert.equal(plan.preset.widthMm, 594);
  assert.equal(plan.preset.heightMm, 210);
  assert.equal(plan.preset.widthPx, 7016);
  assert.equal(plan.preset.heightPx, 2480);
  assert.deepEqual(plan.request.layers, ["scene", "routes", "phaseZones", "annotations"]);
  assert.equal(plan.request.options.includeEditorChrome, false);
  assert.deepEqual(plan.composition.editorChrome, []);
  assert.equal(plan.composition.scene.length, artifact.semantic.nodes.length);
  assert.equal(plan.composition.routes.length, artifact.semantic.edges.length);
  assert.equal(plan.composition.annotations.length, artifact.annotations.length);
});

test("PNG capture adapter receives a revision-bound request plus the exact composition", async () => {
  const [artifact, catalog] = await Promise.all([
    readJson("examples/flovvas-massing.diagram.json"),
    readJson("examples/flovvas-template-catalog.json"),
  ]);
  const plan = await createWorkspacePngPlan(artifact, { catalog: catalog.templates, revision: "sha256:golden-case" });
  let received;
  const receipt = await captureWorkspacePng(plan, {
    capturePng: async (payload) => {
      received = payload;
      return {
        revision: payload.request.revision,
        widthPx: payload.request.options.widthPx,
        heightPx: payload.request.options.heightPx,
        warnings: payload.composition.warnings,
        outputRef: "memory://golden-case.png",
      };
    },
  });
  assert.equal(received.request.revision, "sha256:golden-case");
  assert.deepEqual(received.composition.editorChrome, []);
  assert.equal(receipt.revision, "sha256:golden-case");
  assert.equal(receipt.widthPx, 7016);
  assert.equal(receipt.heightPx, 2480);
});

test("unconfirmed GLB references block PNG planning and identify the asset", async () => {
  const [artifact, catalog] = await Promise.all([
    readJson("examples/flovvas-massing.diagram.json"),
    readJson("examples/flovvas-template-catalog.json"),
  ]);
  const imported = importUserGlbReference(artifact, { fileName: "workbench.glb" });
  await assert.rejects(
    () => createWorkspacePngPlan(imported.artifact, { catalog: catalog.templates }),
    (error) => error.code === "missing-asset" && error.objectIds.includes(imported.asset.id) && error.fieldPath === "assets",
  );
});

test("Workspace wires Save and Export to the storage contract", async () => {
  const [app, storage] = await Promise.all([
    readFile(join(repoRoot, "workspace/workspace-app.mjs"), "utf8"),
    readFile(join(repoRoot, "workspace/workspace-storage.mjs"), "utf8"),
  ]);
  assert.match(app, /captureWorkspacePng/);
  assert.match(app, /saveWorkspaceWithAdapter/);
  assert.match(app, /els\.saveButton\.addEventListener\("click", handleSave\)/);
  assert.match(app, /els\.exportButton\.addEventListener\("click", handleExport\)/);
  assert.match(app, /downloadJson/);
  assert.match(app, /captureCurrentCanvas/);
  assert.match(storage, /createPngCaptureRequest/);
  assert.match(storage, /createPngComposition/);
  assert.match(storage, /createPngExportPreset/);
  assert.doesNotMatch(app, /from\s+["']node:/);
  assert.doesNotMatch(storage, /from\s+["']node:/);
});
