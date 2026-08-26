/**
 * Renderer-independent route geometry contract.
 *
 * Route points stay in the persisted Diagram coordinate space. The shared
 * coordinate adapter maps Diagram x/y to world X/Z, so orthogonality is
 * checked in that world-plane projection rather than against a Renderer view.
 * `elevation` maps to world Y and is intentionally independent from the
 * planar route axis.
 */

import { diagramToWorld, routeToWorld } from "./coordinates.mjs";

export const ROUTE_GRID_SIZE = 1;

export const ROUTE_GRID_CONTRACT = Object.freeze({
  coordinateSpace: "world-xz",
  plane: "xz",
  axes: Object.freeze(["x", "z"]),
  gridStep: ROUTE_GRID_SIZE,
  heightAxis: "y",
  elevationPolicy: "independent",
});

/**
 * Return the world-plane axis changed by one Diagram route segment.
 * `stationary` is retained for coincident control points; only a segment
 * changing both X and Z is invalid for this contract.
 */
export function routeAxisBetween(left, right, path = "route.segment") {
  const leftWorld = diagramToWorld(left, { path: `${path}.from` });
  const rightWorld = diagramToWorld(right, { path: `${path}.to` });
  const xChanged = leftWorld.x !== rightWorld.x;
  const zChanged = leftWorld.z !== rightWorld.z;
  if (xChanged && zChanged) {
    throw new Error(`${path} must change along only one world axis (X or Z); diagonal segment is not allowed`);
  }
  return xChanged ? "x" : zChanged ? "z" : "stationary";
}

/** Assert that every consecutive route segment is an XZ grid edge. */
export function assertOrthogonalRoute(points, path = "route.points") {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error(`${path} must contain at least two points`);
  }
  const worldPoints = routeToWorld(points, { path });
  for (let index = 1; index < worldPoints.length; index += 1) {
    const previous = worldPoints[index - 1];
    const current = worldPoints[index];
    const xChanged = previous.x !== current.x;
    const zChanged = previous.z !== current.z;
    if (xChanged && zChanged) {
      throw new Error(`${path}[${index}] must change along only one world axis (X or Z); diagonal segment is not allowed`);
    }
  }
  return points;
}
