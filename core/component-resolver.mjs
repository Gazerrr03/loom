import { createDiagramError } from "../contracts/diagram-error.mjs";
import {
  assertComponentTemplateCatalog,
  queryComponentTemplates,
} from "../contracts/component-template-catalog.mjs";
import {
  assertParameterContract,
  parameterFingerprint,
  resolveParameters,
} from "../contracts/component-parameters.mjs";
import {
  assertAssetReference,
  evaluatePngAssetGate,
  inspectAssets,
} from "../contracts/asset-reference.mjs";
import {
  assertRendererCapabilities,
  resolveRendererMapping,
} from "../contracts/renderer-mapping.mjs";
import { assertDiagramArtifact } from "./artifact-store.mjs";

const REGISTRY_FORMAT = "loom.component-registry";
const SCHEMA_VERSION = "0.1.0";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertStableId(value, path) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]*$/.test(value)) {
    throw new Error(`${path} must be a stable identifier`);
  }
}

function assertRegistry(registry) {
  if (!isRecord(registry)) throw new TypeError("component registry must be an object");
  if (registry.format !== REGISTRY_FORMAT) throw new Error("Unsupported component registry format");
  if (registry.schemaVersion !== SCHEMA_VERSION) throw new Error("Unsupported component registry schemaVersion");
  if (!Array.isArray(registry.templates) || registry.templates.length === 0) {
    throw new Error("component registry templates must be a non-empty array");
  }
  const ids = new Set();
  for (const [index, entry] of registry.templates.entries()) {
    if (!isRecord(entry)) throw new Error(`templates[${index}] must be an object`);
    assertStableId(entry.id, `templates[${index}].id`);
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      throw new Error(`templates[${index}].path must be a non-empty string`);
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate component registry ID: ${entry.id}`);
    ids.add(entry.id);
  }
  if (!Array.isArray(registry.goldenTemplateIds)) throw new Error("goldenTemplateIds must be an array");
  for (const [index, id] of registry.goldenTemplateIds.entries()) {
    assertStableId(id, `goldenTemplateIds[${index}]`);
    if (!ids.has(id)) throw new Error(`goldenTemplateIds[${index}] does not resolve: ${id}`);
  }
  return registry;
}

function normalizeManifests(registry, manifests) {
  const entries = Array.isArray(manifests)
    ? manifests
    : isRecord(manifests)
      ? Object.values(manifests)
      : [];
  const byId = new Map();
  for (const [index, manifest] of entries.entries()) {
    if (!isRecord(manifest)) throw new Error(`manifests[${index}] must be an object`);
    assertStableId(manifest.id, `manifests[${index}].id`);
    if (byId.has(manifest.id)) throw new Error(`Duplicate component manifest ID: ${manifest.id}`);
    assertParameterContract(manifest);
    byId.set(manifest.id, clone(manifest));
  }
  for (const entry of registry.templates) {
    if (!byId.has(entry.id)) throw new Error(`Component registry manifest is missing: ${entry.id}`);
  }
  return byId;
}

function identityManifest(template) {
  return {
    format: "loom.component-template",
    schemaVersion: SCHEMA_VERSION,
    id: template.id,
    name: template.name,
    kind: "fallback",
    semanticDescription: template.semanticDescription,
    acceptedNodeTypes: [...template.acceptedNodeTypes],
    searchTerms: [...template.searchTerms],
    parametersSchema: { type: "object", additionalProperties: false, properties: {} },
    defaults: {},
    capabilities: { transforms: [], supportsLabels: true, supportsThemeTokens: true, requires: [] },
    dependencies: { primitiveRefs: [], assetRefs: [] },
    rendererMappings: {},
    fallback: { componentRef: template.id, parameterMap: {} },
  };
}

function createResolverError({ code, message, node, fieldPath = "componentRef", suggestedAction, cause = null }) {
  return createDiagramError({
    code,
    message,
    objectIds: node?.id ? [node.id] : [],
    fieldPath,
    recoverable: true,
    suggestedAction,
    cause,
  });
}

function assertNode(node) {
  if (!isRecord(node)) throw new TypeError("component resolver node must be an object");
  for (const field of ["id", "type", "label", "componentRef"]) {
    if (typeof node[field] !== "string" || node[field].length === 0) {
      throw new Error(`node.${field} must be a non-empty string`);
    }
  }
  return node;
}

function normalizeAvailability(availability) {
  if (availability === undefined) return new Map();
  if (!Array.isArray(availability)) throw new TypeError("assetAvailability must be an array");
  const byId = new Map();
  for (const entry of availability) {
    if (!isRecord(entry) || typeof entry.assetId !== "string" || typeof entry.status !== "string") {
      throw new Error("assetAvailability entries require assetId and status");
    }
    if (byId.has(entry.assetId)) throw new Error(`Duplicate asset availability ID: ${entry.assetId}`);
    byId.set(entry.assetId, clone(entry));
  }
  return byId;
}

function assetStatus(asset, availability) {
  if (!asset) {
    return { assetId: null, status: "missing", warning: "Component asset reference does not resolve." };
  }
  const entry = availability.get(asset.id);
  return entry ?? {
    assetId: asset.id,
    status: "unverified",
    sourceKind: "unknown",
    warning: "Asset availability was not confirmed by the current resolver run.",
  };
}

function projectAssets(assets, availability) {
  return Object.fromEntries(assets.map((asset) => [asset.id, {
    ...clone(asset),
    availability: clone(availability.get(asset.id) ?? assetStatus(asset, availability)),
  }]));
}

function selectedMatch(matches, templateId) {
  const match = matches.find((candidate) => candidate.templateId === templateId);
  if (match) return match;
  return {
    kind: "component-ref",
    value: templateId,
    label: `显式组件引用“${templateId}”`,
  };
}

/**
 * Create the single Core-facing resolver used by Codex and Workspace.
 *
 * The resolver returns contract data only. It never creates a mesh, camera,
 * scene graph, GPU handle, or other Renderer-private runtime object.
 */
export function createComponentResolver({ catalog, registry, manifests, capabilities }) {
  assertComponentTemplateCatalog(catalog);
  assertRegistry(registry);
  const manifestById = normalizeManifests(registry, manifests);
  assertRendererCapabilities(capabilities);

  const templateById = new Map(catalog.templates.map((template) => [template.id, template]));

  function getTemplate(templateId) {
    return templateById.get(templateId) ?? null;
  }

  function getManifest(templateId) {
    const template = getTemplate(templateId);
    if (!template) return null;
    return manifestById.get(templateId) ?? identityManifest(template);
  }

  function resolveNode(node, { semanticQuery, parameters, assets = [], assetAvailability } = {}) {
    assertNode(node);
    if (!Array.isArray(assets)) throw new TypeError("assets must be an array");
    const availability = normalizeAvailability(assetAvailability);
    const template = getTemplate(node.componentRef);
    const matches = template
      ? queryComponentTemplates(catalog, { nodeType: node.type, semanticQuery })
      : [];

    if (!template) {
      const error = createResolverError({
        code: "unsupported-template",
        message: `Component template ${node.componentRef} does not resolve in the catalog.`,
        node,
        suggestedAction: "Choose a catalog component template before rendering the node.",
      });
      return {
        status: "error",
        nodeId: node.id,
        semanticType: node.type,
        label: node.label,
        componentRef: node.componentRef,
        template: null,
        matches: [],
        parameters: null,
        parameterFingerprint: null,
        renderer: null,
        assets: [],
        warnings: [],
        error,
      };
    }

    const manifest = getManifest(node.componentRef);
    const rawParameters = parameters === undefined ? (node.parameters ?? {}) : parameters;
    let resolvedParameters;
    let fingerprint;
    try {
      resolvedParameters = resolveParameters(manifest, rawParameters);
      fingerprint = parameterFingerprint(manifest, rawParameters);
    } catch (error) {
      const resolverError = createResolverError({
        code: "unsupported-template",
        message: `Parameters for component template ${manifest.id} are invalid.`,
        node,
        fieldPath: "parameters",
        suggestedAction: "Fix the node parameters or restore the template defaults.",
        cause: error.message,
      });
      return {
        status: "error",
        nodeId: node.id,
        semanticType: node.type,
        label: node.label,
        componentRef: node.componentRef,
        template: clone(template),
        matches: matches.map((candidate) => ({
          templateId: candidate.templateId,
          score: candidate.score,
          reasons: clone(candidate.reasons),
        })),
        selectedMatch: selectedMatch(matches, node.componentRef),
        parameters: null,
        parameterFingerprint: null,
        renderer: null,
        assets: [],
        warnings: [],
        error: resolverError,
      };
    }

    const renderer = resolveRendererMapping(manifest, capabilities, {
      ...clone(node),
      parameters: clone(rawParameters),
    });
    const requiredAssetIds = [...new Set(manifest.dependencies?.assetRefs ?? [])];
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const resolvedAssets = requiredAssetIds.map((assetId) => {
      const asset = assetsById.get(assetId);
      if (asset) assertAssetReference(asset);
      return assetStatus(asset, availability);
    });
    const warnings = [
      ...(renderer.reasons ?? []),
      ...resolvedAssets.filter((entry) => entry.status !== "available").map((entry) => entry.warning),
    ];
    return {
      status: renderer.status,
      nodeId: node.id,
      semanticType: node.type,
      label: node.label,
      componentRef: node.componentRef,
      template: clone(template),
      matches: matches.map((candidate) => ({
        templateId: candidate.templateId,
        score: candidate.score,
        reasons: clone(candidate.reasons),
      })),
      selectedMatch: selectedMatch(matches, node.componentRef),
      parameters: clone(resolvedParameters),
      parameterFingerprint: fingerprint,
      renderer: clone(renderer),
      assets: resolvedAssets,
      warnings,
      error: renderer.error ?? null,
    };
  }

  async function resolveArtifact(artifact, {
    revision = null,
    semanticQueries = {},
    assetAvailability,
    baseDir = process.cwd(),
  } = {}) {
    assertDiagramArtifact(artifact);
    const availability = assetAvailability === undefined
      ? await inspectAssets(artifact.assets, { baseDir })
      : assetAvailability;
    const availabilityById = normalizeAvailability(availability);
    const pngGate = evaluatePngAssetGate(artifact.assets, availability);
    const nodes = {};
    const components = {};
    for (const node of artifact.semantic.nodes) {
      const result = resolveNode(node, {
        semanticQuery: semanticQueries[node.id],
        assets: artifact.assets,
        assetAvailability: availability,
      });
      nodes[node.id] = result;
      if (result.template) components[node.componentRef] = clone(getManifest(node.componentRef));
    }
    return {
      artifactId: artifact.id,
      revision,
      components,
      assets: projectAssets(artifact.assets, availabilityById),
      assetAvailability: clone(availability),
      pngGate: clone(pngGate),
      nodes,
    };
  }

  return {
    getTemplate: (templateId) => clone(getTemplate(templateId)),
    getManifest: (templateId) => clone(getManifest(templateId)),
    resolveNode,
    resolveArtifact,
  };
}

