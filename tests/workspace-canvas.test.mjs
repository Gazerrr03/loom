import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createIsometricTransform,
  createWorkspaceCanvas,
  hitTestNode,
} from "../workspace/workspace-canvas.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readFixture() {
  return JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
}

test("Diagram-space hit test returns a stable node id and rejects empty space", async () => {
  const artifact = await readFixture();
  assert.equal(hitTestNode(artifact, { x: 80, y: 170 }), "stage-line");
  assert.equal(hitTestNode(artifact, { x: 80, y: 170, elevation: 999 }), "stage-line");
  assert.equal(hitTestNode(artifact, { x: -10, y: -10 }), null);

  const overlapping = structuredClone(artifact);
  overlapping.layout.generated.nodes["stage-branch"].x = 70;
  overlapping.layout.generated.nodes["stage-branch"].y = 165;
  assert.equal(hitTestNode(overlapping, { x: 80, y: 170 }), "stage-branch");
});

test("isometric screen transform round-trips Diagram coordinates through pan and zoom", () => {
  const transform = createIsometricTransform({ pan: { x: 30, y: -18 }, zoom: 1.6 });
  const diagramPoint = { x: 182, y: 94 };
  const screenPoint = transform.diagramToScreen(diagramPoint, { z: 12 });
  const recovered = transform.screenToDiagram(screenPoint, { z: 12 });
  assert.ok(Math.abs(recovered.x - diagramPoint.x) < 1e-9);
  assert.ok(Math.abs(recovered.y - diagramPoint.y) < 1e-9);
});

test("isometric transform keeps Diagram y on world Z and elevation on world Y", () => {
  const transform = createIsometricTransform({ pan: { x: 30, y: -18 }, zoom: 1.6 });
  const diagramPoint = { x: 182, y: 94, elevation: 12 };
  const worldPoint = { x: 182, y: 12, z: 94 };
  assert.deepEqual(transform.diagramToScreen(diagramPoint), transform.worldToScreen(worldPoint));
  const recoveredWorld = transform.screenToWorld(transform.worldToScreen(worldPoint), { y: 12 });
  assert.equal(recoveredWorld.x, worldPoint.x);
  assert.equal(recoveredWorld.y, worldPoint.y);
  assert.ok(Math.abs(recoveredWorld.z - worldPoint.z) < 1e-9);
  const recoveredDiagram = transform.screenToDiagram(transform.diagramToScreen(diagramPoint), { z: 12 });
  assert.equal(recoveredDiagram.x, diagramPoint.x);
  assert.ok(Math.abs(recoveredDiagram.y - diagramPoint.y) < 1e-9);
});

test("pointer preview stays outside canonical Artifact and cancel creates no transaction", async () => {
  const artifact = await readFixture();
  const before = structuredClone(artifact);
  const canvas = createWorkspaceCanvas({ artifact, revision: "sha256:golden-case-v1" });
  canvas.pointerDown({ nodeId: "stage-line", diagramPoint: { x: 80, y: 170 }, pointerId: 1 });
  canvas.pointerMove({ diagramPoint: { x: 90, y: 180 } });
  assert.deepEqual(canvas.getArtifact(), before);
  assert.equal(canvas.getState().previewing, true);
  assert.equal(canvas.getDisplayArtifact().layout.overrides.nodes["stage-line"].x, 80);
  const cancelled = canvas.cancel();
  assert.equal(cancelled.phase, "cancelled");
  assert.equal(canvas.getState().commitCount, 0);
  assert.deepEqual(canvas.getArtifact(), before);
});

test("pointer-up commits one Diagram-space move and preserves unrelated overrides", async () => {
  const artifact = await readFixture();
  const canvas = createWorkspaceCanvas({ artifact, revision: "sha256:golden-case-v1" });
  canvas.pointerDown({ nodeId: "stage-workbench", diagramPoint: { x: 540, y: 50 }, pointerId: 8 });
  canvas.pointerMove({ diagramPoint: { x: 550, y: 60 } });
  const result = canvas.pointerUp({ diagramPoint: { x: 556, y: 66 } });

  assert.equal(result.command.type, "layout.node.move");
  assert.equal(result.command.targetId, "stage-workbench");
  assert.equal(result.command.x, 538);
  assert.equal(result.command.y, 51);
  assert.equal(result.command.gestureId, "workspace-drag-1");
  assert.deepEqual(result.artifact.layout.overrides.nodes["stage-workbench"], { x: 538, y: 51, rotationYDeg: -4 });
  assert.equal(canvas.getState().commitCount, 1);
  assert.equal(canvas.getState().history.length, 1);
  assert.equal(canvas.pointerUp({ diagramPoint: { x: 560, y: 70 } }).reason, "no-active-gesture");
  assert.equal(artifact.layout.overrides.nodes["stage-workbench"].x, 522);
});

test("unknown selection is rejected without an Inspector target or active gesture", async () => {
  const artifact = await readFixture();
  const canvas = createWorkspaceCanvas({ artifact, revision: "sha256:golden-case-v1" });
  assert.equal(canvas.selectNode("missing-node"), null);
  assert.equal(canvas.pointerDown({ nodeId: "missing-node", diagramPoint: { x: 1, y: 1 }, pointerId: 4 }).reason, "node-not-found");
  assert.equal(canvas.getState().active, null);
});
