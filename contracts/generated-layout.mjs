import { assertComposition } from "./composition.mjs";
import { evaluateLayoutConstraints } from "./layout-constraints.mjs";
import { assertOrthogonalRoute } from "./route-geometry.mjs";
import { assertSemanticGraph } from "./semantic-graph.mjs";

const ENGINE_ID = "loom-deterministic-layout";
const ENGINE_VERSION = "0.1.0";
const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const DEFAULT_MARGIN = 16;
const DEFAULT_GAP = 10;
const ROLE_ORDER = new Map([
  ["main-stage", 0],
  ["alternative", 1],
  ["external-input", 2],
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function compareIds(left, right, seed) {
  const leftHash = stableHash(`${seed}:${left}`);
  const rightHash = stableHash(`${seed}:${right}`);
  return leftHash - rightHash || left.localeCompare(right);
}

function assertSeed(seed) {
  if (typeof seed !== "string" && typeof seed !== "number") {
    throw new TypeError("layout seed must be a string or number");
  }
  if (String(seed).length === 0) throw new Error("layout seed must not be empty");
}

function assertFiniteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be finite`);
}

function assertRect(rect, path) {
  if (!isRecord(rect)) throw new Error(`${path} must be an object`);
  for (const field of ["x", "y", "width", "height"]) assertFiniteNumber(rect[field], `${path}.${field}`);
  if (rect.width <= 0 || rect.height <= 0) throw new Error(`${path} must have positive size`);
}

function nodeSize(node) {
  if (node.visualRole === "main-stage") return { width: 48, height: 28 };
  if (node.visualRole === "alternative") return { width: 38, height: 22 };
  if (node.visualRole === "external-input") return { width: 30, height: 18 };
  return { width: 42, height: 24 };
}

function roleRank(node) {
  return ROLE_ORDER.get(node.visualRole) ?? 3;
}

function primaryOrder(semantic, seed) {
  const mainIds = new Set(semantic.nodes.filter((node) => node.visualRole === "main-stage").map((node) => node.id));
  const indegree = new Map([...mainIds].map((id) => [id, 0]));
  const adjacency = new Map([...mainIds].map((id) => [id, []]));
  for (const edge of semantic.edges) {
    if (edge.visualRole !== "main-flow" || !mainIds.has(edge.source) || !mainIds.has(edge.target)) continue;
    adjacency.get(edge.source).push(edge.target);
    indegree.set(edge.target, indegree.get(edge.target) + 1);
  }
  const nodeById = new Map(semantic.nodes.map((node) => [node.id, node]));
  const compareNodes = (leftId, rightId) => {
    const left = nodeById.get(leftId);
    const right = nodeById.get(rightId);
    const sequenceDelta = (left?.properties?.sequence ?? Number.MAX_SAFE_INTEGER) - (right?.properties?.sequence ?? Number.MAX_SAFE_INTEGER);
    return sequenceDelta || compareIds(leftId, rightId, seed);
  };
  const ready = [...indegree].filter(([, value]) => value === 0).map(([id]) => id).sort(compareNodes);
  const order = [];
  while (ready.length > 0) {
    const current = ready.shift();
    order.push(current);
    for (const target of adjacency.get(current).sort(compareNodes)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) {
        ready.push(target);
        ready.sort(compareNodes);
      }
    }
  }
  const remaining = [...mainIds].filter((id) => !order.includes(id)).sort(compareNodes);
  return [...order, ...remaining];
}

function partitionSpan(span, count, gap) {
  const width = (span.width - gap * Math.max(0, count - 1)) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: span.x + index * (width + gap),
    y: span.y,
    width,
    height: span.height,
  }));
}

function deriveGroupBounds(artifact, constraints) {
  const canvas = artifact.composition.canvas;
  const margin = Math.min(DEFAULT_MARGIN, canvas.width / 8, canvas.height / 4);
  const groupIds = constraints?.requiredPhaseZoneIds?.filter((id) => artifact.semantic.groups.some((group) => group.id === id)) ?? [];
  const remainder = artifact.semantic.groups.map((group) => group.id).filter((id) => !groupIds.includes(id)).sort();
  const orderedIds = [...groupIds, ...remainder];
  if (orderedIds.length === 0) return new Map();

  const gutter = constraints?.gutterSafeAreaId
    ? artifact.composition.safeAreas.find((area) => area.id === constraints.gutterSafeAreaId)
    : null;
  let spans;
  if (gutter?.kind === "gutter" && orderedIds.length > 1) {
    const leftEnd = gutter.bounds.x - margin;
    const rightStart = gutter.bounds.x + gutter.bounds.width + margin;
    const leftCount = Math.ceil(orderedIds.length / 2);
    const rightCount = orderedIds.length - leftCount;
    spans = [
      ...partitionSpan({ x: margin, y: margin, width: leftEnd - margin, height: canvas.height - margin * 2 }, leftCount, DEFAULT_GAP),
      ...partitionSpan({ x: rightStart, y: margin, width: canvas.width - margin - rightStart, height: canvas.height - margin * 2 }, rightCount, DEFAULT_GAP),
    ];
  } else {
    spans = partitionSpan({ x: margin, y: margin, width: canvas.width - margin * 2, height: canvas.height - margin * 2 }, orderedIds.length, DEFAULT_GAP);
  }
  return new Map(orderedIds.map((id, index) => [id, spans[index]]));
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function fitNode(centerX, centerY, size, bounds) {
  const padding = 6;
  const maxWidth = Math.max(8, bounds.width - padding * 2);
  const maxHeight = Math.max(8, bounds.height - padding * 2);
  const width = Math.min(size.width, maxWidth);
  const height = Math.min(size.height, maxHeight);
  return {
    x: clamp(centerX - width / 2, bounds.x + padding, bounds.x + bounds.width - padding - width),
    y: clamp(centerY - height / 2, bounds.y + padding, bounds.y + bounds.height - padding - height),
    width,
    height,
  };
}

function centerOf(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function placeNodes(artifact, groupBounds, order, seed) {
  const nodeById = new Map(artifact.semantic.nodes.map((node) => [node.id, node]));
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const nodeGroup = new Map();
  for (const group of artifact.semantic.groups) {
    for (const childId of group.children) nodeGroup.set(childId, group.id);
  }
  const layouts = {};
  const phaseCount = Math.max(1, groupBounds.size);
  const canvas = artifact.composition.canvas;
  const margin = Math.min(DEFAULT_MARGIN, canvas.width / 8, canvas.height / 4);

  for (const group of artifact.semantic.groups) {
    const bounds = groupBounds.get(group.id);
    if (!bounds) continue;
    const children = group.children
      .map((id) => nodeById.get(id))
      .filter(Boolean)
      .sort((left, right) => roleRank(left) - roleRank(right) || (orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER) || compareIds(left.id, right.id, seed));
    const main = children.filter((node) => node.visualRole === "main-stage");
    const phaseIndex = [...groupBounds.keys()].indexOf(group.id);
    const baseY = canvas.height - margin - 14 - (phaseIndex / Math.max(1, phaseCount - 1)) * (canvas.height - margin * 2 - 28);
    const availableWidth = bounds.width - 12;
    const mainGap = 8;
    const mainWidth = main.length > 0 ? Math.min(48, (availableWidth - mainGap * Math.max(0, main.length - 1)) / main.length) : 0;
    main.forEach((node, index) => {
      const centerX = bounds.x + 6 + mainWidth / 2 + index * (mainWidth + mainGap);
      layouts[node.id] = {
        ...fitNode(centerX, baseY, { ...nodeSize(node), width: mainWidth }, bounds),
        elevation: 6 + (orderIndex.get(node.id) ?? 0) * 2,
        rotationYDeg: 0,
        scale: 1,
        zIndex: 20 + (orderIndex.get(node.id) ?? 0),
        parameters: clone(node.properties ?? {}),
      };
    });

    const auxiliary = children.filter((node) => node.visualRole !== "main-stage");
    const columns = Math.max(1, Math.min(3, auxiliary.length));
    const cellWidth = bounds.width / columns;
    auxiliary.forEach((node, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const centerX = bounds.x + cellWidth * (column + 0.5);
      const centerY = row % 2 === 0 ? bounds.y + 18 : bounds.y + bounds.height - 18;
      const size = nodeSize(node);
      layouts[node.id] = {
        ...fitNode(centerX, centerY, size, bounds),
        elevation: node.visualRole === "alternative" ? 2 : 1,
        rotationYDeg: 0,
        scale: node.visualRole === "alternative" ? 0.8 : 0.9,
        zIndex: node.visualRole === "alternative" ? 5 : 2,
        parameters: clone(node.properties ?? {}),
      };
    });
  }

  const ungrouped = artifact.semantic.nodes.filter((node) => !nodeGroup.has(node.id) || !layouts[node.id]);
  ungrouped.sort((left, right) => roleRank(left) - roleRank(right) || compareIds(left.id, right.id, seed));
  ungrouped.forEach((node, index) => {
    const size = nodeSize(node);
    const centerX = margin + size.width / 2 + (index % 4) * (size.width + DEFAULT_GAP);
    const centerY = canvas.height - margin - size.height / 2 - Math.floor(index / 4) * (size.height + DEFAULT_GAP);
    layouts[node.id] = {
      ...fitNode(centerX, centerY, size, { x: 0, y: 0, width: canvas.width, height: canvas.height }),
      elevation: 1,
      rotationYDeg: 0,
      scale: 1,
      zIndex: 1,
      parameters: clone(node.properties ?? {}),
    };
  });
  return layouts;
}

function routeForEdge(edge, nodes) {
  const source = nodes[edge.source];
  const target = nodes[edge.target];
  const sourceCenter = centerOf(source);
  const targetCenter = centerOf(target);
  const sourcePoint = { x: sourceCenter.x, y: sourceCenter.y, elevation: source.elevation ?? 0 };
  const targetPoint = { x: targetCenter.x, y: targetCenter.y, elevation: target.elevation ?? 0 };
  const points = [sourcePoint];
  if (edge.visualRole === "compounding-loop") {
    const lift = Math.max(18, Math.abs(sourceCenter.y - targetCenter.y) / 2);
    const loopY = Math.min(sourceCenter.y, targetCenter.y) - lift;
    const loopElevation = Math.max(source.elevation ?? 0, target.elevation ?? 0) + 2;
    // The loop is a deterministic X/Z dogleg: move toward the lift along the
    // source world-Z line, bridge along world X, then return to the target.
    points.push({ x: sourceCenter.x, y: loopY, elevation: source.elevation ?? 0 });
    points.push({ x: targetCenter.x + 12, y: loopY, elevation: loopElevation });
    points.push({ x: targetCenter.x + 12, y: targetCenter.y, elevation: loopElevation });
  } else if (sourceCenter.x !== targetCenter.x && sourceCenter.y !== targetCenter.y) {
    // X-first is deterministic and keeps the two Diagram plane directions
    // aligned with world X/Z after the shared coordinate adapter.
    points.push({ x: targetCenter.x, y: sourceCenter.y, elevation: source.elevation ?? 0 });
  }
  points.push(targetPoint);
  assertOrthogonalRoute(points, `generated route ${edge.id}.points`);
  return { points };
}

function emptyOverrides() {
  return { nodes: {}, routes: {}, groups: {}, view: {} };
}

export function assertGeneratedLayout(artifact, layout) {
  if (!isRecord(layout)) throw new TypeError("generated layout must be an object");
  if (!isRecord(layout.engine) || typeof layout.engine.id !== "string" || typeof layout.engine.version !== "string") {
    throw new Error("generated layout.engine requires id and version");
  }
  assertSeed(layout.engine.seed);
  if (!isRecord(layout.generated)) throw new Error("generated layout.generated must be an object");
  for (const collection of ["nodes", "routes", "groups"]) {
    if (!isRecord(layout.generated[collection])) throw new Error(`generated.${collection} must be an object`);
  }
  const expected = {
    nodes: new Set(artifact.semantic.nodes.map((node) => node.id)),
    routes: new Set(artifact.semantic.edges.map((edge) => edge.id)),
    groups: new Set(artifact.semantic.groups.map((group) => group.id)),
  };
  for (const collection of ["nodes", "routes", "groups"]) {
    for (const id of expected[collection]) {
      if (!Object.hasOwn(layout.generated[collection], id)) throw new Error(`Missing generated ${collection} entry: ${id}`);
    }
    for (const id of Object.keys(layout.generated[collection])) {
      if (!ID_PATTERN.test(id) || !expected[collection].has(id)) throw new Error(`Unexpected generated ${collection} entry: ${id}`);
    }
  }
  for (const [id, node] of Object.entries(layout.generated.nodes)) assertRect(node, `generated.nodes.${id}`);
  for (const [id, route] of Object.entries(layout.generated.routes)) {
    if (!isRecord(route)) throw new Error(`generated.routes.${id} must be an object`);
    assertOrthogonalRoute(route.points, `generated.routes.${id}.points`);
  }
  for (const [id, group] of Object.entries(layout.generated.groups)) assertRect(group.bounds, `generated.groups.${id}.bounds`);
  return layout;
}

/**
 * Produce a deterministic Generated Layout without touching Human Override.
 * The optional constraint profile is evaluated against the generated result;
 * the report is ephemeral and is intentionally not persisted in diagram.json.
 */
export function generateLayout(artifact, { seed = "layout-v1", constraints = null } = {}) {
  if (!isRecord(artifact)) throw new TypeError("artifact must be an object");
  assertSeed(seed);
  assertSemanticGraph(artifact.semantic);
  assertComposition(artifact.composition);
  const normalizedSeed = String(seed);
  const groupBounds = deriveGroupBounds(artifact, constraints);
  const order = primaryOrder(artifact.semantic, normalizedSeed);
  const nodes = placeNodes(artifact, groupBounds, order, normalizedSeed);
  const groups = Object.fromEntries([...groupBounds].map(([id, bounds]) => [id, { bounds }]));
  const routes = Object.fromEntries(artifact.semantic.edges.map((edge) => [edge.id, routeForEdge(edge, nodes)]));
  const layout = {
    engine: { id: ENGINE_ID, version: ENGINE_VERSION, seed: normalizedSeed },
    generated: { nodes, routes, groups },
  };
  assertGeneratedLayout(artifact, layout);

  if (!constraints) return { layout, constraintReport: null };
  const checkedArtifact = {
    ...artifact,
    layout: {
      engine: layout.engine,
      generated: layout.generated,
      overrides: artifact.layout?.overrides ?? emptyOverrides(),
    },
  };
  const constraintReport = evaluateLayoutConstraints(checkedArtifact, constraints);
  return { layout, constraintReport };
}

export { ENGINE_ID, ENGINE_VERSION };
