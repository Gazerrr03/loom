import {
  assertCamera,
  CAMERA_DEFAULTS,
  CAMERA_LIMITS,
  normalizeCamera,
} from "../contracts/camera.mjs";

const DEFAULT_VIEW = Object.freeze({
  pan: Object.freeze({ x: 0, y: 0 }),
  zoom: CAMERA_DEFAULTS.orthoScale,
  azimuthDeg: CAMERA_DEFAULTS.azimuthDeg,
  elevationDeg: CAMERA_DEFAULTS.elevationDeg,
});

const LIMITS = Object.freeze({
  pan: Object.freeze({ min: -1200, max: 1200 }),
  zoom: CAMERA_LIMITS.orthoScale,
  azimuthDeg: CAMERA_LIMITS.azimuthDeg,
  elevationDeg: CAMERA_LIMITS.elevationDeg,
});

const DEFAULT_BASIS = Object.freeze({
  xFromX: 1.42,
  xFromY: 0.56,
  yFromX: -0.2,
  yFromY: 0.66,
});
const VIEWPORT_CENTER = Object.freeze({ x: 550, y: 350 });
const VIEW_ORIGIN = Object.freeze({ x: 82, y: 568 });

function clone(value) {
  return structuredClone(value);
}

function assertFinite(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(path + " must be a finite number");
}

function clamp(value, range) {
  return Math.min(range.max, Math.max(range.min, value));
}

function wrapAzimuth(value) {
  const wrapped = ((value % LIMITS.azimuthDeg.max) + LIMITS.azimuthDeg.max) % LIMITS.azimuthDeg.max;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function normalizePan(pan) {
  if (!pan || typeof pan !== "object" || Array.isArray(pan)) throw new Error("view.pan must be an object");
  assertFinite(pan.x, "view.pan.x");
  assertFinite(pan.y, "view.pan.y");
  return {
    x: clamp(pan.x, LIMITS.pan),
    y: clamp(pan.y, LIMITS.pan),
  };
}

function normalizeView(view = {}) {
  if (!view || typeof view !== "object" || Array.isArray(view)) throw new Error("view must be an object");
  const pan = normalizePan(view.pan ?? DEFAULT_VIEW.pan);
  const zoom = view.zoom ?? DEFAULT_VIEW.zoom;
  const azimuthDeg = view.azimuthDeg ?? DEFAULT_VIEW.azimuthDeg;
  const elevationDeg = view.elevationDeg ?? DEFAULT_VIEW.elevationDeg;
  assertFinite(zoom, "view.zoom");
  assertFinite(azimuthDeg, "view.azimuthDeg");
  assertFinite(elevationDeg, "view.elevationDeg");
  return {
    pan,
    zoom: clamp(zoom, LIMITS.zoom),
    azimuthDeg: wrapAzimuth(azimuthDeg),
    elevationDeg: clamp(elevationDeg, LIMITS.elevationDeg),
  };
}

function basisProjection(basis, target) {
  return {
    x: basis.xFromX * target.x + basis.xFromY * target.y,
    y: basis.yFromX * target.x + basis.yFromY * target.y,
  };
}

function rotateVector(vector, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos,
  };
}

/**
 * Derive the screen basis used by the isometric transform from view-only
 * orbit state. The default exactly matches the Golden Case projection.
 */
export function viewBasis(view = DEFAULT_VIEW) {
  const normalized = normalizeView(view);
  const delta = (normalized.azimuthDeg - DEFAULT_VIEW.azimuthDeg) * Math.PI / 180;
  const tilt = Math.sin(normalized.elevationDeg * Math.PI / 180)
    / Math.sin(DEFAULT_VIEW.elevationDeg * Math.PI / 180);
  const xVector = rotateVector({ x: DEFAULT_BASIS.xFromX, y: DEFAULT_BASIS.yFromX }, delta);
  const yVector = rotateVector({ x: DEFAULT_BASIS.xFromY, y: DEFAULT_BASIS.yFromY }, delta);
  return {
    xFromX: xVector.x,
    xFromY: yVector.x,
    yFromX: xVector.y * tilt,
    yFromY: yVector.y * tilt,
  };
}

