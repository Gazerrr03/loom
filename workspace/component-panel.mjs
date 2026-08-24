import {
  assertComponentTemplateCatalog,
  queryComponentTemplates,
} from "../contracts/component-template-catalog.mjs";

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const GLB_PATTERN = /\.(?:glb|gltf)(?:[?#].*)?$/i;

function clone(value) {
  return structuredClone(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertId(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`${path} must be a stable identifier`);
}

function assertQuery(value) {
  if (value !== undefined && typeof value !== "string") throw new TypeError("component query must be a string");
}

function nodeFor(artifact, nodeId) {
  const node = artifact?.semantic?.nodes?.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`component target does not resolve: ${String(nodeId)}`);
  return node;
}

function slug(value) {
  return String(value)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "model";
}

function nextAssetId(artifact, fileName) {
  const used = new Set((artifact.assets ?? []).map((asset) => asset.id));
  const base = `asset-user-${slug(fileName.replace(/\.(?:glb|gltf)$/i, ""))}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function assertGlbFileName(fileName) {
  if (typeof fileName !== "string" || fileName.trim().length === 0) throw new Error("GLB file name is required");
  if (!GLB_PATTERN.test(fileName)) throw new Error("Only .glb or .gltf files can be imported");
  return fileName.trim();
}

/** Search the shared catalog without creating a second template identity source. */
export function searchComponentCatalog(catalog, { nodeType, query = "" } = {}) {
  assertComponentTemplateCatalog(catalog);
  assertQuery(query);
  if (!nodeType && query.trim().length === 0) {
    return catalog.templates.map((template) => ({
      kind: "template",
      id: template.id,
      name: template.name,
      description: template.semanticDescription,
      reasons: [{ kind: "catalog", value: template.id, label: "Catalog 组件" }],
      score: 0,
      acceptedNodeTypes: [...template.acceptedNodeTypes],
    }));
  }
  return queryComponentTemplates(catalog, {
    nodeType,
    semanticQuery: query,
  }).map((match) => ({
    kind: "template",
    id: match.templateId,
    name: match.template.name,
    description: match.template.semanticDescription,
    reasons: clone(match.reasons),
    score: match.score,
    acceptedNodeTypes: [...match.template.acceptedNodeTypes],
  }));
}

/** Return the panel's visible templates and user asset references. */
export function listComponentEntries({ catalog, artifact, nodeType, query = "" } = {}) {
  if (!isRecord(artifact)) throw new TypeError("component panel artifact must be an object");
  const templates = searchComponentCatalog(catalog, { nodeType, query });
  const normalized = query.trim().toLocaleLowerCase();
  const assets = (artifact.assets ?? [])
    .filter((asset) => asset.kind === "gltf-model")
    .filter((asset) => !normalized || `${asset.id} ${asset.uri} ${asset.license}`.toLocaleLowerCase().includes(normalized))
    .map((asset) => ({
      kind: "asset",
      id: asset.id,
      name: asset.id,
      description: asset.uri,
      license: asset.license,
      export: asset.license.toLocaleLowerCase().includes("unconfirmed") ? "blocked" : "unknown",
    }));
  return [...templates, ...assets];
}

/**
 * Build one semantic component replacement and its immutable Artifact result.
 * The returned command is the same field-scoped shape that Codex can submit;
 * the browser applies it to a copy and never mutates the source Artifact.
 */
export function replaceNodeComponent(artifact, { nodeId, componentRef, assetId } = {}) {
  if (!isRecord(artifact)) throw new TypeError("component replacement artifact must be an object");
  assertId(nodeId, "replacement.nodeId");
  const node = nodeFor(artifact, nodeId);
  if ((componentRef === undefined) === (assetId === undefined)) {
    throw new Error("replacement requires exactly one componentRef or assetId");
  }
  const nextRef = componentRef ?? node.componentRef;
  assertId(nextRef, "replacement.componentRef");
  if (assetId !== undefined && !(artifact.assets ?? []).some((asset) => asset.id === assetId)) {
    throw new Error(`replacement asset does not resolve: ${assetId}`);
  }
  const next = clone(artifact);
  const target = next.semantic.nodes.find((candidate) => candidate.id === nodeId);
  const nextProperties = assetId === undefined
    ? { ...(target.properties ?? {}) }
    : { ...(target.properties ?? {}), assetRef: assetId };
  target.componentRef = nextRef;
  target.properties = nextProperties;
  return {
    command: {
      type: "semantic.node.update",
      targetId: nodeId,
      patch: assetId === undefined
        ? { componentRef: nextRef }
        : { properties: nextProperties },
    },
    assetId: assetId ?? null,
    artifact: next,
    preserved: {
      nodeId: node.id,
      edgeIds: next.semantic.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).map((edge) => edge.id),
      groupIds: next.semantic.groups.filter((group) => group.children.includes(nodeId)).map((group) => group.id),
      annotationIds: next.annotations.filter((annotation) => annotation.anchor?.targetId === nodeId).map((annotation) => annotation.id),
    },
  };
}

/**
 * Import only a stable user GLB reference. Browser security does not expose a
 * portable absolute path, so the file name is retained and authorization is
 * explicitly unconfirmed until the user supplies a license decision.
 */
export function importUserGlbReference(artifact, { fileName, uri = fileName } = {}) {
  if (!isRecord(artifact)) throw new TypeError("asset artifact must be an object");
  const safeName = assertGlbFileName(fileName);
  if (typeof uri !== "string" || uri.length === 0 || uri.startsWith("data:")) throw new Error("GLB uri must be a non-embedded source reference");
  if (!GLB_PATTERN.test(uri)) throw new Error("GLB uri must reference a .glb or .gltf file");
  const asset = {
    id: nextAssetId(artifact, safeName),
    kind: "gltf-model",
    uri,
    mediaType: uri.toLocaleLowerCase().endsWith(".gltf") ? "model/gltf+json" : "model/gltf-binary",
    license: "user-provided · authorization-unconfirmed",
  };
  const next = clone(artifact);
  next.assets = [...(next.assets ?? []), asset];
  return {
    artifact: next,
    asset: clone(asset),
    export: { status: "blocked", reason: "用户资产授权尚未确认，MVP 阶段阻止 PNG 导出。" },
  };
}

/** Return the explicit export gate for user GLB references. */
export function evaluateComponentExportGate(artifact) {
  const blockedAssets = (artifact.assets ?? [])
    .filter((asset) => asset.kind === "gltf-model")
    .filter((asset) => asset.license.toLocaleLowerCase().includes("unconfirmed"))
    .map((asset) => ({ assetId: asset.id, reason: "authorization-unconfirmed" }));
  return blockedAssets.length === 0
    ? { status: "ready", blockedAssets: [] }
    : { status: "blocked", blockedAssets };
}
