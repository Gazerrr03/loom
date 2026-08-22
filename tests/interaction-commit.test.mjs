import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { mergeEffectiveLayout } from "../contracts/layout.mjs";
import {
  applyDomainCommand,
  beginPreview,
  cancelPreview,
  commitPreview,
  updatePreview,
} from "../contracts/interaction-commit.mjs";
import { assertDiagramArtifact } from "../core/artifact-store.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readFixture() {
  return JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
}

test("preview frames never mutate the Artifact and cancel leaves no command", async () => {
  const artifact = await readFixture();
  const before = structuredClone(artifact);
  const started = beginPreview({
    baseRevision: "sha256:golden-case-v1",
    gestureId: "gesture-move-1",
    commandType: "layout.node.move",
    targetId: "stage-workbench",
  });
  const frame = updatePreview(started, { x: 600, y: 42 });

  assert.deepEqual(artifact, before);
  assert.equal(started.frameCount, 0);
  assert.equal(frame.frameCount, 1);
  assert.deepEqual(frame.value, { x: 600, y: 42 });

  const cancelled = cancelPreview(frame);
  assert.equal(cancelled.phase, "cancelled");
  assert.equal(cancelled.value, null);
  assert.throws(() => commitPreview(cancelled), /only an active preview/);
  assert.deepEqual(artifact, before);
});

test("pointer-up commits one final command and Core writes a readable Human Override", async () => {
  const artifact = await readFixture();
  const preview = updatePreview(
    updatePreview(
      beginPreview({
        baseRevision: "sha256:golden-case-v1",
        gestureId: "gesture-move-2",
        commandType: "layout.node.move",
        targetId: "stage-workbench",
      }),
      { x: 540, y: 39 },
    ),
    { x: 560, y: 44 },
  );
  const { command, session } = commitPreview(preview);
  const next = applyDomainCommand(artifact, command);

  assert.equal(session.phase, "committed");
  assert.equal(command.type, "layout.node.move");
  assert.equal(command.gestureId, "gesture-move-2");
  assert.deepEqual(command, {
    type: "layout.node.move",
    targetId: "stage-workbench",
    x: 560,
    y: 44,
    baseRevision: "sha256:golden-case-v1",
    gestureId: "gesture-move-2",
  });
  assert.deepEqual(artifact.layout.overrides.nodes["stage-workbench"], { x: 522, rotationYDeg: -4 });
  assert.deepEqual(next.layout.overrides.nodes["stage-workbench"], { x: 560, y: 44, rotationYDeg: -4 });
  assert.equal(mergeEffectiveLayout(next.layout, next.composition.defaultView).nodes["stage-workbench"].x, 560);
  assert.equal(mergeEffectiveLayout(next.layout, next.composition.defaultView).nodes["stage-workbench"].y, 44);
  assert.doesNotThrow(() => assertDiagramArtifact(next));
});

test("route and view commands remain field-scoped and invalid targets fail before writing", async () => {
  const artifact = await readFixture();
  const routePreview = updatePreview(
    beginPreview({
      baseRevision: "sha256:golden-case-v1",
      gestureId: "gesture-route-1",
      commandType: "layout.route.replace-points",
      targetId: "edge-split",
    }),
    { points: [{ x: 30, y: 40 }, { x: 80, y: 100 }] },
  );
  const route = applyDomainCommand(artifact, commitPreview(routePreview).command);
  assert.deepEqual(route.layout.overrides.routes["edge-split"], {
    points: [{ x: 30, y: 40 }, { x: 80, y: 100 }],
  });

  const viewPreview = updatePreview(
    beginPreview({
      baseRevision: "sha256:golden-case-v1",
      gestureId: "gesture-view-1",
      commandType: "layout.view.change",
      targetId: "canvas",
    }),
    { zoom: 1.25 },
  );
  const viewed = applyDomainCommand(artifact, commitPreview(viewPreview).command);
  assert.deepEqual(viewed.layout.overrides.view, { zoom: 1.25 });
  assert.throws(
    () => applyDomainCommand(artifact, {
      ...commitPreview(viewPreview).command,
      targetId: "missing-node",
      type: "layout.node.move",
      x: 1,
      y: 2,
    }),
    /command target does not resolve/,
  );
});

test("a preview cannot commit without a pointer-up frame", () => {
  const preview = beginPreview({
    baseRevision: "sha256:test",
    gestureId: "gesture-empty",
    commandType: "layout.node.scale",
    targetId: "stage-workbench",
  });
  assert.throws(() => commitPreview(preview), /without a frame/);
  assert.throws(() => updatePreview(preview, { scale: 0 }), /greater than zero/);
});
