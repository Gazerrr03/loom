/**
 * Renderer-independent camera value used by persisted export settings and
 * capture requests. Workspace navigation may use a different ephemeral shape,
 * but it must be convertible to this stable Diagram-space value.
 */

const CAMERA_KEYS = [
  "projection",
  "preset",
  "azimuthDeg",
  "elevationDeg",
  "target",
  "orthoScale",
];
const TARGET_KEYS = ["x", "y"];

export const CAMERA_PROJECTION = "orthographic";
export const CAMERA_PRESET = "isometric";

export const CAMERA_DEFAULTS = Object.freeze({
  projection: CAMERA_PROJECTION,
  preset: CAMERA_PRESET,
  azimuthDeg: 45,
  elevationDeg: 35.264,
  target: Object.freeze({ x: 0, y: 0 }),
  orthoScale: 1,
});

export const CAMERA_LIMITS = Object.freeze({
  azimuthDeg: Object.freeze({ min: 0, max: 360 }),
  elevationDeg: Object.freeze({ min: 20, max: 70 }),
  orthoScale: Object.freeze({ min: 0.55, max: 2.4 }),
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertFiniteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
}

function assertExactKeys(value, expected, path) {
  const keys = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (JSON.stringify(keys) !== JSON.stringify(allowed)) {
    throw new Error(`${path} contains unsupported fields`);
  }
}

function assertTarget(target, path) {
  if (!isRecord(target)) throw new Error(`${path} must be an object`);
  assertExactKeys(target, TARGET_KEYS, path);
  for (const field of TARGET_KEYS) assertFiniteNumber(target[field], `${path}.${field}`);
  return target;
}

function wrapAzimuth(value) {
  const wrapped = ((value % CAMERA_LIMITS.azimuthDeg.max) + CAMERA_LIMITS.azimuthDeg.max)
    % CAMERA_LIMITS.azimuthDeg.max;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function clamp(value, range) {
  return Math.min(range.max, Math.max(range.min, value));
}

/** Validate a canonical camera without changing it. */
export function assertCamera(camera, path = "camera") {
  if (!isRecord(camera)) throw new TypeError(`${path} must be an object`);
  assertExactKeys(camera, CAMERA_KEYS, path);
  if (camera.projection !== CAMERA_PROJECTION) {
    throw new Error(`${path}.projection must be ${CAMERA_PROJECTION}`);
  }
  if (camera.preset !== CAMERA_PRESET) {
    throw new Error(`${path}.preset must be ${CAMERA_PRESET}`);
  }
  assertFiniteNumber(camera.azimuthDeg, `${path}.azimuthDeg`);
  if (camera.azimuthDeg < CAMERA_LIMITS.azimuthDeg.min || camera.azimuthDeg >= CAMERA_LIMITS.azimuthDeg.max) {
    throw new Error(`${path}.azimuthDeg must be in [0, 360)`);
  }
  assertFiniteNumber(camera.elevationDeg, `${path}.elevationDeg`);
  if (
    camera.elevationDeg < CAMERA_LIMITS.elevationDeg.min
    || camera.elevationDeg > CAMERA_LIMITS.elevationDeg.max
  ) {
    throw new Error(`${path}.elevationDeg must be between 20 and 70`);
  }
  assertTarget(camera.target, `${path}.target`);
  assertFiniteNumber(camera.orthoScale, `${path}.orthoScale`);
  if (
    camera.orthoScale < CAMERA_LIMITS.orthoScale.min
    || camera.orthoScale > CAMERA_LIMITS.orthoScale.max
  ) {
    throw new Error(`${path}.orthoScale must be between 0.55 and 2.4`);
  }
  return camera;
}

/**
 * Normalize interactive camera input. Persisted values use assertCamera and
 * therefore must already be canonical; interactive angles and scale may be
 * wrapped/clamped before an explicit setting is saved.
 */
export function normalizeCamera(camera = {}, { fallback = CAMERA_DEFAULTS } = {}) {
  if (!isRecord(camera)) throw new TypeError("camera must be an object");
  assertCamera(fallback, "camera fallback");
  const unknown = Object.keys(camera).filter((key) => !CAMERA_KEYS.includes(key));
  if (unknown.length > 0) throw new Error(`camera contains unsupported fields: ${unknown.join(", ")}`);
  const targetInput = camera.target === undefined ? fallback.target : camera.target;
  if (!isRecord(targetInput)) throw new Error("camera.target must be an object");
  const targetUnknown = Object.keys(targetInput).filter((key) => !TARGET_KEYS.includes(key));
  if (targetUnknown.length > 0) throw new Error(`camera.target contains unsupported fields: ${targetUnknown.join(", ")}`);
  const target = {
    x: targetInput.x ?? fallback.target.x,
    y: targetInput.y ?? fallback.target.y,
  };
  assertTarget(target, "camera.target");

  const projection = camera.projection ?? fallback.projection;
  const preset = camera.preset ?? fallback.preset;
  if (projection !== CAMERA_PROJECTION) throw new Error(`camera.projection must be ${CAMERA_PROJECTION}`);
  if (preset !== CAMERA_PRESET) throw new Error(`camera.preset must be ${CAMERA_PRESET}`);

  const azimuthDeg = camera.azimuthDeg ?? fallback.azimuthDeg;
  const elevationDeg = camera.elevationDeg ?? fallback.elevationDeg;
  const orthoScale = camera.orthoScale ?? fallback.orthoScale;
  assertFiniteNumber(azimuthDeg, "camera.azimuthDeg");
  assertFiniteNumber(elevationDeg, "camera.elevationDeg");
  assertFiniteNumber(orthoScale, "camera.orthoScale");

  return {
    projection,
    preset,
    azimuthDeg: wrapAzimuth(azimuthDeg),
    elevationDeg: clamp(elevationDeg, CAMERA_LIMITS.elevationDeg),
    target,
    orthoScale: clamp(orthoScale, CAMERA_LIMITS.orthoScale),
  };
}

/** Convert the legacy composition.defaultView into a canonical camera. */
export function cameraFromView(view, { target = CAMERA_DEFAULTS.target } = {}) {
  if (!isRecord(view)) throw new TypeError("view must be an object");
  const camera = normalizeCamera({
    projection: view.projection,
    preset: view.preset,
    azimuthDeg: view.azimuthDeg,
    elevationDeg: view.elevationDeg,
    target,
    orthoScale: view.zoom,
  });
  return assertCamera(camera);
}

export function cloneCamera(camera) {
  return clone(assertCamera(camera));
}

export { CAMERA_KEYS, TARGET_KEYS };
