import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRouteEditor, routePoints } from "../workspace/route-editor.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readFixture() {
  return JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
}

test("route points resolve from Generated Layout plus Human Override", async () => {
  const artifact = await readFixture();
  const points = routePoints(artifact, "edge-split");
  assert.equal(points.length, 4);
  assert.deepEqual(points[0], { x: 96, y: 152 });
  const withOverride = structuredClone(artifact);
  withOverride.layout.overrides.routes["edge-split"] = { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
  assert.deepEqual(routePoints(withOverride, "edge-split"), [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
});

test("preview edits one route point without mutating canonical artifact", async () => {
  const artifact = await readFixture();
  const before = structuredClone(artifact);
  const editor = createRouteEditor({ artifact, revision: "sha256:golden-case-v1" });
  editor.pointerDown({ edgeId: "edge-split", pointIndex: 1, pointerId: 7 });
  editor.pointerMove({ diagramPoint: { x: 133, y: 160 } });
  assert.deepEqual(editor.getArtifact(), before);
  assert.equal(editor.getState().previewing, true);
  assert.deepEqual(editor.getDisplayArtifact().layout.overrides.routes["edge-split"].points[1], { x: 133, y: 160 });
  const cancelled = editor.cancel();
  assert.equal(cancelled.phase, "cancelled");
  assert.equal(editor.getState().commitCount, 0);
  assert.deepEqual(editor.getArtifact(), before);
});

test("pointer up commits one route replacement and preserves unrelated overrides", async () => {
  const artifact = await readFixture();
  const editor = createRouteEditor({ artifact, revision: "sha256:golden-case-v1" });
  editor.pointerDown({ edgeId: "edge-split", pointIndex: 2, pointerId: 8 });
  editor.pointerMove({ diagramPoint: { x: 121, y: 137 } });
  const result = editor.pointerUp({ diagramPoint: { x: 122, y: 138 } });
  assert.equal(result.command.type, "layout.route.replace-points");
  assert.equal(result.command.targetId, "edge-split");
  assert.deepEqual(result.command.points[2], { x: 122, y: 138 });
  assert.equal(result.command.gestureId, "workspace-route-1");
  assert.deepEqual(result.artifact.layout.overrides.routes["edge-split"].points[0], { x: 96, y: 152 });
  assert.deepEqual(result.artifact.layout.overrides.nodes["stage-workbench"], { x: 522, rotationYDeg: -4 });
  assert.equal(editor.getState().commitCount, 1);
  assert.equal(editor.getState().history.length, 1);
});

test("invalid route, point index, and point values are rejected", async () => {
  const artifact = await readFixture();
  const editor = createRouteEditor({ artifact });
  assert.equal(editor.pointerDown({ edgeId: "missing-edge", pointIndex: 0 }).reason, "edge-not-found");
  assert.throws(() => editor.pointerDown({ edgeId: "edge-split", pointIndex: 99 }), /pointIndex must resolve/);
  editor.pointerDown({ edgeId: "edge-split", pointIndex: 0 });
  assert.throws(() => editor.pointerMove({ diagramPoint: { x: Number.NaN, y: 4 } }), /finite number/);
  editor.cancel();
  const malformed = structuredClone(artifact);
  malformed.layout.generated.routes["edge-split"].points = [{ x: 1, y: 2 }];
  assert.equal(createRouteEditor({ artifact: malformed }).pointerDown({ edgeId: "edge-split", pointIndex: 0 }).reason, "route-points-invalid");
});
