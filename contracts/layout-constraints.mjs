import { mergeEffectiveLayout } from "./layout.mjs";

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const ROLES = new Set(["main-flow", "alternative", "external-input", "compounding-loop"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rectContains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

function assertConstraintProfile(profile) {
  if (!isRecord(profile)) throw new TypeError("layout constraint profile must be an object");
  for (const field of ["gutterSafeAreaId", "readingDirection"]) {
    if (typeof profile[field] !== "string" || profile[field].length === 0) throw new Error(`constraints.${field} is required`);
  }
  for (const field of ["protectedNodeRoles", "primaryEdgeRoles", "secondaryEdgeRoles", "requiredPhaseZoneIds"]) {
    if (!Array.isArray(profile[field]) || profile[field].length === 0) throw new Error(`constraints.${field} must be a non-empty array`);
    if (profile[field].some((value) => typeof value !== "string" || !ID_PATTERN.test(value))) throw new Error(`constraints.${field} contains an invalid identifier`);
  }
  if (profile.readingDirection !== "lower-left-to-upper-right") throw new Error("Unsupported constraints.readingDirection");
  for (const role of [...profile.primaryEdgeRoles, ...profile.secondaryEdgeRoles]) {
    if (!ROLES.has(role)) throw new Error(`Unsupported edge role: ${role}`);
  }
  return profile;
}

function overlapPoint(rect, area) {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  return center.x >= area.x && center.x <= area.x + area.width && center.y >= area.y && center.y <= area.y + area.height;
}

export function evaluateLayoutConstraints(artifact, profile) {
  assertConstraintProfile(profile);
  const violations = [];
  const warnings = [];
  const safeArea = artifact.composition.safeAreas.find((area) => area.id === profile.gutterSafeAreaId);
  if (!safeArea) throw new Error(`Missing gutter safe area: ${profile.gutterSafeAreaId}`);
  const effective = mergeEffectiveLayout(artifact.layout, artifact.composition.defaultView);
  const semanticNodes = new Map(artifact.semantic.nodes.map((node) => [node.id, node]));
  for (const [nodeId, nodeLayout] of Object.entries(effective.nodes)) {
    const node = semanticNodes.get(nodeId);
    if (node && profile.protectedNodeRoles.includes(node.visualRole) && overlapPoint(nodeLayout, safeArea.bounds)) {
      violations.push({ kind: "critical-gutter", objectIds: [nodeId], fieldPath: `layout.nodes.${nodeId}` });
    }
  }

  const semanticGroups = new Map(artifact.semantic.groups.map((group) => [group.id, group]));
  for (const groupId of profile.requiredPhaseZoneIds) {
    const group = semanticGroups.get(groupId);
    const bounds = effective.groups[groupId]?.bounds;
    if (!group || group.visualRole !== "phase-zone") violations.push({ kind: "missing-phase-zone", objectIds: [groupId], fieldPath: "semantic.groups" });
    else if (!bounds || !rectContains({ x: 0, y: 0, ...artifact.composition.canvas }, bounds)) violations.push({ kind: "phase-zone-outside-canvas", objectIds: [groupId], fieldPath: `layout.groups.${groupId}.bounds` });
  }

  for (const edge of artifact.semantic.edges) {
    const route = effective.routes[edge.id];
    if (!route || !Array.isArray(route.points) || route.points.length < 2) {
      if (profile.primaryEdgeRoles.includes(edge.visualRole) || profile.secondaryEdgeRoles.includes(edge.visualRole)) violations.push({ kind: "missing-route", objectIds: [edge.id], fieldPath: `layout.routes.${edge.id}` });
      continue;
    }
    if (profile.primaryEdgeRoles.includes(edge.visualRole)) {
      const first = route.points[0];
      const last = route.points[route.points.length - 1];
      if (last.x < first.x || last.y > first.y) warnings.push({ kind: "primary-direction", objectIds: [edge.id], fieldPath: `layout.routes.${edge.id}` });
    }
  }
  if (!artifact.semantic.edges.some((edge) => profile.primaryEdgeRoles.includes(edge.visualRole))) {
    violations.push({ kind: "missing-primary-path", objectIds: [], fieldPath: "semantic.edges" });
  }
  if (!artifact.semantic.edges.some((edge) => profile.secondaryEdgeRoles.includes(edge.visualRole))) {
    warnings.push({ kind: "missing-secondary-path", objectIds: [], fieldPath: "semantic.edges" });
  }
  return { valid: violations.length === 0, violations, warnings, effectiveLayout: effective };
}

export { assertConstraintProfile };
