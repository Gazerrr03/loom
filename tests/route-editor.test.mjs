import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRouteEditor, editRoutePoint, routePoints } from "../workspace/route-editor.mjs";

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
  withOverride.layout.overrides.routes["edge-split"] = { points: [{ x: 1, y: 2 }, { x: 3, y: 2 }] };
  assert.deepEqual(routePoints(withOverride, "edge-split"), [{ x: 1, y: 2 }, { x: 3, y: 2 }]);
});

test("route point editing keeps orthogonal grid edges", () => {
  const points = [{ x: 0, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 0 }, { x: 40, y: 0 }];
  const horizontalCorner = editRoutePoint(points, 1, { x: 27.6, y: 4.2 });
  assert.deepEqual(horizontalCorner, [{ x: 0, y: 10 }, { x: 28, y: 10 }, { x: 28, y: 0 }, { x: 40, y: 0 }]);
  const verticalCorner = editRoutePoint(points, 2, { x: 25.3, y: -8.6 });
  assert.deepEqual(verticalCorner, [{ x: 0, y: 10 }, { x: 20, y: 10 }, { x: 20, y: -9 }, { x: 40, y: -9 }]);
  const endpoint = editRoutePoint(points, 0, { x: -7.4, y: 99 });
  assert.deepEqual(endpoint[0], { x: -7, y: 10 });
  for (let index = 1; index < horizontalCorner.length; index += 1) {
    assert.ok(horizontalCorner[index - 1].x === horizontalCorner[index].x || horizontalCorner[index - 1].y === horizontalCorner[index].y);
  }
});

test("route point editing resolves coincident neighbors from a non-stationary segment", () => {
  const points = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }];
  const alongSegment = editRoutePoint(points, 1, { x: 5, y: 0 });
  assert.deepEqual(alongSegment, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]);

  const acrossSegment = editRoutePoint(points, 1, { x: 0, y: 10 });
  assert.deepEqual(acrossSegment, [{ x: 0, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 10 }]);
});

test("route point editing keeps longer coincident and collinear runs orthogonal", () => {
  const corner = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  assert.deepEqual(
    editRoutePoint(corner, 2, { x: 12, y: 0 }),
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }],
  );
  assert.deepEqual(
    editRoutePoint(corner, 2, { x: 10, y: -5 }),
    [{ x: 0, y: -5 }, { x: 10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
  );

  const straight = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  assert.deepEqual(
    editRoutePoint(straight, 2, { x: 10, y: 5 }),
    [{ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 5 }, { x: 20, y: 5 }],
  );
});

test("route editor rejects an input route with a diagonal XZ segment", () => {
  assert.throws(
    () => editRoutePoint([{ x: 0, y: 0 }, { x: 10, y: 10 }], 0, { x: 4, y: 0 }),
    /only one world axis \(X or Z\).*diagonal segment/,
  );
});

test("preview edits one route point without mutating canonical artifact", async () => {
  const artifact = await readFixture();
  const before = structuredClone(artifact);
  const editor = createRouteEditor({ artifact, revision: "sha256:golden-case-v1" });
  editor.pointerDown({ edgeId: "edge-split", pointIndex: 1, pointerId: 7 });
  editor.pointerMove({ diagramPoint: { x: 133, y: 160 } });
  assert.deepEqual(editor.getArtifact(), before);
  assert.equal(editor.getState().previewing, true);
  assert.deepEqual(editor.getDisplayArtifact().layout.overrides.routes["edge-split"].points[1], { x: 133, y: 152 });
  assert.deepEqual(editor.getDisplayArtifact().layout.overrides.routes["edge-split"].points[2], { x: 133, y: 140 });
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
  assert.deepEqual(result.command.points[2], { x: 122, y: 140 });
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
  assert.throws(
    () => createRouteEditor({ artifact: malformed }).pointerDown({ edgeId: "edge-split", pointIndex: 0 }),
    /layout\.generated\.routes\.edge-split\.points must contain at least two points/,
  );
});
