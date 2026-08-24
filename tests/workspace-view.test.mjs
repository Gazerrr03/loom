import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceView,
  DEFAULT_BASIS,
  DEFAULT_VIEW,
  LIMITS,
  viewBasis,
} from "../workspace/workspace-view.mjs";
import { createIsometricTransform } from "../workspace/workspace-canvas.mjs";

test("workspace view starts with the Golden Case isometric defaults", () => {
  const view = createWorkspaceView();
  assert.deepEqual(view.getState(), DEFAULT_VIEW);
  assert.deepEqual(viewBasis(view.getState()), DEFAULT_BASIS);
});

test("pan, zoom, and orbit update view state without sharing mutable snapshots", () => {
  const view = createWorkspaceView();
  const panned = view.panBy({ x: 42, y: -18 });
  assert.deepEqual(panned.pan, { x: 42, y: -18 });
  const zoomed = view.zoomBy(1.4);
  assert.equal(zoomed.zoom, 1.4);
  const orbited = view.orbitBy({ azimuthDeg: 20, elevationDeg: -5 });
  assert.equal(orbited.azimuthDeg, 65);
  assert.equal(orbited.elevationDeg, DEFAULT_VIEW.elevationDeg - 5);
  panned.pan.x = 999;
  assert.equal(view.getState().pan.x, 42);
});

test("view values clamp to safe bounds and reject non-finite input", () => {
  const view = createWorkspaceView({ pan: { x: 99999, y: -99999 }, zoom: 999, azimuthDeg: -40, elevationDeg: 100 });
  assert.deepEqual(view.getState().pan, { x: LIMITS.pan.max, y: LIMITS.pan.min });
  assert.equal(view.getState().zoom, LIMITS.zoom.max);
  assert.equal(view.getState().azimuthDeg, LIMITS.azimuthDeg.min);
  assert.equal(view.getState().elevationDeg, LIMITS.elevationDeg.max);
  assert.throws(() => view.panBy({ x: Number.NaN, y: 0 }), /finite number/);
  assert.throws(() => view.zoomBy(0), /greater than zero/);
  assert.throws(() => view.orbitBy({ azimuthDeg: Number.POSITIVE_INFINITY }), /finite number/);
});

test("orbit basis stays invertible and round-trips Diagram coordinates", () => {
  const view = createWorkspaceView();
  view.orbitBy({ azimuthDeg: 75, elevationDeg: 18 });
  view.zoomBy(1.2);
  view.panBy({ x: 34, y: -22 });
  const transform = createIsometricTransform({
    pan: view.getState().pan,
    zoom: view.getState().zoom,
    basis: viewBasis(view.getState()),
  });
  const original = { x: 182, y: 94 };
  const screen = transform.diagramToScreen(original, { z: 12 });
  const recovered = transform.screenToDiagram(screen, { z: 12 });
  assert.ok(Math.abs(recovered.x - original.x) < 1e-9);
  assert.ok(Math.abs(recovered.y - original.y) < 1e-9);
});

test("reset returns only the view to defaults", () => {
  const view = createWorkspaceView();
  view.panBy({ x: 10, y: 12 });
  view.zoomBy(1.3);
  view.orbitBy({ azimuthDeg: -15, elevationDeg: 8 });
  assert.deepEqual(view.reset(), DEFAULT_VIEW);
});
