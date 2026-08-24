import { createDiagramError } from "./diagram-error.mjs";
import { projectOverlays } from "./overlay-projection.mjs";
import { assertRenderDocument } from "./render-document.mjs";
import { assertRendererCapabilities } from "./renderer-mapping.mjs";
import { projectSceneNodes } from "./scene-projection.mjs";

const FORMAT = "loom.icraft-scene-mapping";
const VERSION = "0.1";
const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function mappingError(code, message, {
  objectIds = [],
  fieldPath = "mapping",
  suggestedAction = "Repair the iCraft scene mapping before rendering.",
} = {}) {
  return createDiagramError({
    code,
    message,
    objectIds,
    fieldPath,
    recoverable: true,
    suggestedAction,
  });
}

function assertId(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw mappingError("invalid-tool-input", `${path} must be a stable identifier.`, { fieldPath: path });
  }
}

function assertNonEmptyString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw mappingError("invalid-tool-input", `${path} must be a non-empty string.`, { fieldPath: path });
  }
}

function assertUnique(value, seen, path, objectId) {
  if (seen.has(value)) {
    throw mappingError("duplicate-id", `${path} contains duplicate identity: ${value}.`, {
      objectIds: [objectId],
      fieldPath: path,
      suggestedAction: "Keep one mapping entry for each stable external element and Loom node.",
    });
  }
  seen.add(value);
}

/** Validate the persisted, runtime-neutral mapping manifest. */
export function assertIcraftSceneMapping(mapping) {
  if (!isRecord(mapping)) throw mappingError("invalid-tool-input", "iCraft scene mapping must be an object.");
  if (mapping.format !== FORMAT) {
    throw mappingError("invalid-tool-input", `Unsupported iCraft mapping format: ${String(mapping.format)}.`, {
      fieldPath: "mapping.format",
    });
  }
  if (mapping.version !== VERSION) {
    throw mappingError("unsupported-version", `Unsupported iCraft mapping version: ${String(mapping.version)}.`, {
      fieldPath: "mapping.version",
      suggestedAction: "Migrate the mapping manifest before rendering the scene.",
    });
  }
  assertId(mapping.sceneId, "mapping.sceneId");
  assertNonEmptyString(mapping.adapterId, "mapping.adapterId");
  assertNonEmptyString(mapping.sceneRevision, "mapping.sceneRevision");
  if (mapping.coordinateSpace !== "diagram") {
    throw mappingError("invalid-tool-input", "iCraft scene mapping must use Diagram coordinates.", {
      fieldPath: "mapping.coordinateSpace",
    });
  }
  if (!Array.isArray(mapping.nodes)) {
    throw mappingError("invalid-tool-input", "mapping.nodes must be an array.", { fieldPath: "mapping.nodes" });
  }

  const elementKeys = new Set();
  const nodeIds = new Set();
  for (const [index, entry] of mapping.nodes.entries()) {
    if (!isRecord(entry)) {
      throw mappingError("invalid-tool-input", `mapping.nodes[${index}] must be an object.`, {
        fieldPath: `mapping.nodes[${index}]`,
      });
    }
    assertId(entry.elementKey, `mapping.nodes[${index}].elementKey`);
    assertId(entry.nodeId, `mapping.nodes[${index}].nodeId`);
    assertNonEmptyString(entry.componentRef, `mapping.nodes[${index}].componentRef`);
    assertUnique(entry.elementKey, elementKeys, "mapping.nodes", entry.nodeId);
    assertUnique(entry.nodeId, nodeIds, "mapping.nodes", entry.nodeId);
  }
  return mapping;
}

function assertSceneElements(sceneElements) {
  if (!Array.isArray(sceneElements)) {
    throw mappingError("invalid-tool-input", "sceneElements must be an array.", { fieldPath: "sceneElements" });
  }
  const seen = new Set();
  return sceneElements.map((element, index) => {
    if (!isRecord(element)) {
      throw mappingError("invalid-tool-input", `sceneElements[${index}] must be an object.`, {
        fieldPath: `sceneElements[${index}]`,
      });
    }
    assertId(element.elementKey, `sceneElements[${index}].elementKey`);
    assertUnique(element.elementKey, seen, "sceneElements", element.elementKey);
    return element;
  });
}

function errorResult(error) {
  return { status: "error", error };
}

function sceneNodeById(sceneNodes) {
  return new Map(sceneNodes.map((node) => [node.nodeId, node]));
}

