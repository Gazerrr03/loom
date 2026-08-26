import {
  assertCamera,
  cameraFromView,
  cloneCamera,
  normalizeCamera,
} from "./camera.mjs";

const EXPORT_SETTINGS_KEYS = ["camera"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertExactKeys(value, expected, path) {
  const keys = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (JSON.stringify(keys) !== JSON.stringify(allowed)) {
    throw new Error(`${path} contains unsupported fields`);
  }
}

/** Validate the persisted, non-runtime export settings boundary. */
export function assertExportSettings(settings, path = "exportSettings") {
  if (settings === undefined) return null;
  if (!isRecord(settings)) throw new TypeError(`${path} must be an object`);
  assertExactKeys(settings, EXPORT_SETTINGS_KEYS, path);
  assertCamera(settings.camera, `${path}.camera`);
  return settings;
}

/**
 * Resolve the camera used by an export. An absent setting is a legacy Diagram
 * and derives its stable camera from composition.defaultView without writing
 * the derived value back into the artifact.
 */
export function resolveExportCamera(artifact, override) {
  if (!isRecord(artifact)) throw new TypeError("artifact must be an object");
  if (!isRecord(artifact.composition)) throw new Error("artifact.composition must be an object");
  if (override !== undefined) return cloneCamera(override);
  if (artifact.exportSettings !== undefined) {
    assertExportSettings(artifact.exportSettings);
    return cloneCamera(artifact.exportSettings.camera);
  }
  return cameraFromView(artifact.composition.defaultView);
}

/** Build a canonical persisted export settings object from interactive input. */
export function createExportSettings(camera) {
  return { camera: normalizeCamera(camera) };
}

/** Return a copy of an artifact with only its export camera changed. */
export function withExportCamera(artifact, camera) {
  if (!isRecord(artifact)) throw new TypeError("artifact must be an object");
  if (artifact.exportSettings !== undefined) assertExportSettings(artifact.exportSettings);
  const next = clone(artifact);
  next.exportSettings = createExportSettings(camera);
  assertExportSettings(next.exportSettings);
  return next;
}

export { EXPORT_SETTINGS_KEYS };
