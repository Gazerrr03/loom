import { createDiagramError, DiagramContractError } from "./diagram-error.mjs";

// These keys describe a different coordinate space from the canonical
// Diagram x/y/elevation contract. `zIndex` is intentionally not included: it
// is a 2D painter-order value, not a world coordinate.
const UNSUPPORTED_COORDINATE_KEYS = new Set([
  "z",
  "depth",
  "world",
  "worldx",
  "worldy",
  "worldz",
  "worldpoint",
  "worldposition",
  "worldbounds",
  "position3d",
  "coordinates3d",
  "coordinatespace",
  "worldspace",
]);

const RENDERER_STATE_KEYS = new Set([
  "runtime",
  "scene",
  "scenetree",
  "mesh",
  "geometry",
  "material",
  "gpu",
  "gpustate",
  "shader",
  "camera",
  "camerastate",
  "renderer",
  "rendererstate",
  "renderertree",
  "cache",
]);

const SAFE_PATH_SEGMENT = /^[A-Za-z_$][\w$]*$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedKey(key) {
  return key.toLowerCase().replace(/[-_]/g, "");
}

function childPath(path, key) {
  return SAFE_PATH_SEGMENT.test(key) ? `${path}.${key}` : path;
}

function contractError(code, message, fieldPath) {
  return new DiagramContractError(createDiagramError({
    code,
    message,
    fieldPath,
    recoverable: false,
    suggestedAction: code === "unsupported-coordinate-space"
      ? "Keep persisted positions in Diagram x/y with optional elevation; let Workspace derive world X/Z/Y."
      : "Remove Renderer-private runtime state and save only the renderer-independent Diagram artifact.",
  }));
}

function inspectPersistedKeys(value, path, seen = new Set()) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectPersistedKeys(item, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    const fieldPath = childPath(path, key);
    if (UNSUPPORTED_COORDINATE_KEYS.has(normalized)) {
      throw contractError(
        "unsupported-coordinate-space",
        `Persisted coordinate field "${key}" is not supported by the Diagram contract.`,
        path,
      );
    }
    if (RENDERER_STATE_KEYS.has(normalized)) {
      throw contractError(
        "renderer-state-not-persistable",
        `Renderer-private state "${key}" cannot be persisted in a Diagram artifact.`,
        path,
      );
    }

    // Component parameters and semantic properties are user data. They may
    // describe a component without becoming a second coordinate/runtime
    // source of truth, so this boundary does not inspect their arbitrary keys.
    if (normalized === "parameters" || normalized === "properties") continue;
    inspectPersistedKeys(child, fieldPath, seen);
  }
  seen.delete(value);
}

/**
 * Reject only data that would make an Artifact depend on a second coordinate
 * space or a Renderer runtime. Existing x/y/elevation Golden Cases pass
 * through unchanged; unsupported future data receives a structured block.
 */
export function assertPersistedDiagramBoundary(artifact) {
  if (!isRecord(artifact)) return artifact;
  inspectPersistedKeys(artifact, "artifact");
  return artifact;
}
