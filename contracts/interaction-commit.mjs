/**
 * Preview/commit boundary for direct-manipulation gestures.
 *
 * Preview frames are ephemeral values owned by a session. Only commitPreview
 * creates a Domain Command; applyDomainCommand is the small Core-side write
 * boundary that turns that command into one Human Override update.
 */

import { assertComposition } from "./composition.mjs";
import { assertLayout } from "./layout.mjs";
import { assertOrthogonalRoute } from "./route-geometry.mjs";
import { assertSemanticGraph } from "./semantic-graph.mjs";

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const ACTIVE = "active";
const COMMAND_TYPES = new Set([
  "layout.node.move",
  "layout.node.elevation",
  "layout.node.rotate-y",
  "layout.node.scale",
  "layout.node.z-index",
  "layout.route.replace-points",
  "layout.view.change",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function assertId(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`${path} must be a stable identifier`);
}

function assertFiniteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
}

function assertPoint(point, path) {
  if (!isRecord(point)) throw new Error(`${path} must be an object`);
  assertFiniteNumber(point.x, `${path}.x`);
  assertFiniteNumber(point.y, `${path}.y`);
  if (point.elevation !== undefined) assertFiniteNumber(point.elevation, `${path}.elevation`);
}

function assertPoints(points, path) {
  if (!Array.isArray(points) || points.length < 2) throw new Error(`${path} must contain at least two points`);
  points.forEach((point, index) => assertPoint(point, `${path}[${index}]`));
  assertOrthogonalRoute(points, path);
}

function assertPreviewValue(type, value, path = "preview.value") {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  if (type === "layout.node.move") {
    assertFiniteNumber(value.x, `${path}.x`);
    assertFiniteNumber(value.y, `${path}.y`);
    return;
  }
  if (type === "layout.node.elevation") {
    assertFiniteNumber(value.elevation, `${path}.elevation`);
    return;
  }
  if (type === "layout.node.rotate-y") {
    assertFiniteNumber(value.rotationYDeg, `${path}.rotationYDeg`);
    return;
  }
  if (type === "layout.node.scale") {
    assertFiniteNumber(value.scale, `${path}.scale`);
    if (value.scale <= 0) throw new Error(`${path}.scale must be greater than zero`);
    return;
  }
  if (type === "layout.node.z-index") {
    if (!Number.isInteger(value.zIndex)) throw new Error(`${path}.zIndex must be an integer`);
    return;
  }
  if (type === "layout.route.replace-points") {
    assertPoints(value.points, `${path}.points`);
    return;
  }
  if (type === "layout.view.change") {
    const fields = ["azimuthDeg", "elevationDeg", "zoom"];
    if (Object.keys(value).length === 0 || Object.keys(value).some((field) => !fields.includes(field))) {
      throw new Error(`${path} must contain at least one supported view field`);
    }
    for (const field of fields) {
      if (value[field] !== undefined) assertFiniteNumber(value[field], `${path}.${field}`);
      if (field === "zoom" && value[field] !== undefined && value[field] <= 0) {
        throw new Error(`${path}.zoom must be greater than zero`);
      }
    }
    return;
  }
  throw new Error(`Unsupported preview command type: ${type}`);
}

function assertSession(session) {
  if (!isRecord(session)) throw new TypeError("preview session must be an object");
  if (![ACTIVE, "cancelled", "committed"].includes(session.phase)) throw new Error("preview session has an invalid phase");
  assertId(session.gestureId, "preview.gestureId");
  if (typeof session.baseRevision !== "string" || session.baseRevision.length === 0) {
    throw new Error("preview.baseRevision must be a non-empty string");
  }
  if (!COMMAND_TYPES.has(session.commandType)) throw new Error(`Unsupported preview command type: ${session.commandType}`);
  assertId(session.targetId, "preview.targetId");
  if (!Number.isInteger(session.frameCount) || session.frameCount < 0) throw new Error("preview.frameCount must be a non-negative integer");
  if (session.value !== null) assertPreviewValue(session.commandType, session.value);
  return session;
}

/** Start a gesture without changing the Artifact. */
export function beginPreview({ baseRevision, gestureId, commandType, targetId }) {
  if (typeof baseRevision !== "string" || baseRevision.length === 0) throw new Error("preview.baseRevision must be a non-empty string");
  assertId(gestureId, "preview.gestureId");
  if (!COMMAND_TYPES.has(commandType)) throw new Error(`Unsupported preview command type: ${commandType}`);
  assertId(targetId, "preview.targetId");
  return deepFreeze({
    phase: ACTIVE,
    baseRevision,
    gestureId,
    commandType,
    targetId,
    frameCount: 0,
    value: null,
  });
}

/** Return the next ephemeral frame; the supplied session is never mutated. */
export function updatePreview(session, value) {
  assertSession(session);
  if (session.phase !== ACTIVE) throw new Error("only an active preview can be updated");
  assertPreviewValue(session.commandType, value);
  return deepFreeze({ ...session, frameCount: session.frameCount + 1, value: clone(value) });
}

