/**
 * Generated Layout + Human Override merge contract.
 *
 * An override is a field-level decision, not a snapshot of a whole object.
 * This keeps a manual x adjustment from freezing generated y/scale changes.
 */

import { assertOrthogonalRoute } from "./route-geometry.mjs";

const LAYER_KINDS = ["nodes", "routes", "groups"];
const OVERRIDE_KINDS = new Map([
  ["node", "nodes"],
  ["route", "routes"],
  ["group", "groups"],
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertRecord(value, path) {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
}

function assertLayer(layer, path) {
  assertRecord(layer, path);
  for (const kind of LAYER_KINDS) {
    assertRecord(layer[kind], `${path}.${kind}`);
  }
}

function assertRouteLayer(layer, path, { requirePoints = false } = {}) {
  for (const [id, route] of Object.entries(layer)) {
    assertRecord(route, `${path}.${id}`);
    if (requirePoints || route.points !== undefined) {
      assertOrthogonalRoute(route.points, `${path}.${id}.points`);
    }
  }
}

function assertOverrideTargets(layout) {
  for (const kind of LAYER_KINDS) {
    for (const id of Object.keys(layout.overrides[kind])) {
      if (!(id in layout.generated[kind])) {
        throw new Error(`Override has no Generated Layout target: ${kind}.${id}`);
      }
    }
  }
}

export function assertLayout(layout) {
  assertRecord(layout, "layout");
  assertRecord(layout.engine, "layout.engine");
  if (typeof layout.engine.id !== "string" || typeof layout.engine.version !== "string") {
    throw new Error("layout.engine requires string id and version");
  }
  assertLayer(layout.generated, "layout.generated");
  assertLayer(layout.overrides, "layout.overrides");
  assertRouteLayer(layout.generated.routes, "layout.generated.routes", { requirePoints: true });
  assertRouteLayer(layout.overrides.routes, "layout.overrides.routes");
  assertRecord(layout.overrides.view, "layout.overrides.view");
  assertOverrideTargets(layout);
  return layout;
}

function mergeFields(generated, override) {
  const merged = { ...generated, ...override };
  if (isRecord(generated.parameters) && isRecord(override.parameters)) {
    merged.parameters = { ...generated.parameters, ...override.parameters };
  }
  return merged;
}

function mergeLayer(generated, overrides) {
  const result = {};
  for (const [id, value] of Object.entries(generated)) {
    result[id] = mergeFields(value, overrides[id] ?? {});
  }
  return result;
}

/**
 * Return the renderer-facing layout. `baseView` is normally composition.defaultView;
 * only explicitly overridden view fields replace it.
 */
export function mergeEffectiveLayout(layout, baseView = {}) {
  assertLayout(layout);
  assertRecord(baseView, "baseView");
  return {
    nodes: mergeLayer(layout.generated.nodes, layout.overrides.nodes),
    routes: mergeLayer(layout.generated.routes, layout.overrides.routes),
    groups: mergeLayer(layout.generated.groups, layout.overrides.groups),
    view: { ...baseView, ...layout.overrides.view },
  };
}

/**
 * Clear one field, one object, or the complete Human Override layer.
 * The input is never mutated, so a Workspace command can safely support undo.
 */
export function clearOverride(layout, target = {}) {
  assertLayout(layout);
  const next = clone(layout);
  const { kind, id, field } = target;

  if (kind === undefined && id === undefined && field === undefined) {
    next.overrides = { nodes: {}, routes: {}, groups: {}, view: {} };
    return next;
  }

  if (kind === "view") {
    if (id !== undefined) throw new Error("view override does not accept an id");
    if (field === undefined) next.overrides.view = {};
    else delete next.overrides.view[field];
    return next;
  }

  const collection = OVERRIDE_KINDS.get(kind);
  if (!collection || typeof id !== "string") {
    throw new Error("clearOverride requires kind and id for node, route, or group");
  }
  if (!(id in next.overrides[collection])) return next;
  if (field === undefined) delete next.overrides[collection][id];
  else {
    delete next.overrides[collection][id][field];
    if (Object.keys(next.overrides[collection][id]).length === 0) {
      delete next.overrides[collection][id];
    }
  }
  return next;
}
