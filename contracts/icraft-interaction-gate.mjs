import { createDiagramError } from "./diagram-error.mjs";
import {
  applyDomainCommand,
  beginPreview,
  cancelPreview,
  commitPreview,
  updatePreview,
} from "./interaction-commit.mjs";
import { assertRendererCapabilities } from "./renderer-mapping.mjs";

const OPERATION_DEFINITIONS = Object.freeze({
  move: Object.freeze({ commandType: "layout.node.move", capabilityKind: "interaction", capability: "move-plane" }),
  "rotate-y": Object.freeze({ commandType: "layout.node.rotate-y", capabilityKind: "interaction", capability: "rotate-y" }),
  "scale-uniform": Object.freeze({ commandType: "layout.node.scale", capabilityKind: "interaction", capability: "scale-uniform" }),
  elevation: Object.freeze({ commandType: "layout.node.elevation", capabilityKind: "feature", capability: "elevation-edit" }),
  "z-index": Object.freeze({ commandType: "layout.node.z-index", capabilityKind: "interaction", capability: "change-z-index" }),
  "route-edit": Object.freeze({ commandType: "layout.route.replace-points", capabilityKind: "interaction", capability: "edit-route" }),
});

function hasCapability(capabilities, definition) {
  const values = capabilities[definition.capabilityKind === "feature" ? "features" : "interactions"];
  return values.includes(definition.capability);
}

function clone(value) {
  return structuredClone(value);
}

function gateError(code, message, {
  targetId,
  fieldPath = "renderer.interactions",
  suggestedAction,
  suggestedFallback = "reference-renderer",
} = {}) {
  return createDiagramError({
    code,
    message,
    objectIds: targetId ? [targetId] : [],
    fieldPath,
    recoverable: true,
    suggestedAction,
    suggestedFallback,
  });
}

function operationAssessment(operation, definition, capabilities, fallbackAdapterId) {
  const supported = hasCapability(capabilities, definition);
  return {
    operation,
    commandType: definition.commandType,
    capabilityKind: definition.capabilityKind,
    capability: definition.capability,
    status: supported ? "supported" : "unsupported",
    fallbackAdapterId: supported ? null : fallbackAdapterId,
    reason: supported
      ? null
      : `iCraft Adapter ${capabilities.adapterId} does not declare ${definition.capabilityKind} ${definition.capability}.`,
  };
}

/** Return an auditable conclusion for each direct-manipulation operation. */
export function assessIcraftInteractionCapabilities(
  capabilities,
  { fallbackAdapterId = "reference-renderer" } = {},
) {
  assertRendererCapabilities(capabilities);
  const operations = Object.fromEntries(
    Object.entries(OPERATION_DEFINITIONS).map(([operation, definition]) => [
      operation,
      operationAssessment(operation, definition, capabilities, fallbackAdapterId),
    ]),
  );
  const unsupportedOperations = Object.values(operations)
    .filter(({ status }) => status === "unsupported")
    .map(({ operation }) => operation);
  return {
    status: unsupportedOperations.length === 0 ? "ready" : "partial",
    adapterId: capabilities.adapterId,
    adapterVersion: capabilities.adapterVersion,
    fallbackAdapterId,
    operations,
    supportedOperations: Object.values(operations).filter(({ status }) => status === "supported").map(({ operation }) => operation),
    unsupportedOperations,
  };
}

function unsupportedResult(assessment, operation, targetId) {
  const operationResult = assessment.operations[operation];
  return {
    status: "unsupported",
    operation,
    assessment,
    error: gateError(
      "unsupported-capability",
      `iCraft operation ${operation} is not supported by Adapter ${assessment.adapterId}.`,
      {
        targetId,
        fieldPath: `renderer.interactions.${operation}`,
        suggestedAction: `Use ${operationResult.fallbackAdapterId} for this operation, or keep the preview uncommitted.`,
        suggestedFallback: operationResult.fallbackAdapterId,
      },
    ),
  };
}

/** Begin one supported iCraft gesture, or return an explicit no-go result. */
export function beginIcraftPreview({
  capabilities,
  operation,
  baseRevision,
  gestureId,
  targetId,
  fallbackAdapterId,
} = {}) {
  const assessment = assessIcraftInteractionCapabilities(capabilities, { fallbackAdapterId });
  const definition = OPERATION_DEFINITIONS[operation];
  if (!definition) {
    return {
      status: "error",
      operation,
      assessment,
      error: gateError("invalid-tool-input", `Unknown iCraft operation: ${String(operation)}.`, {
        targetId,
        fieldPath: "renderer.interactions.operation",
        suggestedAction: "Choose one of the declared MVP iCraft operations.",
        suggestedFallback: assessment.fallbackAdapterId,
      }),
    };
  }
  if (assessment.operations[operation].status !== "supported") {
    return unsupportedResult(assessment, operation, targetId);
  }
  return {
    status: "preview",
    operation,
    assessment,
    session: beginPreview({
      baseRevision,
      gestureId,
      commandType: definition.commandType,
      targetId,
    }),
  };
}

export function updateIcraftPreview(preview, value) {
  if (preview?.status !== "preview") throw new Error("only a supported iCraft preview can be updated");
  return { ...preview, session: updatePreview(preview.session, value) };
}

export function cancelIcraftPreview(preview) {
  if (preview?.status !== "preview") throw new Error("only a supported iCraft preview can be cancelled");
  return { ...preview, status: "cancelled", session: cancelPreview(preview.session) };
}

/** Commit exactly one final frame and apply one field-level Human Override. */
export function commitIcraftPreview(preview, artifact) {
  if (preview?.status !== "preview") throw new Error("only a supported iCraft preview can be committed");
  const { command, session } = commitPreview(preview.session);
  return {
    ...preview,
    status: "committed",
    session,
    command: clone(command),
    artifact: applyDomainCommand(artifact, command),
  };
}

export { OPERATION_DEFINITIONS as ICRAFT_INTERACTION_OPERATIONS };
