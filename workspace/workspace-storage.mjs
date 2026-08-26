import { createDiagramError } from "../contracts/diagram-error.mjs";
import { assertComposition } from "../contracts/composition.mjs";
import { assertDiagramEnvelope } from "../contracts/diagram-envelope.mjs";
import { assertLayout } from "../contracts/layout.mjs";
import { assertPersistedDiagramBoundary } from "../contracts/persisted-boundary.mjs";
import { assertPresentationBoundary } from "../contracts/presentation.mjs";
import { diagramRectToWorld } from "../contracts/coordinates.mjs";
import { assertSemanticGraph } from "../contracts/semantic-graph.mjs";
import { createRenderDocument } from "../contracts/render-document.mjs";
import { projectOverlays } from "../contracts/overlay-projection.mjs";
import { createPngCaptureRequest, capturePngWithAdapter } from "../contracts/png-capture.mjs";
import { createPngComposition } from "../contracts/png-composition.mjs";
import { captureOptionsFromPreset, createPngExportPreset } from "../contracts/png-presets.mjs";

function clone(value) {
  return structuredClone(value);
}

function assertArtifact(artifact) {
  assertDiagramEnvelope(artifact);
  assertPersistedDiagramBoundary(artifact);
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

function assertDate(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("workspace save time must be a valid Date");
  }
}

function normalizeFileName(fileName) {
  if (typeof fileName !== "string" || fileName.trim().length === 0) return "diagram.json";
  const leaf = fileName.trim().split(/[\\/]/).at(-1) || "diagram.json";
  return /\.json$/i.test(leaf) ? leaf : `${leaf}.json`;
}

function safeError(error, fallbackCode, suggestedAction) {
  if (error && typeof error === "object" && typeof error.code === "string") return error;
  return createDiagramError({
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error),
    recoverable: true,
    suggestedAction,
  });
}

/** Return the canonical JSON bytes used by both browser and Node adapters. */
export function serializeWorkspaceArtifact(artifact, { now = new Date() } = {}) {
  assertDate(now);
  const next = clone(artifact);
  assertArtifact(next);
  next.metadata.updatedAt = now.toISOString();
  assertArtifact(next);
  const text = `${JSON.stringify(next, null, 2)}\n`;
  return {
    artifact: next,
    text,
    fileName: "diagram.json",
    updatedAt: next.metadata.updatedAt,
    sizeBytes: new TextEncoder().encode(text).byteLength,
  };
}

/** Compute a stable revision without importing Node-only crypto modules. */
export async function revisionForText(text) {
  if (typeof text !== "string") throw new TypeError("revision input must be text");
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable");
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

/** Fingerprint the current draft without mutating metadata or saving it. */
export async function revisionForArtifact(artifact) {
  assertArtifact(artifact);
  return revisionForText(`${JSON.stringify(artifact, null, 2)}\n`);
}

/**
 * Save through an injected adapter. The adapter receives JSON text only; it
 * cannot accidentally persist renderer runtime state or binary model bytes.
 */
export async function saveWorkspaceWithAdapter(
  artifact,
  { fileName = "diagram.json", now = new Date(), adapter, expectedRevision, currentRevision } = {},
) {
  if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
    throw createDiagramError({
      code: "revision-conflict",
      message: "Diagram revision changed before save.",
      recoverable: true,
      suggestedAction: "Reload the latest Diagram, review the changes, then save again.",
    });
  }
  if (!adapter || typeof adapter.save !== "function") {
    throw createDiagramError({
      code: "invalid-tool-input",
      message: "Workspace save adapter is unavailable.",
      fieldPath: "workspace.save",
      recoverable: true,
      suggestedAction: "Choose a writable JSON download adapter and retry.",
    });
  }
  let prepared;
  try {
    prepared = serializeWorkspaceArtifact(artifact, { now });
    prepared.fileName = normalizeFileName(fileName);
    prepared.revision = await revisionForText(prepared.text);
  } catch (error) {
    throw safeError(error, "invalid-envelope", "Fix the Diagram validation error before saving.");
  }
  try {
    const output = await adapter.save({
      fileName: prepared.fileName,
      text: prepared.text,
      artifact: clone(prepared.artifact),
      revision: prepared.revision,
    });
    return {
      ...prepared,
      output: output === undefined ? null : clone(output),
    };
  } catch (error) {
    throw safeError(error, "render-failed", "Retry the JSON save; the current draft remains in memory.");
  }
}

