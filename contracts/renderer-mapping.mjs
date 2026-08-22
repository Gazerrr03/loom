import { assertParameterContract, resolveParameters } from "./component-parameters.mjs";
import { createDiagramError } from "./diagram-error.mjs";

const COMPONENT_KINDS = new Set(["parametric-scene", "asset", "fallback"]);
const PROJECTIONS = new Set(["orthographic", "perspective"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertCapabilities(capabilities) {
  if (!isRecord(capabilities)) throw new TypeError("renderer capabilities must be an object");
  for (const field of ["adapterId", "adapterVersion"]) {
    if (typeof capabilities[field] !== "string" || capabilities[field].length === 0) {
      throw new Error(`capabilities.${field} must be a non-empty string`);
    }
  }
  for (const field of ["projections", "componentKinds", "interactions", "exports", "assetFormats", "features"]) {
    if (!Array.isArray(capabilities[field])) throw new Error(`capabilities.${field} must be an array`);
  }
  if (capabilities.projections.some((projection) => !PROJECTIONS.has(projection))) {
    throw new Error("capabilities.projections contains an unsupported projection");
  }
  if (capabilities.componentKinds.some((kind) => !COMPONENT_KINDS.has(kind))) {
    throw new Error("capabilities.componentKinds contains an unsupported component kind");
  }
}

function requiredFeatures(manifest, mapping) {
  return [...new Set([
    ...(manifest.capabilities?.requires ?? []),
    ...(mapping?.requiredCapabilities ?? []),
  ])];
}

function nodeIdentity(node, manifest) {
  return {
    nodeId: typeof node?.id === "string" ? node.id : null,
    semanticType: typeof node?.type === "string" ? node.type : null,
    label: typeof node?.label === "string" ? node.label : manifest.name,
  };
}

function failureResult(manifest, node, code, message, suggestedAction, details = {}) {
  const identity = nodeIdentity(node, manifest);
  const objectIds = identity.nodeId ? [identity.nodeId] : [];
  return {
    status: "error",
    ...identity,
    error: createDiagramError({
      code,
      message,
      objectIds,
      fieldPath: "componentRef",
      recoverable: true,
      suggestedAction,
    }),
    ...details,
  };
}

function fallbackResult(manifest, node, reasons) {
  const identity = nodeIdentity(node, manifest);
  return {
    status: "fallback",
    ...identity,
    sourceTemplateId: manifest.id,
    componentRef: manifest.fallback.componentRef,
    parameterMap: manifest.fallback.parameterMap ?? {},
    reasons,
  };
}

export function assertRendererCapabilities(capabilities) {
  assertCapabilities(capabilities);
  return capabilities;
}

/** Resolve one manifest against one Adapter without mutating semantic identity. */
export function resolveRendererMapping(manifest, capabilities, node = {}) {
  assertParameterContract(manifest);
  assertCapabilities(capabilities);
  if (!isRecord(manifest.rendererMappings)) throw new Error("rendererMappings must be an object");
  if (!isRecord(manifest.fallback) || typeof manifest.fallback.componentRef !== "string") {
    throw new Error("fallback.componentRef is required for mapping resolution");
  }

  const mapping = manifest.rendererMappings[capabilities.adapterId];
  const reasons = [];
  if (!mapping) {
    reasons.push(`Adapter ${capabilities.adapterId} has no mapping for ${manifest.id}`);
    return fallbackResult(manifest, node, reasons);
  }

  if (!capabilities.componentKinds.includes(manifest.kind)) {
    reasons.push(`Adapter does not support component kind ${manifest.kind}`);
  }
  const missingFeatures = requiredFeatures(manifest, mapping).filter(
    (feature) => !capabilities.features.includes(feature),
  );
  if (missingFeatures.length > 0) reasons.push(`Missing capabilities: ${missingFeatures.join(", ")}`);

  if (reasons.length > 0) return fallbackResult(manifest, node, reasons);

  let parameters;
  try {
    parameters = resolveParameters(manifest, node.parameters ?? {});
  } catch (error) {
    return failureResult(
      manifest,
      node,
      "unsupported-template",
      "Component parameters cannot be resolved for this mapping.",
      "Fix the component parameters before rendering.",
      { cause: error.message },
    );
  }
  return {
    status: "mapped",
    ...nodeIdentity(node, manifest),
    sourceTemplateId: manifest.id,
    adapterId: capabilities.adapterId,
    implementationRef: mapping.implementationRef,
    parameters,
  };
}

export { requiredFeatures };
