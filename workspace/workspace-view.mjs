const DEFAULT_VIEW = Object.freeze({
  pan: Object.freeze({ x: 0, y: 0 }),
  zoom: 1,
  azimuthDeg: 45,
  elevationDeg: 35.264,
});

const LIMITS = Object.freeze({
  pan: Object.freeze({ min: -1200, max: 1200 }),
  zoom: Object.freeze({ min: 0.55, max: 2.4 }),
  azimuthDeg: Object.freeze({ min: 0, max: 360 }),
  elevationDeg: Object.freeze({ min: 20, max: 70 }),
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
    azimuthDeg: clamp(azimuthDeg, LIMITS.azimuthDeg),
    elevationDeg: clamp(elevationDeg, LIMITS.elevationDeg),
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

/** Keep camera navigation independent from the canonical Diagram Artifact. */
export function createWorkspaceView(initial = {}) {
  let current = normalizeView(initial);

  function state() {
    return clone(current);
  }

  function normalizeAndSet(patch) {
    current = normalizeView({ ...current, ...patch });
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
    current = normalizeView(DEFAULT_VIEW);
    return state();
  }

  return Object.freeze({
    getState: state,
    setPan,
    panBy,
    zoomBy,
    orbitBy,
    reset,
  });
}

export { DEFAULT_VIEW, DEFAULT_BASIS, LIMITS, VIEWPORT_CENTER, VIEW_ORIGIN };
