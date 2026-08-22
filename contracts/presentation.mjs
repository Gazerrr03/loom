/**
 * Persisted presentation boundary for annotations, theme tokens, and assets.
 * Runtime render objects are deliberately not representable here.
 */

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const ASSET_KINDS = new Set(["primitive", "parametric-scene", "gltf-model", "image", "font"]);
const RUNTIME_KEYS = new Set(["runtime", "scene", "mesh", "geometry", "material", "gpu", "cache"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertStableId(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error(`${path} must be a lowercase stable identifier`);
  }
}

function assertPoint(point, path) {
  if (!isRecord(point)) throw new Error(`${path} must be an object`);
  for (const field of ["x", "y"]) {
    if (typeof point[field] !== "number" || !Number.isFinite(point[field])) {
      throw new Error(`${path}.${field} must be a finite number`);
    }
  }
  if (point.elevation !== undefined && (typeof point.elevation !== "number" || !Number.isFinite(point.elevation))) {
    throw new Error(`${path}.elevation must be a finite number`);
  }
}

function assertPersistedValue(value, path, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new Error(`${path} must not contain NaN or Infinity`);
  }
  if (typeof value !== "object") {
    throw new Error(`${path} contains a renderer runtime value`);
  }
  if (seen.has(value)) throw new Error(`${path} contains a cyclic runtime value`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPersistedValue(item, `${path}[${index}]`, seen));
  } else if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error(`${path} contains a non-plain runtime object`);
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (RUNTIME_KEYS.has(key.toLowerCase())) {
        throw new Error(`${path}.${key} is renderer runtime state`);
      }
      assertPersistedValue(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function collectSemanticIds(semantic) {
  if (!isRecord(semantic)) throw new Error("semantic must be an object");
  const ids = new Map();
  for (const kind of ["nodes", "edges", "groups"]) {
    if (!Array.isArray(semantic[kind])) throw new Error(`semantic.${kind} must be an array`);
    for (const [index, item] of semantic[kind].entries()) {
      assertStableId(item.id, `semantic.${kind}[${index}].id`);
      if (ids.has(item.id)) throw new Error(`Duplicate semantic ID: ${item.id}`);
      ids.set(item.id, kind.slice(0, -1));
    }
  }
  return ids;
}

function assertAnnotation(annotation, index, semanticIds, annotationIds) {
  const path = `annotations[${index}]`;
  if (!isRecord(annotation)) throw new Error(`${path} must be an object`);
  assertStableId(annotation.id, `${path}.id`);
  if (annotationIds.has(annotation.id)) throw new Error(`Duplicate annotation ID: ${annotation.id}`);
  annotationIds.add(annotation.id);
  if (typeof annotation.text !== "string") throw new Error(`${path}.text must be a string`);
  if (typeof annotation.visualRole !== "string" || annotation.visualRole.length === 0) {
    throw new Error(`${path}.visualRole must be a non-empty string`);
  }
  const anchor = annotation.anchor;
  if (!isRecord(anchor)) throw new Error(`${path}.anchor must be an object`);
  if (anchor.kind === "canvas") {
    assertPoint(anchor.position, `${path}.anchor.position`);
  } else if (["node", "edge", "group"].includes(anchor.kind)) {
    assertStableId(anchor.targetId, `${path}.anchor.targetId`);
    if (semanticIds.get(anchor.targetId) !== anchor.kind) {
      throw new Error(`${path}.anchor.targetId does not resolve to a ${anchor.kind}: ${anchor.targetId}`);
    }
    if (anchor.offset !== undefined) assertPoint(anchor.offset, `${path}.anchor.offset`);
  } else {
    throw new Error(`${path}.anchor.kind is unsupported: ${String(anchor.kind)}`);
  }
  if (annotation.properties !== undefined) assertPersistedValue(annotation.properties, `${path}.properties`);
}

function assertAssets(assets) {
  if (!Array.isArray(assets)) throw new Error("assets must be an array");
  const ids = new Set();
  for (const [index, asset] of assets.entries()) {
    const path = `assets[${index}]`;
    if (!isRecord(asset)) throw new Error(`${path} must be an object`);
    assertStableId(asset.id, `${path}.id`);
    if (ids.has(asset.id)) throw new Error(`Duplicate asset ID: ${asset.id}`);
    ids.add(asset.id);
    if (!ASSET_KINDS.has(asset.kind)) throw new Error(`${path}.kind is unsupported: ${String(asset.kind)}`);
    if (typeof asset.uri !== "string" || asset.uri.length === 0) throw new Error(`${path}.uri must be a non-empty source reference`);
    if (typeof asset.license !== "string" || asset.license.length === 0) throw new Error(`${path}.license is required`);
    assertPersistedValue(asset, path);
  }
}

export function assertPresentationBoundary({ semantic, annotations, presentation, assets }) {
  const semanticIds = collectSemanticIds(semantic);
  if (!Array.isArray(annotations)) throw new Error("annotations must be an array");
  const annotationIds = new Set();
  annotations.forEach((annotation, index) => assertAnnotation(annotation, index, semanticIds, annotationIds));

  if (!isRecord(presentation)) throw new Error("presentation must be an object");
  if (typeof presentation.themeRef !== "string" || presentation.themeRef.length === 0) {
    throw new Error("presentation.themeRef must be a non-empty string");
  }
  if (!isRecord(presentation.roleOverrides)) throw new Error("presentation.roleOverrides must be an object");
  assertPersistedValue(presentation.roleOverrides, "presentation.roleOverrides");
  assertAssets(assets);
  return { semantic, annotations, presentation, assets };
}