/** Cancel a gesture and explicitly discard its last frame. */
export function cancelPreview(session) {
  assertSession(session);
  if (session.phase !== ACTIVE) throw new Error("only an active preview can be cancelled");
  return deepFreeze({ ...session, phase: "cancelled", value: null });
}

/**
 * Convert the final frame into exactly one Domain Command. The preview value
 * is not copied into an undo history until this function is called.
 */
export function commitPreview(session) {
  assertSession(session);
  if (session.phase !== ACTIVE) throw new Error("only an active preview can be committed");
  if (session.value === null) throw new Error("cannot commit a preview without a frame");
  const command = {
    type: session.commandType,
    targetId: session.targetId,
    ...clone(session.value),
    baseRevision: session.baseRevision,
    gestureId: session.gestureId,
  };
  return {
    session: deepFreeze({ ...session, phase: "committed", value: null }),
    command: deepFreeze(command),
  };
}

function assertCommand(command) {
  if (!isRecord(command)) throw new TypeError("domain command must be an object");
  if (!COMMAND_TYPES.has(command.type)) throw new Error(`Unsupported domain command type: ${String(command.type)}`);
  assertId(command.targetId, "command.targetId");
  if (typeof command.baseRevision !== "string" || command.baseRevision.length === 0) throw new Error("command.baseRevision must be a non-empty string");
  assertId(command.gestureId, "command.gestureId");
  const fields = command.type === "layout.node.move"
    ? ["x", "y"]
    : command.type === "layout.node.elevation"
      ? ["elevation"]
    : command.type === "layout.node.rotate-y"
      ? ["rotationYDeg"]
      : command.type === "layout.node.scale"
        ? ["scale"]
        : command.type === "layout.node.z-index"
          ? ["zIndex"]
          : command.type === "layout.route.replace-points"
            ? ["points"]
            : ["azimuthDeg", "elevationDeg", "zoom"];
  const value = Object.fromEntries(fields.filter((field) => command[field] !== undefined).map((field) => [field, command[field]]));
  assertPreviewValue(command.type, value, "command");
}

function ensureOverrideLayer(artifact) {
  assertSemanticGraph(artifact.semantic);
  assertComposition(artifact.composition);
  assertLayout(artifact.layout);
}

function ensureTarget(artifact, type, targetId) {
  const collection = type.startsWith("layout.node") ? "nodes" : type.startsWith("layout.route") ? "routes" : null;
  if (collection && !Object.hasOwn(artifact.layout.generated[collection], targetId)) {
    throw new Error(`command target does not resolve: ${collection}.${targetId}`);
  }
  if (type.startsWith("layout.node") && !artifact.semantic.nodes.some((node) => node.id === targetId)) {
    throw new Error(`command target does not resolve: semantic.nodes.${targetId}`);
  }
  if (type.startsWith("layout.route") && !artifact.semantic.edges.some((edge) => edge.id === targetId)) {
    throw new Error(`command target does not resolve: semantic.edges.${targetId}`);
  }
}

/** Apply one command as one field-level Human Override update. */
export function applyDomainCommand(artifact, command) {
  assertCommand(command);
  if (!isRecord(artifact)) throw new TypeError("artifact must be an object");
  ensureOverrideLayer(artifact);
  ensureTarget(artifact, command.type, command.targetId);
  const next = clone(artifact);

  if (command.type === "layout.node.move") {
    next.layout.overrides.nodes[command.targetId] = {
      ...(next.layout.overrides.nodes[command.targetId] ?? {}),
      x: command.x,
      y: command.y,
    };
  } else if (command.type === "layout.node.elevation") {
    next.layout.overrides.nodes[command.targetId] = {
      ...(next.layout.overrides.nodes[command.targetId] ?? {}),
      elevation: command.elevation,
    };
  } else if (command.type === "layout.node.rotate-y") {
    next.layout.overrides.nodes[command.targetId] = {
      ...(next.layout.overrides.nodes[command.targetId] ?? {}),
      rotationYDeg: command.rotationYDeg,
    };
  } else if (command.type === "layout.node.scale") {
    next.layout.overrides.nodes[command.targetId] = {
      ...(next.layout.overrides.nodes[command.targetId] ?? {}),
      scale: command.scale,
    };
  } else if (command.type === "layout.node.z-index") {
    next.layout.overrides.nodes[command.targetId] = {
      ...(next.layout.overrides.nodes[command.targetId] ?? {}),
      zIndex: command.zIndex,
    };
  } else if (command.type === "layout.route.replace-points") {
    next.layout.overrides.routes[command.targetId] = { points: clone(command.points) };
  } else if (command.type === "layout.view.change") {
    next.layout.overrides.view = {
      ...next.layout.overrides.view,
      ...Object.fromEntries(["azimuthDeg", "elevationDeg", "zoom"].filter((field) => command[field] !== undefined).map((field) => [field, command[field]])),
    };
  }

  return next;
}

export function assertPreviewSession(session) {
  return assertSession(session);
}

export { COMMAND_TYPES };
