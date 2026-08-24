import {
  applyDomainCommand,
  beginPreview,
  cancelPreview,
  commitPreview,
  updatePreview,
} from "../contracts/interaction-commit.mjs";
import { mergeEffectiveLayout } from "../contracts/layout.mjs";

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const ROUTE_GRID_SIZE = 1;

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

function snap(value) {
  return Math.round(value / ROUTE_GRID_SIZE) * ROUTE_GRID_SIZE;
}

function axisBetween(left, right) {
  if (left.x === right.x) return "vertical";
  if (left.y === right.y) return "horizontal";
  return Math.abs(right.x - left.x) >= Math.abs(right.y - left.y) ? "horizontal" : "vertical";
}

/**
 * Move one point while keeping the route on horizontal/vertical grid edges.
 * Corner handles move the adjacent segment with them; endpoints slide along
 * their only connected segment. Values are rounded to the Diagram grid.
 */
export function editRoutePoint(points, pointIndex, target) {
  if (!Array.isArray(points) || points.length < 2) throw new Error("points must contain at least two points");
  points.forEach((point, index) => assertPoint(point, `points[${index}]`));
  assertPoint(target, "target");
  const index = assertPointIndex(pointIndex, points.length);
  const next = points.map((point) => ({ ...point }));
  const current = next[index];
  const desired = { x: snap(target.x), y: snap(target.y) };

  if (index === 0) {
    if (axisBetween(next[0], next[1]) === "horizontal") next[0].x = desired.x;
    else next[0].y = desired.y;
    return next;
  }
  if (index === next.length - 1) {
    if (axisBetween(next[index - 1], next[index]) === "horizontal") next[index].x = desired.x;
    else next[index].y = desired.y;
    return next;
  }

  const incoming = axisBetween(next[index - 1], current);
  const outgoing = axisBetween(current, next[index + 1]);
  const moveX = Math.abs(desired.x - current.x) >= Math.abs(desired.y - current.y);
  if (incoming === "horizontal" && outgoing === "vertical") {
    if (moveX) {
      next[index].x = desired.x;
      next[index + 1].x = desired.x;
    } else {
      next[index].y = desired.y;
      next[index - 1].y = desired.y;
    }
    return next;
  }
  if (incoming === "vertical" && outgoing === "horizontal") {
    if (moveX) {
      next[index].x = desired.x;
      next[index - 1].x = desired.x;
    } else {
      next[index].y = desired.y;
      next[index + 1].y = desired.y;
    }
    return next;
  }
  if (incoming === "horizontal") {
    if (moveX) next[index].x = desired.x;
    else [next[index - 1], next[index], next[index + 1]].forEach((point) => { point.y = desired.y; });
  } else {
    if (moveX) [next[index - 1], next[index], next[index + 1]].forEach((point) => { point.x = desired.x; });
    else next[index].y = desired.y;
  }
  return next;
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
    const points = editRoutePoint(active.points, active.pointIndex, diagramPoint);
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
export { ROUTE_GRID_SIZE };
