import { createDiagramError } from "./diagram-error.mjs";
import { assertRendererCapabilities } from "./renderer-mapping.mjs";

const REQUIREMENT_FIELDS = [
  "projections",
  "componentKinds",
  "interactions",
  "exports",
  "assetFormats",
  "features",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertStringArray(value, path) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.length === 0) {
      throw new Error(`${path}[${index}] must be a non-empty string`);
    }
    if (seen.has(item)) throw new Error(`${path} contains duplicate capability: ${item}`);
    seen.add(item);
  }
}

function normalizeRequirements(requirements) {
  if (!isRecord(requirements)) throw new TypeError("renderer requirements must be an object");
  const normalized = {};
  for (const field of REQUIREMENT_FIELDS) {
    const value = requirements[field] ?? [];
    assertStringArray(value, `requirements.${field}`);
    normalized[field] = [...value];
  }
  if (requirements.projection !== undefined) {
    if (typeof requirements.projection !== "string" || requirements.projection.length === 0) {
      throw new Error("requirements.projection must be a non-empty string");
    }
    if (normalized.projections.length > 0 && !normalized.projections.includes(requirements.projection)) {
      throw new Error("requirements.projection conflicts with requirements.projections");
    }
    normalized.projections = [requirements.projection];
  }
  return normalized;
}

function missingCapabilities(requirements, capabilities) {
  return REQUIREMENT_FIELDS.flatMap((field) =>
    requirements[field]
      .filter((required) => !capabilities[field].includes(required))
      .map((value) => ({ field, value })),
  );
}

function capabilityLabel({ field, value }) {
  return `${field}:${value}`;
}

function warningForMissing(missing, adapterId) {
  return missing.map((entry) => ({
    capability: capabilityLabel(entry),
    message: `Renderer Adapter ${adapterId} does not provide ${entry.field} capability “${entry.value}”; fallback will be used.`,
  }));
}

/**
 * Validate the capability requirements for one RenderDocument before load.
 * `fallbackCapabilities` names missing capabilities that a caller explicitly
 * knows how to degrade without silently dropping semantic content.
 */
export function negotiateRendererCapabilities(
  requirements,
  capabilities,
  { objectIds = [], fallbackCapabilities = [] } = {},
) {
  const normalizedRequirements = normalizeRequirements(requirements);
  const validatedCapabilities = assertRendererCapabilities(capabilities);
  assertStringArray(objectIds, "objectIds");
  assertStringArray(fallbackCapabilities, "fallbackCapabilities");

  const missing = missingCapabilities(normalizedRequirements, validatedCapabilities);
  if (missing.length === 0) {
    return {
      status: "ready",
      adapterId: validatedCapabilities.adapterId,
      adapterVersion: validatedCapabilities.adapterVersion,
      capabilities: clone(validatedCapabilities),
      missing: [],
      warnings: [],
      error: null,
    };
  }

  const fallbackSet = new Set(fallbackCapabilities);
  const unresolved = missing.filter((entry) => !fallbackSet.has(capabilityLabel(entry)));
  const warnings = warningForMissing(missing, validatedCapabilities.adapterId);
  if (unresolved.length === 0) {
    return {
      status: "fallback",
      adapterId: validatedCapabilities.adapterId,
      adapterVersion: validatedCapabilities.adapterVersion,
      capabilities: clone(validatedCapabilities),
      missing: missing.map(capabilityLabel),
      warnings,
      error: null,
    };
  }

  const unresolvedLabels = unresolved.map(capabilityLabel);
  return {
    status: "error",
    adapterId: validatedCapabilities.adapterId,
    adapterVersion: validatedCapabilities.adapterVersion,
    capabilities: clone(validatedCapabilities),
    missing: missing.map(capabilityLabel),
    warnings,
    error: createDiagramError({
      code: "unsupported-capability",
      message: `Renderer Adapter ${validatedCapabilities.adapterId} cannot satisfy required capabilities: ${unresolvedLabels.join(", ")}.`,
      objectIds,
      fieldPath: "rendererCapabilities",
      recoverable: true,
      suggestedAction: "Choose an Adapter with the required capabilities or declare an explicit fallback.",
      suggestedFallback: "reference-renderer",
    }),
  };
}

export { normalizeRequirements };