/**
 * Join public iCraft element identities to Loom SceneNodes without importing
 * a private scene tree. `sceneElements` is an adapter-owned snapshot of the
 * public element keys returned by the Player; it is never persisted.
 */
export function resolveIcraftSceneMapping(
  document,
  mapping,
  { capabilities, sceneElements } = {},
) {
  assertRenderDocument(document);
  try {
    assertIcraftSceneMapping(mapping);
    assertRendererCapabilities(capabilities);
    const elements = assertSceneElements(sceneElements);
    if (mapping.adapterId !== capabilities.adapterId) {
      return errorResult(mappingError(
        "unsupported-capability",
        `Mapping adapter ${mapping.adapterId} does not match Renderer adapter ${capabilities.adapterId}.`,
        {
          fieldPath: "mapping.adapterId",
          suggestedAction: "Load the mapping with the Adapter that produced it, or regenerate the mapping.",
        },
      ));
    }
    if (mapping.nodes.length !== elements.length) {
      return errorResult(mappingError(
        "dangling-reference",
        "Every loaded iCraft element must have exactly one Loom node mapping.",
        {
          fieldPath: "mapping.nodes",
          suggestedAction: "Refresh the public element snapshot and regenerate the mapping manifest.",
        },
      ));
    }

    const projectedNodes = projectSceneNodes(document, { capabilities });
    const projectedById = sceneNodeById(projectedNodes);
    const semanticById = new Map(document.semantic.nodes.map((node) => [node.id, node]));
    const elementsByKey = new Map(elements.map((element) => [element.elementKey, element]));
    const mappedNodeIds = new Set();
    const sceneNodes = [];
    for (const entry of mapping.nodes) {
      const element = elementsByKey.get(entry.elementKey);
      if (!element) {
        return errorResult(mappingError(
          "dangling-reference",
          `iCraft element ${entry.elementKey} is not present in the loaded scene snapshot.`,
          {
            objectIds: [entry.nodeId],
            fieldPath: "sceneElements",
            suggestedAction: "Reload the same scene revision and capture its public element keys again.",
          },
        ));
      }
      const projected = projectedById.get(entry.nodeId);
      const semantic = semanticById.get(entry.nodeId);
      if (!projected) {
        return errorResult(mappingError(
          "dangling-reference",
          `Loom node ${entry.nodeId} is not present in the RenderDocument.`,
          {
            objectIds: [entry.nodeId],
            fieldPath: "mapping.nodes",
            suggestedAction: "Map only semantic nodes present in the current RenderDocument revision.",
          },
        ));
      }
      if (!semantic || semantic.componentRef !== entry.componentRef) {
        return errorResult(mappingError(
          "invalid-tool-input",
          `Mapping componentRef for ${entry.nodeId} does not match the RenderDocument.`,
          {
            objectIds: [entry.nodeId],
            fieldPath: "mapping.nodes.componentRef",
            suggestedAction: "Regenerate the mapping after resolving the current component catalog.",
          },
        ));
      }
      mappedNodeIds.add(entry.nodeId);
      sceneNodes.push({
        elementKey: entry.elementKey,
        nodeId: projected.nodeId,
        semanticType: semantic.type,
        label: semantic.label,
        componentRef: semantic.componentRef,
        implementationRef: mapping.adapterId,
        bounds: clone(projected.bounds),
        elevation: projected.elevation,
        rotationYDeg: projected.rotationYDeg,
        scale: projected.scale,
        zIndex: projected.zIndex,
        parameters: clone(projected.parameters),
        status: "mapped",
        warnings: [...projected.warnings],
      });
    }

    return {
      status: "ready",
      sceneId: mapping.sceneId,
      adapterId: mapping.adapterId,
      sceneRevision: mapping.sceneRevision,
      coordinateSpace: "diagram",
      view: clone(document.effectiveLayout.view),
      sceneNodes,
      unmappedLoomNodeIds: projectedNodes
        .filter((node) => !mappedNodeIds.has(node.nodeId))
        .map((node) => node.nodeId),
      overlays: projectOverlays(document),
    };
  } catch (error) {
    if (error?.code && error?.message && error?.objectIds) return errorResult(error);
    return errorResult(mappingError(
      "invalid-tool-input",
      error instanceof Error ? error.message : String(error),
      { suggestedAction: "Repair the mapping inputs before rendering the scene." },
    ));
  }
}

export { FORMAT as ICRAFT_SCENE_MAPPING_FORMAT, VERSION as ICRAFT_SCENE_MAPPING_VERSION };
