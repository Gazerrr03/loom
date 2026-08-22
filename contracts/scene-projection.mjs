import { createDiagramError } from "./diagram-error.mjs";
import { assertRenderDocument } from "./render-document.mjs";
import { assertRendererCapabilities, resolveRendererMapping } from "./renderer-mapping.mjs";

const GENERIC_COMPONENTS = new Set(["generic-card-slab", "generic-input-plinth"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function genericFallback(manifest, node) {
  return {
    status: "fallback",
    nodeId: node.id,
    semanticType: node.type,
    label: node.label,
    sourceTemplateId: manifest.id,
    componentRef: manifest.id,
    implementationRef: `builtin://fallback/${manifest.id}`,
    parameterMap: {},
    reasons: [`Template ${manifest.id} uses the neutral fallback projection.`],
  };
}

function resolveProjection(manifest, capabilities, node) {
  if (manifest?.rendererMappings && manifest?.fallback && manifest?.parametersSchema) {
    return resolveRendererMapping(manifest, capabilities, node);
  }
  if (manifest && GENERIC_COMPONENTS.has(manifest.id)) return genericFallback(manifest, node);
  return {
    status: "error",
    nodeId: node.id,
    semanticType: node.type,
    label: node.label,
    error: createDiagramError({
      code: "unsupported-template",
      message: `Component template ${node.componentRef} cannot be projected by this Renderer.`,
      objectIds: [node.id],
      fieldPath: "componentRef",
      recoverable: true,
      suggestedAction: "Choose a supported component template or declare an explicit fallback.",
    }),
  };
}

function assertLayoutEntry(document, node) {
  const layout = document.effectiveLayout.nodes[node.id];
  if (!isRecord(layout)) {
    throw createDiagramError({
      code: "invalid-layout",
      message: `Effective Layout is missing for node ${node.id}.`,
      objectIds: [node.id],
      fieldPath: "effectiveLayout.nodes",
      recoverable: true,
      suggestedAction: "Regenerate the layout before rendering the Diagram.",
    });
  }
  return layout;
}

function sceneNode(node, layout, projection) {
  return {
    nodeId: node.id,
    semanticType: node.type,
    label: node.label,
    status: projection.status,
    sourceComponentRef: node.componentRef,
    componentRef: projection.componentRef ?? node.componentRef,
    implementationRef: projection.implementationRef ?? null,
    bounds: {
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    },
    elevation: layout.elevation ?? 0,
    rotationYDeg: layout.rotationYDeg ?? 0,
    scale: layout.scale ?? 1,
    zIndex: layout.zIndex ?? 0,
    parameters: clone(projection.parameters ?? projection.parameterMap ?? layout.parameters ?? {}),
    warnings: projection.reasons ? [...projection.reasons] : [],
    error: projection.error ?? null,
  };
}

/** Project semantic nodes into stable renderer scene descriptions. */
export function projectSceneNodes(document, { capabilities } = {}) {
  assertRenderDocument(document);
  assertRendererCapabilities(capabilities);

  return document.semantic.nodes.map((node) => {
    const layout = assertLayoutEntry(document, node);
    const manifest = document.components[node.componentRef];
    const projection = resolveProjection(manifest, capabilities, node);
    return sceneNode(node, layout, projection);
  });
}

export function assertSceneNode(sceneNodeValue) {
  if (!isRecord(sceneNodeValue)) throw new TypeError("Scene Node must be an object");
  for (const field of ["nodeId", "semanticType", "label", "status", "componentRef"]) {
    if (typeof sceneNodeValue[field] !== "string" || sceneNodeValue[field].length === 0) {
      throw new Error(`Scene Node ${field} must be a non-empty string`);
    }
  }
  if (!isRecord(sceneNodeValue.bounds)) throw new Error("Scene Node bounds must be an object");
  for (const field of ["x", "y", "width", "height"]) {
    if (typeof sceneNodeValue.bounds[field] !== "number" || !Number.isFinite(sceneNodeValue.bounds[field])) {
      throw new Error(`Scene Node bounds.${field} must be finite`);
    }
  }
  for (const field of ["elevation", "rotationYDeg", "scale", "zIndex"]) {
    if (typeof sceneNodeValue[field] !== "number" || !Number.isFinite(sceneNodeValue[field])) {
      throw new Error(`Scene Node ${field} must be finite`);
    }
  }
  if (!isRecord(sceneNodeValue.parameters)) throw new Error("Scene Node parameters must be an object");
  if (!Array.isArray(sceneNodeValue.warnings)) throw new Error("Scene Node warnings must be an array");
  return sceneNodeValue;
}

