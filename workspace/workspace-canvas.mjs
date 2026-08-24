import {
  applyDomainCommand,
  beginPreview,
  cancelPreview,
  commitPreview,
  updatePreview,
} from "../contracts/interaction-commit.mjs";
import { mergeEffectiveLayout } from "../contracts/layout.mjs";

const NODE_ID = /^[a-z][a-z0-9._-]*$/;
const ISO_BASIS = Object.freeze({ xFromX: 1.42, xFromY: 0.56, yFromX: -0.2, yFromY: 0.66 });

function clone(value) {
  return structuredClone(value);
}

function assertRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function assertFinite(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
}

function assertPoint(point, path = "point") {
  assertRecord(point, path);
  assertFinite(point.x, `${path}.x`);
  assertFinite(point.y, `${path}.y`);
  return { x: point.x, y: point.y };
}

function assertNodeId(nodeId, path = "nodeId") {
  if (typeof nodeId !== "string" || !NODE_ID.test(nodeId)) throw new Error(`${path} must be a stable identifier`);
  return nodeId;
}

function nodeById(artifact, nodeId) {
  return artifact.semantic.nodes.find((node) => node.id === nodeId) ?? null;
}

function effectiveNodes(artifact) {
  return mergeEffectiveLayout(artifact.layout, artifact.composition.defaultView).nodes;
}

function nodeBounds(artifact, nodeId) {
  const layout = effectiveNodes(artifact)[nodeId];
  if (!layout) return null;
  const scale = layout.scale ?? 1;
  return {
    x: layout.x,
    y: layout.y,
    width: layout.width * scale,
    height: layout.height * scale,
    zIndex: layout.zIndex ?? 0,
  };
}

function contains(bounds, point) {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

/**
 * Resolve a Diagram-space hit to a stable semantic node id.
 * When nodes overlap, the highest z-index wins and ties resolve by source order.
 */
export function hitTestNode(artifact, point) {
  assertRecord(artifact, "artifact");
  const diagramPoint = assertPoint(point, "diagramPoint");
  const candidates = artifact.semantic.nodes
    .map((node, index) => ({ node, index, bounds: nodeBounds(artifact, node.id) }))
    .filter(({ bounds }) => bounds && contains(bounds, diagramPoint))
    .sort((left, right) => (right.bounds.zIndex - left.bounds.zIndex) || (right.index - left.index));
  return candidates[0]?.node.id ?? null;
}

/**
 * Convert between the SVG's isometric Diagram space and its screen/viewBox space.
 * Pan and zoom are inputs to the transform; the returned command values remain
 * Diagram coordinates and therefore never write screen pixels to diagram.json.
 */
export function createIsometricTransform({
  origin = { x: 82, y: 568 },
  pan = { x: 0, y: 0 },
  zoom = 1,
  basis = ISO_BASIS,
} = {}) {
  const safeOrigin = assertPoint(origin, "origin");
  const safePan = assertPoint(pan, "pan");
  assertFinite(zoom, "zoom");
  if (zoom <= 0) throw new Error("zoom must be greater than zero");
  for (const [key, value] of Object.entries(basis)) assertFinite(value, `basis.${key}`);
  const determinant = basis.xFromX * basis.yFromY - basis.xFromY * basis.yFromX;
  if (determinant === 0) throw new Error("basis must be invertible");

  return Object.freeze({
    diagramToScreen(point, { z = 0 } = {}) {
      const diagramPoint = assertPoint(point, "diagramPoint");
      assertFinite(z, "z");
      return {
        x: safeOrigin.x + safePan.x + zoom * (basis.xFromX * diagramPoint.x + basis.xFromY * diagramPoint.y),
        y: safeOrigin.y + safePan.y + zoom * (basis.yFromX * diagramPoint.x + basis.yFromY * diagramPoint.y - z * 1.7),
      };
    },
    screenToDiagram(point, { z = 0 } = {}) {
      const screenPoint = assertPoint(point, "screenPoint");
      assertFinite(z, "z");
      const dx = (screenPoint.x - safeOrigin.x - safePan.x) / zoom;
      const dy = (screenPoint.y - safeOrigin.y - safePan.y) / zoom + z * 1.7;
      return {
        x: (dx * basis.yFromY - dy * basis.xFromY) / determinant,
        y: (basis.xFromX * dy - basis.yFromX * dx) / determinant,
      };
    },
  });
}

function previewCommand(preview) {
  return {
    type: preview.commandType,
    targetId: preview.targetId,
    ...clone(preview.value),
    baseRevision: preview.baseRevision,
    gestureId: preview.gestureId,
  };
}

/**
 * Stateful, renderer-independent controller for one direct Canvas surface.
 * The canonical artifact is replaced only by pointerUp; preview frames are
 * derived copies and never enter history or mutate the caller's artifact.
 */
export function createWorkspaceCanvas({ artifact, revision, gesturePrefix = "workspace-drag" } = {}) {
  assertRecord(artifact, "artifact");
  const initialRevision = revision ?? artifact.revision ?? `draft:${artifact.id}`;
  if (typeof initialRevision !== "string" || initialRevision.length === 0) throw new Error("revision must be a non-empty string");
  let canonical = clone(artifact);
  let selectedId = null;
  let active = null;
  let previewArtifact = null;
  let sequence = 0;
  let commits = [];

  function state() {
    return {
      selectedId,
      active: active ? clone(active) : null,
      previewing: previewArtifact !== null,
      canonicalRevision: initialRevision,
      commitCount: commits.length,
      history: clone(commits),
    };
  }

  function selectNode(nodeId) {
    assertNodeId(nodeId);
    if (!nodeById(canonical, nodeId)) return null;
    selectedId = nodeId;
    return selectedId;
  }

  function begin({ nodeId, diagramPoint, pointerId = null } = {}) {
    assertNodeId(nodeId);
    const point = assertPoint(diagramPoint, "diagramPoint");
    const node = nodeById(canonical, nodeId);
    const bounds = node && nodeBounds(canonical, nodeId);
    if (!node || !bounds) return { accepted: false, reason: "node-not-found" };
    if (active) throw new Error("a Canvas gesture is already active");
    selectedId = nodeId;
    const gestureId = `${gesturePrefix}-${++sequence}`;
    active = {
      pointerId,
      nodeId,
      gestureId,
      startPoint: point,
      origin: { x: bounds.x, y: bounds.y },
      preview: beginPreview({
        baseRevision: initialRevision,
        gestureId,
        commandType: "layout.node.move",
        targetId: nodeId,
      }),
    };
    previewArtifact = null;
    return { accepted: true, ...state() };
  }

  function move({ diagramPoint } = {}) {
    if (!active) return { accepted: false, reason: "no-active-gesture", ...state() };
    const point = assertPoint(diagramPoint, "diagramPoint");
    const value = {
      x: active.origin.x + point.x - active.startPoint.x,
      y: active.origin.y + point.y - active.startPoint.y,
    };
    active.preview = updatePreview(active.preview, value);
    previewArtifact = applyDomainCommand(canonical, previewCommand(active.preview));
    return { accepted: true, value, ...state() };
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
    getState: () => state(),
    selectNode,
    hitTest: (point) => hitTestNode(canonical, point),
    pointerDown: begin,
    pointerMove: move,
    pointerUp: end,
    cancel,
  });
}

export { ISO_BASIS };
