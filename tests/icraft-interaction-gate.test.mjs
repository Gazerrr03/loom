import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { mergeEffectiveLayout } from "../contracts/layout.mjs";
import { DEFAULT_CAPABILITIES } from "../contracts/icraft-player-adapter.mjs";
import {
  assessIcraftInteractionCapabilities,
  beginIcraftPreview,
  cancelIcraftPreview,
  commitIcraftPreview,
  updateIcraftPreview,
} from "../contracts/icraft-interaction-gate.mjs";
import { applyDomainCommand } from "../contracts/interaction-commit.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

function fullyInteractiveCapabilities() {
  return {
    ...structuredClone(DEFAULT_CAPABILITIES),
    interactions: ["pick", "orbit-view", "move-plane", "rotate-y", "scale-uniform", "change-z-index", "edit-route"],
    features: [...DEFAULT_CAPABILITIES.features, "elevation-edit"],
  };
}

test("the default public Player capability set records all six direct operations as unsupported", async () => {
  const evidence = await readJson("examples/icraft-interaction-evidence.json");
  const assessment = assessIcraftInteractionCapabilities(DEFAULT_CAPABILITIES);

  assert.equal(assessment.status, "partial");
  assert.deepEqual(assessment.unsupportedOperations, evidence.operations.map(({ operation }) => operation));
  assert.deepEqual(
    evidence.operations.map(({ operation }) => assessment.operations[operation].status),
    evidence.operations.map(({ status }) => status),
  );
  assert.equal(assessment.fallbackAdapterId, "reference-renderer");
});

test("an unsupported operation returns a structured no-go without creating a preview session", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const before = structuredClone(artifact);
  const result = beginIcraftPreview({
    capabilities: DEFAULT_CAPABILITIES,
    operation: "move",
    baseRevision: "sha256:golden-case-v1",
    gestureId: "gesture-unsupported",
    targetId: "stage-workbench",
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.error.code, "unsupported-capability");
  assert.equal(result.error.suggestedFallback, "reference-renderer");
  assert.equal("session" in result, false);
  assert.deepEqual(artifact, before);
});

test("a supported move commits one command and survives Effective Layout reload", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const before = structuredClone(artifact);
  const preview = beginIcraftPreview({
    capabilities: fullyInteractiveCapabilities(),
    operation: "move",
    baseRevision: "sha256:golden-case-v1",
    gestureId: "gesture-supported-move",
    targetId: "stage-workbench",
  });
  const frame = updateIcraftPreview(
    updateIcraftPreview(preview, { x: 560, y: 44 }),
    { x: 575, y: 48 },
  );
  const committed = commitIcraftPreview(frame, artifact);

  assert.equal(committed.status, "committed");
  assert.equal(committed.command.type, "layout.node.move");
  assert.equal(committed.command.gestureId, "gesture-supported-move");
  assert.deepEqual(artifact, before);
  assert.deepEqual(committed.artifact.layout.overrides.nodes["stage-workbench"], {
    x: 575,
    y: 48,
    rotationYDeg: -4,
  });
  const reloaded = mergeEffectiveLayout(committed.artifact.layout, committed.artifact.composition.defaultView);
  assert.equal(reloaded.nodes["stage-workbench"].x, 575);
  assert.equal(reloaded.nodes["stage-workbench"].y, 48);
});

test("elevation uses a field-level command, while cancel leaves no Human Override", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const beforeCancel = structuredClone(artifact);
  const elevationPreview = beginIcraftPreview({
    capabilities: fullyInteractiveCapabilities(),
    operation: "elevation",
    baseRevision: "sha256:golden-case-v1",
    gestureId: "gesture-elevation",
    targetId: "stage-workbench",
  });
  const elevated = commitIcraftPreview(updateIcraftPreview(elevationPreview, { elevation: 42 }), artifact);
  assert.equal(elevated.command.type, "layout.node.elevation");
  assert.equal(elevated.artifact.layout.overrides.nodes["stage-workbench"].elevation, 42);

  const cancelledPreview = beginIcraftPreview({
    capabilities: fullyInteractiveCapabilities(),
    operation: "scale-uniform",
    baseRevision: "sha256:golden-case-v1",
    gestureId: "gesture-cancel",
    targetId: "stage-workbench",
  });
  const cancelled = cancelIcraftPreview(updateIcraftPreview(cancelledPreview, { scale: 1.4 }));
  assert.equal(cancelled.status, "cancelled");
  assert.throws(() => commitIcraftPreview(cancelled, artifact), /supported iCraft preview/);
  assert.deepEqual(artifact, beforeCancel);
  assert.equal(applyDomainCommand(artifact, { type: "layout.node.move", targetId: "stage-workbench", x: 522, y: 35, baseRevision: "sha256:golden-case-v1", gestureId: "gesture-cancel" }).layout.overrides.nodes["stage-workbench"].x, 522);
});

test("unknown operations and invalid capability declarations never report success", () => {
  const unknown = beginIcraftPreview({
    capabilities: fullyInteractiveCapabilities(),
    operation: "scene-write",
    baseRevision: "sha256:golden-case-v1",
    gestureId: "gesture-unknown",
    targetId: "stage-workbench",
  });
  assert.equal(unknown.status, "error");
  assert.equal(unknown.error.code, "invalid-tool-input");
  assert.throws(() => assessIcraftInteractionCapabilities({}), /capabilities/);
});