/** Convert a session view into the stable, composition-space camera value. */
export function cameraFromWorkspaceView(view = DEFAULT_VIEW) {
  const normalized = normalizeView(view);
  const basis = viewBasis(normalized);
  const determinant = basis.xFromX * basis.yFromY - basis.xFromY * basis.yFromX;
  const projectedTarget = {
    x: -normalized.pan.x / normalized.zoom,
    y: -normalized.pan.y / normalized.zoom,
  };
  const target = {
    x: (projectedTarget.x * basis.yFromY - projectedTarget.y * basis.xFromY) / determinant,
    y: (basis.xFromX * projectedTarget.y - basis.yFromX * projectedTarget.x) / determinant,
  };
  return assertCamera({
    projection: CAMERA_DEFAULTS.projection,
    preset: CAMERA_DEFAULTS.preset,
    azimuthDeg: normalized.azimuthDeg,
    elevationDeg: normalized.elevationDeg,
    target,
    orthoScale: normalized.zoom,
  });
}

/** Convert a canonical camera into the current browser's ephemeral view shape. */
export function workspaceViewFromCamera(camera) {
  const normalized = normalizeCamera(camera);
  const view = {
    pan: { x: 0, y: 0 },
    zoom: normalized.orthoScale,
    azimuthDeg: normalized.azimuthDeg,
    elevationDeg: normalized.elevationDeg,
  };
  const projectedTarget = basisProjection(viewBasis(view), normalized.target);
  view.pan = {
    x: -normalized.orthoScale * projectedTarget.x,
    y: -normalized.orthoScale * projectedTarget.y,
  };
  return normalizeView(view);
}

/** Keep camera navigation independent from the canonical Diagram Artifact. */
export function createWorkspaceView(initial = {}) {
  let baseline = normalizeView(initial);
  let current = clone(baseline);

  function state() {
    return clone(current);
  }

  function normalizeAndSet(patch) {
    current = normalizeView({ ...current, ...patch });
    return state();
  }

  function setDefaultView(view = DEFAULT_VIEW) {
    baseline = normalizeView(view);
    current = clone(baseline);
    return state();
  }

  function setCamera(camera) {
    current = workspaceViewFromCamera(camera);
    return state();
  }

  function setPan(pan) {
    return normalizeAndSet({ pan });
  }

  function panBy(delta = {}) {
    if (!delta || typeof delta !== "object") throw new Error("pan delta must be an object");
    assertFinite(delta.x, "pan delta.x");
    assertFinite(delta.y, "pan delta.y");
    return setPan({
      x: current.pan.x + delta.x,
      y: current.pan.y + delta.y,
    });
  }

  function zoomBy(factor, { anchor = VIEWPORT_CENTER } = {}) {
    assertFinite(factor, "zoom factor");
    if (factor <= 0) throw new Error("zoom factor must be greater than zero");
    if (!anchor || typeof anchor !== "object") throw new Error("zoom anchor must be an object");
    assertFinite(anchor.x, "zoom anchor.x");
    assertFinite(anchor.y, "zoom anchor.y");
    const nextZoom = clamp(current.zoom * factor, LIMITS.zoom);
    const ratio = nextZoom / current.zoom;
    return normalizeAndSet({
      zoom: nextZoom,
      pan: {
        x: ratio * (VIEW_ORIGIN.x + current.pan.x - anchor.x) + anchor.x - VIEW_ORIGIN.x,
        y: ratio * (VIEW_ORIGIN.y + current.pan.y - anchor.y) + anchor.y - VIEW_ORIGIN.y,
      },
    });
  }

  function orbitBy({ azimuthDeg = 0, elevationDeg = 0 } = {}) {
    assertFinite(azimuthDeg, "orbit azimuthDeg");
    assertFinite(elevationDeg, "orbit elevationDeg");
    return normalizeAndSet({
      azimuthDeg: current.azimuthDeg + azimuthDeg,
      elevationDeg: current.elevationDeg + elevationDeg,
    });
  }

  function reset() {
    current = clone(baseline);
    return state();
  }

  return Object.freeze({
    getState: state,
    getCamera: () => cameraFromWorkspaceView(current),
    setCamera,
    setDefaultView,
    setPan,
    panBy,
    zoomBy,
    orbitBy,
    reset,
  });
}

export { DEFAULT_VIEW, DEFAULT_BASIS, LIMITS, VIEWPORT_CENTER, VIEW_ORIGIN };
