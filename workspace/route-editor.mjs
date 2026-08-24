import {
  applyDomainCommand,
  beginPreview,
  cancelPreview,
  commitPreview,
  updatePreview,
} from "../contracts/interaction-commit.mjs";
import { mergeEffectiveLayout } from "../contracts/layout.mjs";

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;

function clone(value) {
  return structuredClone(value);
}

function assertRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

function assertId(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error(`${path} must be a stable identifier`);
  }
  return value;
}

function assertPoint(point, path = "point") {
  assertRecord(point, path);
  if (typeof point.x !== "number" || !Number.isFinite(point.x)) throw new Error(`${path}.x must be a finite number`);
  if (typeof point.y !== "number" || !Number.isFinite(point.y)) throw new Error(`${path}.y must be a finite number`);
  if (point.elevation !== undefined && (typeof point.elevation !== "number" || !Number.isFinite(point.elevation))) {
    throw new Error(`${path}.elevation must be a finite number`);
  }
  return point;
}

function assertPointIndex(value, length) {
  if (!Number.isInteger(value) || value < 0 || value >= length) {
    throw new Error(`pointIndex must resolve to a route point (0-${Math.max(length - 1, 0)})`);
  }
  return value;
}

function routePoints(artifact, edgeId) {
  const routes = mergeEffectiveLayout(artifact.layout, artifact.composition.defaultView).routes;
  const points = routes[edgeId]?.points;
  if (!Array.isArray(points) || points.length < 2) return null;
  points.forEach((point, index) => assertPoint(point, `routes.${edgeId}.points[${index}]`));
  return points.map((point) => ({ ...point }));
}

function routeExists(artifact, edgeId) {
  return artifact.semantic.edges.some((edge) => edge.id === edgeId)
    && Object.hasOwn(artifact.layout.generated.routes, edgeId);
}

function commandValue(points) {
  return { points: points.map((point) => ({ ...point })) };
}

/**
 * Stateful, browser-safe controller for one route-point gesture.
 *
 * Every pointer move creates an ephemeral full point list. The canonical
 * artifact is replaced only by pointerUp, where one route replacement
 * command becomes one Human Override update.
 */
export function createRouteEditor({ artifact, revision, gesturePrefix = "workspace-route" } = {}) {
  assertRecord(artifact, "artifact");
  const initialRevision = revision ?? artifact.revision ?? `draft:${artifact.id}`;
  if (typeof initialRevision !== "string" || initialRevision.length === 0) throw new Error("revision must be a non-empty string");

  let canonical = clone(artifact);
  let active = null;
  let previewArtifact = null;
  let sequence = 0;
  let commits = [];

  function getRoutePoints(edgeId) {
    assertId(edgeId, "edgeId");
    if (!routeExists(canonical, edgeId)) return null;
    return routePoints(canonical, edgeId);
  }

  function state() {
    return {
      active: active ? {
        pointerId: active.pointerId,
        edgeId: active.edgeId,
        pointIndex: active.pointIndex,
        gestureId: active.gestureId,
        points: clone(active.points),
        frameCount: active.preview.frameCount,
      } : null,
      previewing: previewArtifact !== null,
      canonicalRevision: initialRevision,
      commitCount: commits.length,
      history: clone(commits),
    };
  }

  function begin({ edgeId, pointIndex, pointerId = null } = {}) {
    assertId(edgeId, "edgeId");
    if (!routeExists(canonical, edgeId)) return { accepted: false, reason: "edge-not-found", ...state() };
    if (active) throw new Error("a Route gesture is already active");
    const points = getRoutePoints(edgeId);
    if (!points) return { accepted: false, reason: "route-points-invalid", ...state() };
    const index = assertPointIndex(pointIndex, points.length);
    const gestureId = `${gesturePrefix}-${++sequence}`;
    active = {
      pointerId,
      edgeId,
      pointIndex: index,
      gestureId,
      points,
      preview: beginPreview({
        baseRevision: initialRevision,
        gestureId,
        commandType: "layout.route.replace-points",
        targetId: edgeId,
      }),
    };
    previewArtifact = null;
    return { accepted: true, ...state() };
  }

  function move({ diagramPoint } = {}) {
    if (!active) return { accepted: false, reason: "no-active-gesture", ...state() };
    assertPoint(diagramPoint, "diagramPoint");
    const points = clone(active.points);
    points[active.pointIndex] = { ...points[active.pointIndex], x: diagramPoint.x, y: diagramPoint.y };
    active.preview = updatePreview(active.preview, commandValue(points));
    previewArtifact = applyDomainCommand(canonical, {
      type: "layout.route.replace-points",
      targetId: active.edgeId,
      ...commandValue(points),
      baseRevision: initialRevision,
      gestureId: active.gestureId,
    });
    return { accepted: true, points: clone(points), ...state() };
  }

  function end({ diagramPoint } = {}) {
    if (!active) return { accepted: false, reason: "no-active-gesture", ...state() };
    if (diagramPoint !== undefined) move({ diagramPoint });
    if (active.preview.value === null) {
      const cancelled = cancelPreview(active.preview);
      active = null;
      previewArtifact = null;
      return { accepted: false, reason: "no-movement", phase: cancelled.phase, ...state() };
    }
    const { command, session } = commitPreview(active.preview);
    canonical = applyDomainCommand(canonical, command);
    commits = [...commits, { transactionId: command.gestureId, command: clone(command) }];
    active = null;
    previewArtifact = null;
    return { accepted: true, command: clone(command), session: clone(session), artifact: clone(canonical), ...state() };
  }

  function cancel() {
    if (!active) return { accepted: false, reason: "no-active-gesture", ...state() };
    const cancelled = cancelPreview(active.preview);
    active = null;
    previewArtifact = null;
    return { accepted: true, phase: cancelled.phase, ...state() };
  }

  return Object.freeze({
    getArtifact: () => clone(canonical),
    getDisplayArtifact: () => clone(previewArtifact ?? canonical),
    getRoutePoints,
    getState: () => state(),
    pointerDown: begin,
    pointerMove: move,
    pointerUp: end,
    cancel,
  });
}

export { routePoints };
