import assert from "node:assert/strict";
import test from "node:test";
import {
  WORLD_COORDINATE_CONTRACT,
  diagramRectToWorld,
  diagramToWorld,
  routeToWorld,
  worldToDiagram,
} from "../contracts/coordinates.mjs";

test("the shared world contract keeps Diagram storage renderer-independent", () => {
  assert.deepEqual(WORLD_COORDINATE_CONTRACT, {
    plane: "xz",
    heightAxis: "y",
    origin: "diagram",
    unit: "composition.unit",
  });
});

test("Diagram x/y/elevation maps to world X/Z/Y and round-trips", () => {
  const point = { x: 220, y: 118, elevation: -12 };
  const world = diagramToWorld(point);
  assert.deepEqual(world, { x: 220, y: -12, z: 118 });
  assert.deepEqual(worldToDiagram(world), point);
  assert.deepEqual(diagramToWorld({ x: 12, y: 18 }), { x: 12, y: 0, z: 18 });
  assert.deepEqual(worldToDiagram({ x: 12, y: 0, z: 18 }), { x: 12, y: 18 });
  assert.deepEqual(worldToDiagram({ x: 12, y: 0, z: 18 }, { includeZeroElevation: true }), {
    x: 12,
    y: 18,
    elevation: 0,
  });
});

test("Diagram rectangles become XZ footprints with an independent world height", () => {
  assert.deepEqual(diagramRectToWorld({ x: 220, y: 118, width: 44, height: 34 }, { elevation: 12 }), {
    x: 220,
    y: 12,
    z: 118,
    width: 44,
    depth: 34,
  });
});

test("route conversion preserves point order and does not enforce #134 geometry", () => {
  const world = routeToWorld([
    { x: 10, y: 20, elevation: 2 },
    { x: 30, y: 5, elevation: 4 },
    { x: 30, y: 5, elevation: 8 },
  ]);
  assert.deepEqual(world, [
    { x: 10, y: 2, z: 20 },
    { x: 30, y: 4, z: 5 },
    { x: 30, y: 8, z: 5 },
  ]);
});
