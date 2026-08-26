import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { diagramToView } from "../contracts/coordinates.mjs";
import { assertRouteControlPoints, moveRouteControlPoint, resolveAnnotationAnchor, resolveAnnotationAnchors } from "../contracts/anchors.mjs";
import { mergeEffectiveLayout } from "../contracts/layout.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function readJson(relativePath) { return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8")); }

test("route control points are Diagram-space and every Golden Case route resolves", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const effective = mergeEffectiveLayout(artifact.layout, artifact.composition.defaultView);
  assert.doesNotThrow(() => assertRouteControlPoints(artifact, effective));
  const moved = moveRouteControlPoint(effective.routes["edge-connect"], 1, { x: 260, y: 105, elevation: 3 }, artifact.composition.canvas);
  assert.deepEqual(moved.points[1], { x: 260, y: 105, elevation: 3 });
  assert.notDeepEqual(moved, effective.routes["edge-connect"]);
  assert.throws(() => moveRouteControlPoint(effective.routes["edge-connect"], 1, { x: 274, y: 94 }, artifact.composition.canvas), /only one world axis \(X or Z\).*diagonal segment/);
  assert.throws(() => moveRouteControlPoint(effective.routes["edge-connect"], 1, { x: -1, y: 94 }, artifact.composition.canvas), /outside/);
});

test("node and edge annotations follow Effective Layout while canvas anchors stay fixed", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const first = resolveAnnotationAnchors(artifact);
  const movedArtifact = structuredClone(artifact);
  movedArtifact.layout.overrides.nodes["stage-field"] = { x: 300 };
  movedArtifact.layout.overrides.routes["edge-connect"] = {
    points: [
      { x: 242, y: 105 },
      { x: 300, y: 105 },
      { x: 300, y: 98 },
    ],
  };
  const second = resolveAnnotationAnchors(movedArtifact);
  assert.equal(second["annotation-field"].x - first["annotation-field"].x, 20);
  assert.deepEqual(second["annotation-thesis"], first["annotation-thesis"]);
  assert.notDeepEqual(second["annotation-gutter"], first["annotation-gutter"]);
});

test("anchor resolution remains independent of View and Screen coordinates", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const diagramPoint = resolveAnnotationAnchor(artifact.annotations[1], artifact);
  const viewPoint = diagramToView(diagramPoint, { canvas: artifact.composition.canvas, zoom: 2 });
  assert.equal(typeof diagramPoint.x, "number");
  assert.notEqual(viewPoint.x, diagramPoint.x);
  assert.deepEqual(resolveAnnotationAnchor(artifact.annotations[1], artifact), diagramPoint);
});
