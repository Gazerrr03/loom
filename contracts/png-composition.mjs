import { assertComposition } from "./composition.mjs";
import { assertPngCaptureRequest } from "./png-capture.mjs";

const COMPOSITION_FORMAT = "loom.png.composition";
const SCHEMA_VERSION = "0.1.0";
const LAYER_NAMES = ["scene", "routes", "phaseZones", "annotations"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

// Keep the composition boundary browser-safe. The full scene projection
// resolver is allowed to use Node-only parameter fingerprinting, but PNG
// composition only needs this persisted Scene Node shape check.
function assertSceneNode(sceneNodeValue) {
  if (!isRecord(sceneNodeValue)) throw new TypeError("Scene Node must be an object");
  for (const field of ["nodeId", "semanticType", "label", "status", "componentRef"]) {
    if (typeof sceneNodeValue[field] !== "string" || sceneNodeValue[field].length === 0) {
      throw new Error(`Scene Node ${field} must be a non-empty string`);
    }
  }
  if (!isRecord(sceneNodeValue.bounds)) throw new Error("Scene Node bounds must be an object");
  for (const field of ["x", "y", "width", "height"]) {
    if (typeof sceneNodeValue.bounds[field] !== "number" || !Number.isFinite(sceneNodeValue.bounds[field])) {
      throw new Error(`Scene Node bounds.${field} must be finite`);
    }
  }
  if (!isRecord(sceneNodeValue.worldBounds)) throw new Error("Scene Node worldBounds must be an object");
  for (const field of ["x", "y", "z", "width", "depth"]) {
    if (typeof sceneNodeValue.worldBounds[field] !== "number" || !Number.isFinite(sceneNodeValue.worldBounds[field])) {
      throw new Error(`Scene Node worldBounds.${field} must be finite`);
    }
  }
  if (sceneNodeValue.worldBounds.width < 0 || sceneNodeValue.worldBounds.depth < 0) {
    throw new Error("Scene Node worldBounds must have non-negative size");
  }
  for (const field of ["elevation", "rotationYDeg", "scale", "zIndex"]) {
    if (typeof sceneNodeValue[field] !== "number" || !Number.isFinite(sceneNodeValue[field])) {
      throw new Error(`Scene Node ${field} must be finite`);
    }
  }
  if (!isRecord(sceneNodeValue.parameters)) throw new Error("Scene Node parameters must be an object");
  if (!Array.isArray(sceneNodeValue.warnings)) throw new Error("Scene Node warnings must be an array");
  return sceneNodeValue;
}

function assertStableId(value, path) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]*$/.test(value)) throw new Error(`${path} must be a stable identifier`);
}

function assertLayerNameList(layers, path) {
  if (!Array.isArray(layers) || JSON.stringify(layers) !== JSON.stringify(LAYER_NAMES)) {
    throw new Error(`${path} must contain scene, routes, phaseZones and annotations in order`);
  }
}

function exportableItems(items, layerName, warnings) {
  if (items === undefined || items === null) {
    warnings.push(`${layerName} layer is unavailable; PNG will omit it.`);
    return [];
  }
  if (!Array.isArray(items)) throw new Error(`${layerName} layer must be an array`);
  const visible = items.filter((item) => item?.includeInExport !== false);
  if (visible.length === 0) warnings.push(`${layerName} layer contains no exportable items.`);
  return clone(visible);
}

function assertOverlayRevision(overlays, request) {
  if (overlays?.revision !== undefined && overlays.revision !== request.revision) {
    throw new Error("PNG composition overlay revision does not match the capture request");
  }
  if (overlays?.view !== undefined && JSON.stringify(overlays.view) !== JSON.stringify(request.view)) {
    throw new Error("PNG composition overlay view does not match the capture request");
  }
}

function assertSafeAreaGuides(guides, path) {
  if (!Array.isArray(guides)) throw new Error(`${path} must be an array`);
  guides.forEach((guide, index) => {
    if (!isRecord(guide)) throw new Error(`${path}[${index}] must be an object`);
    assertStableId(guide.id, `${path}[${index}].id`);
    if (!isRecord(guide.bounds)) throw new Error(`${path}[${index}].bounds must be an object`);
    for (const field of ["x", "y", "width", "height"]) {
      if (typeof guide.bounds[field] !== "number" || !Number.isFinite(guide.bounds[field])) throw new Error(`${path}[${index}].bounds.${field} must be finite`);
    }
  });
}

/**
 * Build the exact layer set that a PNG renderer may composite. Editor chrome
 * is deliberately not representable in this value.
 */
export function createPngComposition(request, { sceneNodes = null, overlays = null, composition = null } = {}) {
  assertPngCaptureRequest(request);
  if (composition !== null) assertComposition(composition);
  assertOverlayRevision(overlays, request);
  if (overlays?.includeEditorChrome === true) throw new Error("PNG composition cannot include editor chrome");

  const warnings = [];
  if (sceneNodes === null) warnings.push("scene layer is unavailable; PNG will omit it.");
  const scene = sceneNodes === null ? [] : (() => {
    if (!Array.isArray(sceneNodes)) throw new Error("scene layer must be an array");
    sceneNodes.forEach(assertSceneNode);
    return clone(sceneNodes);
  })();
  if (scene.length === 0) warnings.push("scene layer contains no exportable items.");

  const overlayValue = isRecord(overlays) ? overlays : {};
  const routes = exportableItems(overlayValue.routes, "routes", warnings);
  const phaseZones = exportableItems(overlayValue.phaseZones, "phaseZones", warnings);
  const annotations = exportableItems(overlayValue.annotations, "annotations", warnings);
  const safeAreaGuides = request.options.includeSafeAreaGuides
    ? (() => {
      if (composition === null) throw new Error("composition is required when safe-area guides are requested");
      return clone(composition.safeAreas);
    })()
    : [];

  return {
    format: COMPOSITION_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    artifactId: request.artifactId,
    revision: request.revision,
    view: clone(request.view),
    layers: [...LAYER_NAMES],
    scene,
    routes,
    phaseZones,
    annotations,
    safeAreaGuides,
    editorChrome: [],
    warnings,
  };
}

export function assertPngComposition(composition) {
  if (!isRecord(composition)) throw new TypeError("PNG composition must be an object");
  if (composition.format !== COMPOSITION_FORMAT) throw new Error(`Unsupported PNG composition format: ${String(composition.format)}`);
  if (composition.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported PNG composition schemaVersion: ${String(composition.schemaVersion)}`);
  assertStableId(composition.artifactId, "PNG composition.artifactId");
  if (typeof composition.revision !== "string" || composition.revision.length === 0) throw new Error("PNG composition.revision must be non-empty");
  if (!isRecord(composition.view)) throw new Error("PNG composition.view must be an object");
  assertLayerNameList(composition.layers, "PNG composition.layers");
  for (const layerName of ["scene", "routes", "phaseZones", "annotations", "safeAreaGuides", "editorChrome"]) {
    if (!Array.isArray(composition[layerName])) throw new Error(`PNG composition.${layerName} must be an array`);
  }
  composition.scene.forEach(assertSceneNode);
  if (composition.editorChrome.length !== 0) throw new Error("PNG composition.editorChrome must be empty");
  assertSafeAreaGuides(composition.safeAreaGuides, "PNG composition.safeAreaGuides");
  if (!Array.isArray(composition.warnings) || composition.warnings.some((warning) => typeof warning !== "string" || warning.length === 0)) {
    throw new Error("PNG composition.warnings must contain non-empty strings");
  }
  return composition;
}

export { COMPOSITION_FORMAT, LAYER_NAMES, SCHEMA_VERSION };
