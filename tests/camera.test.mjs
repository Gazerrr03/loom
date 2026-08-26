import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertCamera,
  CAMERA_DEFAULTS,
  normalizeCamera,
} from "../contracts/camera.mjs";
import {
  assertExportSettings,
  resolveExportCamera,
  withExportCamera,
} from "../contracts/export-settings.mjs";
import { assertDiagramArtifact } from "../core/artifact-store.mjs";
import {
  cameraFromWorkspaceView,
  createWorkspaceView,
  workspaceViewFromCamera,
} from "../workspace/workspace-view.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readFixture() {
  return JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
}

async function readDiagramSchema() {
  return JSON.parse(await readFile(join(repoRoot, "contracts/diagram.schema.json"), "utf8"));
}

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} !== ${expected}`);
}

test("canonical camera defaults are orthographic, isometric, and Diagram-space", () => {
  assert.doesNotThrow(() => assertCamera(CAMERA_DEFAULTS));
  assert.deepEqual(CAMERA_DEFAULTS.target, { x: 0, y: 0 });
  assert.equal(CAMERA_DEFAULTS.projection, "orthographic");
  assert.equal(CAMERA_DEFAULTS.preset, "isometric");
});

test("Diagram schema keeps export camera optional for legacy files but strict when present", async () => {
  const schema = await readDiagramSchema();
  assert.equal(schema.properties.exportSettings.$ref, "#/$defs/exportSettings");
  assert.deepEqual(schema.$defs.camera.required, [
    "projection",
    "preset",
    "azimuthDeg",
    "elevationDeg",
    "target",
    "orthoScale",
  ]);
  assert.equal(schema.$defs.camera.properties.projection.const, "orthographic");
  assert.equal(schema.$defs.camera.properties.preset.const, "isometric");
  assert.equal(schema.required.includes("exportSettings"), false);
});

test("interactive camera input wraps azimuth and clamps elevation and scale", () => {
  assert.deepEqual(normalizeCamera({
    azimuthDeg: -45,
    elevationDeg: 90,
    target: { x: 12, y: -8 },
    orthoScale: 9,
  }), {
    ...CAMERA_DEFAULTS,
    azimuthDeg: 315,
    elevationDeg: 70,
    target: { x: 12, y: -8 },
    orthoScale: 2.4,
  });
  assert.throws(
    () => assertCamera({ ...CAMERA_DEFAULTS, azimuthDeg: 360 }),
    /azimuthDeg must be in \[0, 360\)/,
  );
  assert.throws(
    () => assertCamera({ ...CAMERA_DEFAULTS, target: { x: 1, y: 2, z: 3 } }),
    /target contains unsupported fields/,
  );
});

test("workspace session views round-trip through a stable composition-space camera", () => {
  const view = {
    pan: { x: 42, y: -18 },
    zoom: 1.4,
    azimuthDeg: 65,
    elevationDeg: 30.264,
  };
  const camera = cameraFromWorkspaceView(view);
  const recovered = workspaceViewFromCamera(camera);
  assertClose(recovered.pan.x, view.pan.x, "pan.x");
  assertClose(recovered.pan.y, view.pan.y, "pan.y");
  assertClose(recovered.zoom, view.zoom, "zoom");
  assertClose(recovered.azimuthDeg, view.azimuthDeg, "azimuthDeg");
  assertClose(recovered.elevationDeg, view.elevationDeg, "elevationDeg");
});

test("workspace camera navigation remains session-only and reset follows the loaded default", () => {
  const view = createWorkspaceView({ azimuthDeg: 10, elevationDeg: 40, zoom: 1.2 });
  const initial = view.getState();
  view.orbitBy({ azimuthDeg: -30 });
  assert.equal(view.getState().azimuthDeg, 340);
  assert.notDeepEqual(view.getState(), initial);
  view.reset();
  assert.deepEqual(view.getState(), initial);

  const camera = view.getCamera();
  view.setCamera(camera);
  assertClose(view.getState().pan.x, 0, "restored pan.x");
  assertClose(view.getState().pan.y, 0, "restored pan.y");
  assertClose(view.getState().zoom, 1.2, "restored zoom");
});

test("legacy Diagrams derive an export camera without mutating the Artifact", async () => {
  const artifact = await readFixture();
  const before = structuredClone(artifact);
  const camera = resolveExportCamera(artifact);
  assert.deepEqual(camera, {
    ...CAMERA_DEFAULTS,
    target: { x: 0, y: 0 },
  });
  assert.deepEqual(artifact, before);
  assert.equal(Object.hasOwn(artifact, "exportSettings"), false);
});

test("export camera is a persisted setting outside Human Override and remains immutable by copy", async () => {
  const artifact = await readFixture();
  const next = withExportCamera(artifact, {
    ...CAMERA_DEFAULTS,
    target: { x: 22, y: -14 },
    azimuthDeg: 315,
  });
  assert.equal(Object.hasOwn(artifact, "exportSettings"), false);
  assert.deepEqual(next.exportSettings.camera.target, { x: 22, y: -14 });
  assert.equal(Object.hasOwn(next.layout.overrides, "camera"), false);
  assert.doesNotThrow(() => assertExportSettings(next.exportSettings));
  assert.doesNotThrow(() => assertDiagramArtifact(next));
});

test("persisted export camera is strict while malformed values do not silently fall back", async () => {
  const artifact = await readFixture();
  const camera = resolveExportCamera(artifact);
  const invalid = {
    ...structuredClone(artifact),
    exportSettings: { camera: { ...camera, elevationDeg: 90 } },
  };
  assert.throws(() => assertDiagramArtifact(invalid), /exportSettings\.camera\.elevationDeg/);
  assert.throws(() => resolveExportCamera(invalid), /exportSettings\.camera\.elevationDeg/);
});
