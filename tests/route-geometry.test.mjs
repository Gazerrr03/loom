import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOrthogonalRoute,
  routeAxisBetween,
  ROUTE_GRID_CONTRACT,
} from "../contracts/route-geometry.mjs";

test("route geometry checks the shared world XZ projection while elevation stays independent", () => {
  assert.deepEqual(ROUTE_GRID_CONTRACT, {
    coordinateSpace: "diagram",
    plane: "xz",
    axes: ["x", "z"],
    gridStep: 1,
    heightAxis: "y",
    elevationPolicy: "independent",
  });
  const route = [
    { x: 10, y: 20, elevation: 2 },
    { x: 10, y: 32, elevation: 8 },
    { x: 24, y: 32, elevation: 4 },
  ];
  assert.equal(routeAxisBetween(route[0], route[1]), "z");
  assert.equal(routeAxisBetween(route[1], route[2]), "x");
  assert.doesNotThrow(() => assertOrthogonalRoute(route));
});

test("diagonal XZ segments are rejected at the shared route boundary", () => {
  assert.throws(
    () => assertOrthogonalRoute([{ x: 10, y: 20 }, { x: 24, y: 32 }]),
    /only one world axis \(X or Z\).*diagonal segment/,
  );
  assert.throws(
    () => routeAxisBetween({ x: 10, y: 20 }, { x: 24, y: 32 }),
    /only one world axis \(X or Z\).*diagonal segment/,
  );
});
