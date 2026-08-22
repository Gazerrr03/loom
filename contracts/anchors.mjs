import { assertDiagramPoint } from "./coordinates.mjs";
import { mergeEffectiveLayout } from "./layout.mjs";

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertFinitePoint(point, path) {
  if (!isRecord(point)) throw new Error(`${path} must be an object`);
  for (const field of ["x", "y"]) {
    if (typeof point[field] !== "number" || !Number.isFinite(point[field])) throw new Error(`${path}.${field} must be a finite number`);
  }
  if (point.elevation !== undefined && (typeof point.elevation !== "number" || !Number.isFinite(point.elevation))) {
    throw new Error(`${path}.elevation must be a finite number`);
  }
}

function addOffset(point, offset) {
  if (!offset) return { ...point };
  return {
    x: point.x + offset.x,
    y: point.y + offset.y,
    ...(point.elevation !== undefined || offset.elevation !== undefined
      ? { elevation: (point.elevation ?? 0) + (offset.elevation ?? 0) }
      : {}),
  };
}

function centerOf(rect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    ...(rect.elevation === undefined ? {} : { elevation: rect.elevation }),
  };
}

function routeMidpoint(points) {
  let total = 0;
  const lengths = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    lengths.push(length);
    total += length;
  }
  if (total === 0) return { ...points[0] };
  let travelled = 0;
  const target = total / 2;
  for (let index = 1; index < points.length; index += 1) {
    const length = lengths[index - 1];
    if (travelled + length >= target) {
      const from = points[index - 1];
      const to = points[index];
      const ratio = length === 0 ? 0 : (target - travelled) / length;
      return {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
        ...(from.elevation !== undefined || to.elevation !== undefined
          ? { elevation: (from.elevation ?? 0) + ((to.elevation ?? 0) - (from.elevation ?? 0)) * ratio }
          : {}),
      };
    }
    travelled += length;
  }
  return { ...points.at(-1) };
}

function semanticTargetMap(semantic) {
  if (!isRecord(semantic)) throw new Error("semantic must be an object");
  const map = new Map();
  for (const kind of ["nodes", "edges", "groups"]) {
    if (!Array.isArray(semantic[kind])) throw new Error(`semantic.${kind} must be an array`);
    for (const item of semantic[kind]) {
      if (!isRecord(item) || typeof item.id !== "string" || !ID_PATTERN.test(item.id)) throw new Error(`semantic.${kind} contains an invalid ID`);
      if (map.has(item.id)) throw new Error(`Duplicate semantic ID: ${item.id}`);
      map.set(item.id, { kind: kind.slice(0, -1), item });
    }
  }
  return map;
}

function assertAnnotationTarget(annotation, targets, composition) {
  if (!isRecord(annotation)) throw new TypeError("annotation must be an object");
  if (typeof annotation.id !== "string" || !ID_PATTERN.test(annotation.id)) throw new Error("annotation.id must be a stable identifier");
  if (!isRecord(annotation.anchor)) throw new Error(`annotations.${annotation.id}.anchor must be an object`);
  const anchor = annotation.anchor;
  if (anchor.kind === "canvas") {
    assertDiagramPoint(anchor.position, composition.canvas, `annotations.${annotation.id}.anchor.position`);
    return;
  }
  if (!["node", "edge", "group"].includes(anchor.kind)) throw new Error(`Unsupported annotation anchor kind: ${String(anchor.kind)}`);
  if (typeof anchor.targetId !== "string" || !ID_PATTERN.test(anchor.targetId)) throw new Error(`annotations.${annotation.id}.anchor.targetId must be a stable identifier`);
  const target = targets.get(anchor.targetId);
  if (!target || target.kind !== anchor.kind) throw new Error(`annotations.${annotation.id}.anchor.targetId does not resolve to a ${anchor.kind}: ${anchor.targetId}`);
  if (anchor.offset !== undefined) assertFinitePoint(anchor.offset, `annotations.${annotation.id}.anchor.offset`);
}

export function assertRouteControlPoints(artifact, effectiveLayout = mergeEffectiveLayout(artifact.layout, artifact.composition.defaultView)) {
  const routes = effectiveLayout?.routes;
  if (!isRecord(routes)) throw new Error("effectiveLayout.routes must be an object");
  for (const edge of artifact.semantic.edges) {
    const route = routes[edge.id];
    if (!isRecord(route) || !Array.isArray(route.points) || route.points.length < 2) {
      throw new Error(`Route ${edge.id} must contain at least two Diagram points`);
    }
    route.points.forEach((point, index) => assertDiagramPoint(point, artifact.composition.canvas, `layout.routes.${edge.id}.points[${index}]`));
  }
  return effectiveLayout;
}

export function moveRouteControlPoint(route, index, point, canvas) {
  if (!isRecord(route) || !Array.isArray(route.points) || route.points.length < 2) throw new Error("route must contain at least two points");
  if (!Number.isInteger(index) || index < 0 || index >= route.points.length) throw new RangeError("route control point index is out of range");
  assertDiagramPoint(point, canvas, `route.points[${index}]`);
  const next = clone(route);
  next.points[index] = { ...point };
  return next;
}

export function resolveAnnotationAnchor(annotation, artifact, effectiveLayout = mergeEffectiveLayout(artifact.layout, artifact.composition.defaultView)) {
  const targets = semanticTargetMap(artifact.semantic);
  assertAnnotationTarget(annotation, targets, artifact.composition);
  const anchor = annotation.anchor;
  if (anchor.kind === "canvas") return { x: anchor.position.x, y: anchor.position.y, ...(anchor.position.elevation === undefined ? {} : { elevation: anchor.position.elevation }) };

  const targetLayout = effectiveLayout[anchor.kind === "node" ? "nodes" : anchor.kind === "edge" ? "routes" : "groups"]?.[anchor.targetId];
  if (!targetLayout) throw new Error(`Missing effective layout for ${anchor.kind}: ${anchor.targetId}`);
  const base = anchor.kind === "node"
    ? centerOf(targetLayout)
    : anchor.kind === "group"
      ? centerOf(targetLayout.bounds)
      : routeMidpoint(targetLayout.points);
  return addOffset(base, anchor.offset);
}

export function resolveAnnotationAnchors(artifact, effectiveLayout = mergeEffectiveLayout(artifact.layout, artifact.composition.defaultView)) {
  if (!Array.isArray(artifact.annotations)) throw new Error("annotations must be an array");
  assertRouteControlPoints(artifact, effectiveLayout);
  const targets = semanticTargetMap(artifact.semantic);
  return Object.fromEntries(artifact.annotations.map((annotation) => {
    assertAnnotationTarget(annotation, targets, artifact.composition);
    return [annotation.id, resolveAnnotationAnchor(annotation, artifact, effectiveLayout)];
  }));
}
