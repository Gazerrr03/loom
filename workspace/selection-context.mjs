import { assertDiagramArtifact } from "../core/artifact-store.mjs";
import { assertAssetReference } from "../contracts/asset-reference.mjs";
import { assertComponentTemplateCatalog, queryComponentTemplates } from "../contracts/component-template-catalog.mjs";
import { mergeEffectiveLayout } from "../contracts/layout.mjs";

const SELECTION_KINDS = new Set(["node", "edge", "group", "annotation"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertId(value, path) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]*$/.test(value)) {
    throw new Error(`${path} must be a stable identifier`);
  }
}

function assertSelection(selection) {
  if (selection === null) return null;
  if (!isRecord(selection)) throw new TypeError("selection must be an object or null");
  if (!SELECTION_KINDS.has(selection.kind)) throw new Error(`selection.kind is unsupported: ${String(selection.kind)}`);
  assertId(selection.id, "selection.id");
  return { kind: selection.kind, id: selection.id };
}

function findById(items, id) {
  return items.find((item) => item.id === id) ?? null;
}

function resolveTarget(artifact, effectiveLayout, selection) {
  if (selection === null) return null;
  const collection = {
    node: "nodes",
    edge: "edges",
    group: "groups",
    annotation: "annotations",
  }[selection.kind];
  const target = findById(artifact.semantic[collection] ?? artifact[collection], selection.id);
  if (!target) throw new Error(`selection target does not resolve: ${selection.kind}.${selection.id}`);
  const layout = selection.kind === "node"
    ? effectiveLayout.nodes[selection.id]
    : selection.kind === "edge"
      ? effectiveLayout.routes[selection.id]
      : selection.kind === "group"
        ? effectiveLayout.groups[selection.id]
        : null;
  return {
    kind: selection.kind,
    id: selection.id,
    semantic: clone(target),
    layout: layout ? clone(layout) : null,
    override: selection.kind === "node"
      ? clone(artifact.layout.overrides.nodes[selection.id] ?? {})
      : selection.kind === "edge"
        ? clone(artifact.layout.overrides.routes[selection.id] ?? {})
        : selection.kind === "group"
          ? clone(artifact.layout.overrides.groups[selection.id] ?? {})
          : null,
  };
}

function candidateFromMatch(match, resolver) {
  const manifest = resolver?.getManifest(match.templateId) ?? null;
  return {
    kind: "template",
    id: match.templateId,
    name: match.template.name,
    semanticDescription: match.template.semanticDescription,
    acceptedNodeTypes: [...match.template.acceptedNodeTypes],
    reasons: clone(match.reasons),
    score: match.score,
    manifest: manifest ? {
      id: manifest.id,
      kind: manifest.kind,
      parametersSchema: clone(manifest.parametersSchema),
      defaults: clone(manifest.defaults),
      fallback: clone(manifest.fallback),
    } : null,
    preview: { status: "contract-only", message: "Workspace 可消费该模板，但具体几何由 Renderer 负责。" },
  };
}

function availabilityById(availability = []) {
  if (!Array.isArray(availability)) throw new TypeError("assetAvailability must be an array");
  return new Map(availability.map((entry) => [entry.assetId, entry]));
}

function assetCandidate(asset, availability) {
  assertAssetReference(asset);
  const source = availability.get(asset.id) ?? {
    assetId: asset.id,
    status: "unverified",
    warning: "Asset availability was not confirmed by the current resolver run.",
  };
  const userModel = asset.kind === "gltf-model";
  return {
    kind: "asset",
    id: asset.id,
    label: asset.id,
    assetReference: clone(asset),
    preview: {
      status: source.status,
      uri: asset.uri,
      warning: source.warning ?? null,
    },
    export: userModel
      ? { status: "blocked", reason: "MVP 用户导入 GLB/GLTF 只保存路径和授权信息，暂不允许 PNG 导出。" }
      : { status: source.status === "available" ? "allowed" : "blocked", reason: source.warning ?? null },
  };
}

function nodeById(artifact, nodeId) {
  const node = findById(artifact.semantic.nodes, nodeId);
  if (!node) throw new Error(`replacement target does not resolve: semantic.nodes.${nodeId}`);
  return node;
}

/**
 * Build a renderer-independent selection/Inspector context for one Workspace
 * surface. The returned value is a read-only projection; it is not a command.
 */
export function createSelectionContext(artifact, selection = null, {
  catalog,
  resolver,
  semanticQuery,
  assetAvailability = [],
} = {}) {
  assertDiagramArtifact(artifact);
  const normalized = assertSelection(selection);
  const effectiveLayout = mergeEffectiveLayout(artifact.layout, artifact.composition.defaultView);
  const target = resolveTarget(artifact, effectiveLayout, normalized);
  const node = target?.kind === "node" ? target.semantic : null;
  const componentResolution = node && resolver
    ? resolver.resolveNode(node, {
      semanticQuery,
      assets: artifact.assets,
      assetAvailability,
    })
    : null;
  const candidates = node && catalog
    ? queryComponentTemplates(catalog, { nodeType: node.type, semanticQuery })
      .map((match) => candidateFromMatch(match, resolver))
    : [];
  return {
    selection: normalized,
    inspector: target ? {
      ...target,
      componentRef: node?.componentRef ?? null,
      resolvedParameters: componentResolution?.parameters ?? clone(target.layout?.parameters ?? {}),
    } : null,
    componentResolution: componentResolution ? clone(componentResolution) : null,
    componentCandidates: candidates,
    assetCandidates: artifact.assets.map((asset) => assetCandidate(asset, availabilityById(assetAvailability))),
    canReplaceComponent: target?.kind === "node",
  };
}

/** Return component candidates by the same semantic matching contract used by Codex. */
export function queryReplacementCandidates(catalog, {
  nodeType,
  semanticQuery,
  resolver,
} = {}) {
  assertComponentTemplateCatalog(catalog);
  return queryComponentTemplates(catalog, { nodeType, semanticQuery })
    .map((match) => candidateFromMatch(match, resolver));
}

/**
 * Produce a replacement proposal for the later Domain Command layer. This
 * function deliberately does not mutate the Artifact or pretend that a
 * Renderer has already loaded the candidate.
 */
export function proposeComponentReplacement(artifact, {
  nodeId,
  componentRef,
  assetId,
  parameters = {},
} = {}) {
  assertDiagramArtifact(artifact);
  assertId(nodeId, "replacement.nodeId");
  const node = nodeById(artifact, nodeId);
  if ((componentRef === undefined) === (assetId === undefined)) {
    throw new Error("replacement requires exactly one componentRef or assetId");
  }
  if (!isRecord(parameters)) throw new TypeError("replacement.parameters must be an object");
  if (componentRef !== undefined) assertId(componentRef, "replacement.componentRef");
  if (assetId !== undefined) {
    assertId(assetId, "replacement.assetId");
    const asset = artifact.assets.find((candidate) => candidate.id === assetId);
    if (!asset) throw new Error(`replacement asset does not resolve: ${assetId}`);
  }
  return {
    type: "component.replace",
    targetId: node.id,
    baseComponentRef: node.componentRef,
    nextComponentRef: componentRef ?? null,
    assetId: assetId ?? null,
    parameters: clone(parameters),
  };
}
