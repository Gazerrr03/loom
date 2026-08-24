import { assertDiagramArtifact } from "../core/artifact-store.mjs";
import { createCoreState, applyCoreCommand, assertCoreState } from "../core/diagram-core.mjs";
import {
  beginPreview,
  commitPreview,
  updatePreview,
} from "../contracts/interaction-commit.mjs";

const ANNOTATION_FIELDS = new Set(["text", "visualRole", "anchor", "properties"]);

function clone(value) {
  return structuredClone(value);
}

function assertId(value, path) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]*$/.test(value)) {
    throw new Error(`${path} must be a stable identifier`);
  }
}

function assertRevision(value, path) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
}

function assertPoints(points) {
  if (!Array.isArray(points) || points.length < 2) throw new Error("route points must contain at least two points");
  for (const [index, point] of points.entries()) {
    if (!point || typeof point !== "object" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error(`route points[${index}] must contain finite Diagram coordinates`);
    }
    if (point.elevation !== undefined && !Number.isFinite(point.elevation)) {
      throw new Error(`route points[${index}].elevation must be finite`);
    }
  }
}

/** Begin editing one route in Diagram coordinates without changing the Artifact. */
export function beginRouteEdit({ baseRevision, gestureId, edgeId }) {
  return beginPreview({
    baseRevision,
    gestureId,
    targetId: edgeId,
    commandType: "layout.route.replace-points",
  });
}

/** Return a new route preview frame; pointer coordinates must already be Diagram-space values. */
export function updateRouteEdit(preview, points) {
  assertPoints(points);
  return updatePreview(preview, { points: clone(points) });
}

/** Convert the final route frame into one Domain Command. */
export function commitRouteEdit(preview) {
  return commitPreview(preview);
}

function assertAnnotationPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).length === 0) {
    throw new Error("annotation patch must contain at least one field");
  }
  for (const field of Object.keys(patch)) {
    if (!ANNOTATION_FIELDS.has(field)) throw new Error(`annotation patch field is unsupported: ${field}`);
  }
  if (patch.text !== undefined && typeof patch.text !== "string") throw new Error("annotation.text must be a string");
  if (patch.visualRole !== undefined && (typeof patch.visualRole !== "string" || patch.visualRole.length === 0)) {
    throw new Error("annotation.visualRole must be a non-empty string");
  }
  if (patch.properties !== undefined && (!patch.properties || typeof patch.properties !== "object" || Array.isArray(patch.properties))) {
    throw new Error("annotation.properties must be an object");
  }
}

/** Build one immutable annotation update command for pointer-up or Inspector commit. */
export function createAnnotationEditCommand({ baseRevision, gestureId, annotationId, patch }) {
  assertRevision(baseRevision, "annotation command.baseRevision");
  assertId(gestureId, "annotation command.gestureId");
  assertId(annotationId, "annotation command.targetId");
  assertAnnotationPatch(patch);
  return Object.freeze({
    type: "annotation.update",
    targetId: annotationId,
    patch: clone(patch),
    baseRevision,
    gestureId,
  });
}

function assertAnnotationCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) throw new TypeError("annotation command must be an object");
  if (command.type !== "annotation.update") throw new Error(`Unsupported overlay command type: ${String(command.type)}`);
  assertId(command.targetId, "annotation command.targetId");
  assertRevision(command.baseRevision, "annotation command.baseRevision");
  assertId(command.gestureId, "annotation command.gestureId");
  assertAnnotationPatch(command.patch);
}

function applyAnnotationCommand(state, command) {
  assertCoreState(state);
  assertAnnotationCommand(command);
  if (state.revision !== null && command.baseRevision !== state.revision) {
    throw new Error("Core revision changed before annotation command");
  }
  const next = clone(state.artifact);
  const annotation = next.annotations.find((candidate) => candidate.id === command.targetId);
  if (!annotation) throw new Error(`annotation command target does not resolve: annotations.${command.targetId}`);
  Object.assign(annotation, clone(command.patch));
  assertDiagramArtifact(next);
  return createCoreState(next, {
    revision: state.revision,
    seed: next.layout.engine.seed,
  });
}

/** Apply a route or annotation edit through one overlay command boundary. */
export function applyOverlayCommand(state, command, options = {}) {
  if (command?.type === "annotation.update") return applyAnnotationCommand(state, command);
  if (command?.type === "layout.route.replace-points") return applyCoreCommand(state, command, options);
  throw new Error(`Unsupported overlay command type: ${String(command?.type)}`);
}

export { assertAnnotationPatch };