function componentMapFor(artifact, catalog = []) {
  const catalogMap = new Map((Array.isArray(catalog) ? catalog : []).map((entry) => [entry.id, entry]));
  return Object.fromEntries(
    [...new Set(artifact.semantic.nodes.map((node) => node.componentRef))].map((id) => [
      id,
      clone(catalogMap.get(id) ?? {
        id,
        name: id,
        semanticDescription: "Renderer fallback component.",
        fallback: true,
      }),
    ]),
  );
}

function assetMapFor(artifact) {
  return Object.fromEntries(artifact.assets.map((asset) => [asset.id, clone(asset)]));
}

function sceneNodesFor(document) {
  return document.semantic.nodes.map((node) => {
    const layout = document.effectiveLayout.nodes[node.id];
    return {
      nodeId: node.id,
      semanticType: node.type,
      label: node.label,
      status: "fallback",
      sourceComponentRef: node.componentRef,
      componentRef: node.componentRef,
      implementationRef: null,
      bounds: {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      worldBounds: diagramRectToWorld(layout, {
        elevation: layout.elevation ?? 0,
        path: `scene.nodes.${node.id}.bounds`,
      }),
      elevation: layout.elevation ?? 0,
      rotationYDeg: layout.rotationYDeg ?? 0,
      scale: layout.scale ?? 1,
      zIndex: layout.zIndex ?? 0,
      parameters: clone(layout.parameters ?? {}),
      warnings: ["Workspace PNG uses the active Reference Renderer scene projection."],
      error: null,
    };
  });
}

function assertExportableAssets(artifact) {
  const blockedAssets = artifact.assets.filter((asset) => (
    asset.kind === "gltf-model" && /unconfirmed/i.test(asset.license ?? "")
  ));
  if (blockedAssets.length === 0) return;
  throw createDiagramError({
    code: "missing-asset",
    message: "PNG export is blocked because GLB authorization is unconfirmed.",
    objectIds: blockedAssets.map((asset) => asset.id),
    fieldPath: "assets",
    recoverable: true,
    suggestedAction: "Confirm the model license or remove the GLB reference before exporting.",
  });
}

/** Build the immutable, renderer-independent export plan for the current draft. */
export async function createWorkspacePngPlan(
  artifact,
  { revision, catalog = [], sceneNodes, overlays, range = "spread", pageId, dpi = 300 } = {},
) {
  assertArtifact(artifact);
  assertExportableAssets(artifact);
  const resolvedRevision = revision ?? await revisionForArtifact(artifact);
  const document = createRenderDocument(artifact, {
    revision: resolvedRevision,
    components: componentMapFor(artifact, catalog),
    assets: assetMapFor(artifact),
  });
  const preset = createPngExportPreset(document.composition, { range, pageId, dpi });
  const request = createPngCaptureRequest(document, captureOptionsFromPreset(preset));
  const projectedOverlays = overlays ?? projectOverlays(document);
  const composition = createPngComposition(request, {
    sceneNodes: sceneNodes ?? sceneNodesFor(document),
    overlays: projectedOverlays,
    composition: document.composition,
  });
  return Object.freeze({ document, preset, request, composition });
}

/** Capture a previously built plan while keeping receipt revision-bound. */
export async function captureWorkspacePng(plan, adapter) {
  if (!plan || !plan.document || !plan.request || !plan.composition) {
    throw new TypeError("Workspace PNG plan is incomplete");
  }
  if (!adapter || typeof adapter.capturePng !== "function") {
    throw createDiagramError({
      code: "invalid-tool-input",
      message: "Workspace PNG adapter is unavailable.",
      fieldPath: "workspace.export",
      recoverable: true,
      suggestedAction: "Choose a PNG-capable Renderer and retry.",
    });
  }
  return capturePngWithAdapter(plan.document, {
    capturePng: (request) => adapter.capturePng({ request, composition: clone(plan.composition) }),
  }, plan.request.options);
}

export { assertArtifact };
