import { assertComposition } from "./composition.mjs";
import { assertDiagramEnvelope } from "./diagram-envelope.mjs";
import { mergeEffectiveLayout } from "./layout.mjs";
import { assertLayout } from "./layout.mjs";
import { assertPresentationBoundary } from "./presentation.mjs";
import { assertSemanticGraph } from "./semantic-graph.mjs";

const COLLECTIONS = ["nodes", "edges", "groups"];
const RENDER_DOCUMENT_KEYS = [
  "artifactId",
  "revision",
  "semantic",
  "composition",
  "effectiveLayout",
  "annotations",
  "presentation",
  "components",
  "assets",
];

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

function assertRevision(revision) {
  if (typeof revision !== "string" || revision.length === 0) {
    throw new Error("RenderDocument revision must be a non-empty string");
  }
}

function assertArtifact(artifact) {
  assertDiagramEnvelope(artifact);
  assertSemanticGraph(artifact.semantic);
  assertComposition(artifact.composition);
  assertLayout(artifact.layout);
  assertPresentationBoundary({
    semantic: artifact.semantic,
    annotations: artifact.annotations,
    presentation: artifact.presentation,
    assets: artifact.assets,
  });
  return artifact;
}

function assertMap(value, path) {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object map`);
  for (const [id, entry] of Object.entries(value)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${path}.${id} must be an object`);
    }
  }
}

function indexById(items, path) {
  if (!Array.isArray(items)) throw new TypeError(`${path} must be an array`);
  const result = {};
  for (const [index, item] of items.entries()) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0) {
      throw new Error(`${path}[${index}].id must be a non-empty string`);
    }
    if (Object.hasOwn(result, item.id)) throw new Error(`Duplicate ${path} id: ${item.id}`);
    result[item.id] = item;
  }
  return result;
}

function assertComponentCoverage(semantic, components) {
  for (const node of semantic.nodes) {
    if (!Object.hasOwn(components, node.componentRef)) {
      throw new Error(`RenderDocument component is missing: ${node.componentRef}`);
    }
  }
}

function assertAssetCoverage(assets, resolvedAssets) {
  for (const asset of assets) {
    if (!Object.hasOwn(resolvedAssets, asset.id)) {
      throw new Error(`RenderDocument asset is missing: ${asset.id}`);
    }
  }
}

function assertRenderDocumentShape(document) {
  const keys = Object.keys(document).sort();
  const expected = [...RENDER_DOCUMENT_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error("RenderDocument contains an unsupported top-level field");
  }
  if (typeof document.artifactId !== "string" || document.artifactId.length === 0) {
    throw new Error("RenderDocument artifactId must be a non-empty string");
  }
  assertRevision(document.revision);
  for (const collection of COLLECTIONS) {
    if (!Array.isArray(document.semantic[collection])) {
      throw new Error(`RenderDocument semantic.${collection} must be an array`);
    }
  }
  assertMap(document.effectiveLayout.nodes, "RenderDocument effectiveLayout.nodes");
  assertMap(document.effectiveLayout.routes, "RenderDocument effectiveLayout.routes");
  assertMap(document.effectiveLayout.groups, "RenderDocument effectiveLayout.groups");
  if (!isRecord(document.effectiveLayout.view)) {
    throw new Error("RenderDocument effectiveLayout.view must be an object");
  }
  assertMap(document.components, "RenderDocument components");
  assertMap(document.assets, "RenderDocument assets");
  return document;
}

/**
 * Build the renderer-facing, read-only projection of one Diagram Artifact.
 *
 * Component and asset maps are intentionally supplied by the caller. Their
 * resolution belongs to the Core/Adapter boundary in later renderer issues;
 * this issue only fixes the shape and the effective-layout merge semantics.
 */
export function createRenderDocument(
  artifact,
  { revision, components = [], assets = artifact?.assets ?? [] } = {},
) {
  assertArtifact(artifact);
  assertRevision(revision);

  const componentMap = Array.isArray(components)
    ? indexById(components, "components")
    : components;
  const assetMap = Array.isArray(assets) ? indexById(assets, "assets") : assets;
  assertMap(componentMap, "components");
  assertMap(assetMap, "assets");
  assertComponentCoverage(artifact.semantic, componentMap);
  assertAssetCoverage(artifact.assets, assetMap);

  const document = {
    artifactId: artifact.id,
    revision,
    semantic: clone(artifact.semantic),
    composition: clone(artifact.composition),
    effectiveLayout: clone(mergeEffectiveLayout(artifact.layout, artifact.composition.defaultView)),
    annotations: clone(artifact.annotations),
    presentation: clone(artifact.presentation),
    components: clone(componentMap),
    assets: clone(assetMap),
  };

  assertRenderDocumentShape(document);
  return deepFreeze(document);
}

export function assertRenderDocument(document) {
  assertRenderDocumentShape(document);
  return document;
}
