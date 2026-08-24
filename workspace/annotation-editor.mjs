import { resolveAnnotationAnchor } from "../contracts/anchors.mjs";
import { assertPresentationBoundary } from "../contracts/presentation.mjs";

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const ANNOTATION_FIELDS = new Set(["text", "visualRole", "anchor", "properties"]);

function clone(value) {
  return structuredClone(value);
}

function assertRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function assertId(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`${path} must be a stable identifier`);
  return value;
}

function assertFinite(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
}

function assertPoint(point, path) {
  assertRecord(point, path);
  assertFinite(point.x, `${path}.x`);
  assertFinite(point.y, `${path}.y`);
  if (point.elevation !== undefined) assertFinite(point.elevation, `${path}.elevation`);
}

function assertAnchor(anchor) {
  assertRecord(anchor, "annotation.anchor");
  if (!["canvas", "node", "edge", "group"].includes(anchor.kind)) throw new Error("annotation.anchor.kind is unsupported");
  if (anchor.kind === "canvas") assertPoint(anchor.position, "annotation.anchor.position");
  else {
    assertId(anchor.targetId, "annotation.anchor.targetId");
    if (anchor.offset !== undefined) assertPoint(anchor.offset, "annotation.anchor.offset");
  }
}

export function assertAnnotationPatch(patch) {
  assertRecord(patch, "annotation patch");
  if (Object.keys(patch).length === 0) throw new Error("annotation patch must contain at least one field");
  for (const field of Object.keys(patch)) if (!ANNOTATION_FIELDS.has(field)) throw new Error(`annotation patch field is unsupported: ${field}`);
  if (patch.text !== undefined && (typeof patch.text !== "string" || patch.text.trim().length === 0)) throw new Error("annotation.text must not be empty");
  if (patch.visualRole !== undefined && (typeof patch.visualRole !== "string" || patch.visualRole.trim().length === 0)) throw new Error("annotation.visualRole must be non-empty");
  if (patch.anchor !== undefined) assertAnchor(patch.anchor);
  if (patch.properties !== undefined) assertRecord(patch.properties, "annotation.properties");
  return patch;
}

export function createAnnotationEditCommand({ baseRevision, gestureId, annotationId, patch }) {
  if (typeof baseRevision !== "string" || baseRevision.length === 0) throw new Error("annotation command.baseRevision must be non-empty");
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

export function applyAnnotationCommand(artifact, command) {
  assertRecord(artifact, "artifact");
  assertRecord(command, "annotation command");
  if (command.type !== "annotation.update") throw new Error(`Unsupported annotation command type: ${String(command.type)}`);
  const next = clone(artifact);
  const annotation = next.annotations?.find((candidate) => candidate.id === command.targetId);
  if (!annotation) throw new Error(`annotation command target does not resolve: annotations.${command.targetId}`);
  assertAnnotationPatch(command.patch);
  Object.assign(annotation, clone(command.patch));
  assertPresentationBoundary({
    semantic: next.semantic,
    annotations: next.annotations,
    presentation: next.presentation,
    assets: next.assets,
  });
  resolveAnnotationAnchor(annotation, next);
  return next;
}

export function createAnnotationEditor({ artifact, revision, gesturePrefix = "workspace-annotation" } = {}) {
  assertRecord(artifact, "artifact");
  const initialRevision = revision ?? artifact.revision ?? `draft:${artifact.id}`;
  if (typeof initialRevision !== "string" || initialRevision.length === 0) throw new Error("revision must be non-empty");
  let canonical = clone(artifact);
  let active = null;
  let previewArtifact = null;
  let sequence = 0;
  let commits = [];

  function annotationById(annotationId) {
    assertId(annotationId, "annotationId");
    return canonical.annotations?.find((annotation) => annotation.id === annotationId) ?? null;
  }

  function state() {
    return {
      active: active ? {
        annotationId: active.annotationId,
        gestureId: active.gestureId,
        patch: clone(active.patch),
      } : null,
      previewing: previewArtifact !== null,
      canonicalRevision: initialRevision,
      commitCount: commits.length,
      history: clone(commits),
    };
  }

  function begin({ annotationId, gestureId = null } = {}) {
    assertId(annotationId, "annotationId");
    if (!annotationById(annotationId)) return { accepted: false, reason: "annotation-not-found", ...state() };
    if (active) throw new Error("an Annotation edit is already active");
    const nextGestureId = gestureId ?? `${gesturePrefix}-${++sequence}`;
    assertId(nextGestureId, "gestureId");
    active = { annotationId, gestureId: nextGestureId, patch: {} };
    previewArtifact = null;
    return { accepted: true, ...state() };
  }

  function preview({ patch } = {}) {
    if (!active) return { accepted: false, reason: "no-active-edit", ...state() };
    assertAnnotationPatch(patch);
    active.patch = { ...active.patch, ...clone(patch) };
    const command = createAnnotationEditCommand({
      baseRevision: initialRevision,
      gestureId: active.gestureId,
      annotationId: active.annotationId,
      patch: active.patch,
    });
    previewArtifact = applyAnnotationCommand(canonical, command);
    return { accepted: true, artifact: clone(previewArtifact), ...state() };
  }

  function commit({ patch } = {}) {
    if (!active) return { accepted: false, reason: "no-active-edit", ...state() };
    if (patch !== undefined) preview({ patch });
    if (Object.keys(active.patch).length === 0) return cancel({ reason: "no-change" });
    const command = createAnnotationEditCommand({
      baseRevision: initialRevision,
      gestureId: active.gestureId,
      annotationId: active.annotationId,
      patch: active.patch,
    });
    canonical = applyAnnotationCommand(canonical, command);
    commits = [...commits, { transactionId: command.gestureId, command: clone(command) }];
    active = null;
    previewArtifact = null;
    return { accepted: true, command: clone(command), artifact: clone(canonical), ...state() };
  }

  function cancel({ reason = "cancelled" } = {}) {
    if (!active) return { accepted: false, reason: "no-active-edit", ...state() };
    active = null;
    previewArtifact = null;
    return { accepted: false, reason, phase: "cancelled", ...state() };
  }

  return Object.freeze({
    getArtifact: () => clone(canonical),
    getDisplayArtifact: () => clone(previewArtifact ?? canonical),
    getState: () => state(),
    annotationById,
    begin,
    preview,
    commit,
    cancel,
  });
}
