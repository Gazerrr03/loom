import { createDiagramError } from "./diagram-error.mjs";
import { assertCamera } from "./camera.mjs";
import { assertRenderDocument } from "./render-document.mjs";

const CAPTURE_FORMAT = "loom.png.capture-request";
const RECEIPT_FORMAT = "loom.png.export-receipt";
const SCHEMA_VERSION = "0.1.0";
const RANGES = new Set(["spread", "page"]);
const LAYERS = ["scene", "routes", "phaseZones", "annotations"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertPositiveInteger(value, path) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${path} must be a positive integer`);
}

function assertPositiveNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${path} must be a positive number`);
}

function assertStableId(value, path) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]*$/.test(value)) throw new Error(`${path} must be a stable identifier`);
}

function assertOptions(options) {
  if (!isRecord(options)) throw new TypeError("PNG capture options must be an object");
  assertPositiveInteger(options.widthPx, "PNG capture options.widthPx");
  assertPositiveInteger(options.heightPx, "PNG capture options.heightPx");
  assertPositiveNumber(options.pixelRatio, "PNG capture options.pixelRatio");
  if (typeof options.transparentBackground !== "boolean") throw new Error("PNG capture options.transparentBackground must be boolean");
  if (typeof options.includeSafeAreaGuides !== "boolean") throw new Error("PNG capture options.includeSafeAreaGuides must be boolean");
  if (options.range !== undefined && !RANGES.has(options.range)) throw new Error(`PNG capture options.range is unsupported: ${String(options.range)}`);
  if ((options.range ?? "spread") === "page") assertStableId(options.pageId, "PNG capture options.pageId");
  if (options.includeEditorChrome !== undefined && options.includeEditorChrome !== false) {
    throw new Error("PNG capture never includes editor chrome");
  }
}

function normalizeOptions(options) {
  assertOptions(options);
  return {
    widthPx: options.widthPx,
    heightPx: options.heightPx,
    pixelRatio: options.pixelRatio,
    transparentBackground: options.transparentBackground,
    includeSafeAreaGuides: options.includeSafeAreaGuides,
    range: options.range ?? "spread",
    ...(options.pageId ? { pageId: options.pageId } : {}),
    includeEditorChrome: false,
  };
}

function assertLayerList(layers, path) {
  if (!Array.isArray(layers) || JSON.stringify(layers) !== JSON.stringify(LAYERS)) {
    throw new Error(`${path} must contain scene, routes, phaseZones and annotations in order`);
  }
}

/**
 * Build the renderer-independent input for one PNG capture. The camera is
 * separate from Effective Layout so a browser session cannot silently become
 * the export source. Callers may provide an explicit canonical camera when a
 * future export-setting editor has one; otherwise RenderDocument.exportCamera
 * is authoritative. `view` remains compatibility/layout metadata and is not a
 * second camera authority.
 */
export function createPngCaptureRequest(document, options, { camera } = {}) {
  assertRenderDocument(document);
  const normalizedOptions = normalizeOptions(options);
  const exportCamera = camera === undefined ? document.exportCamera : camera;
  assertCamera(exportCamera, "PNG capture request.camera");
  if (normalizedOptions.range === "page" && !document.composition.pages.some((page) => page.id === normalizedOptions.pageId)) {
    throw new Error(`PNG capture page does not resolve: ${normalizedOptions.pageId}`);
  }
  return {
    format: CAPTURE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    artifactId: document.artifactId,
    revision: document.revision,
    camera: clone(exportCamera),
    view: clone(document.effectiveLayout.view),
    effectiveLayout: clone(document.effectiveLayout),
    layers: [...LAYERS],
    options: normalizedOptions,
  };
}

export function assertPngCaptureRequest(request) {
  if (!isRecord(request)) throw new TypeError("PNG capture request must be an object");
  if (request.format !== CAPTURE_FORMAT) throw new Error(`Unsupported PNG capture format: ${String(request.format)}`);
  if (request.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported PNG capture schemaVersion: ${String(request.schemaVersion)}`);
  assertStableId(request.artifactId, "PNG capture request.artifactId");
  if (typeof request.revision !== "string" || request.revision.length === 0) throw new Error("PNG capture request.revision must be non-empty");
  assertCamera(request.camera, "PNG capture request.camera");
  if (!isRecord(request.view) || !isRecord(request.effectiveLayout)) throw new Error("PNG capture request must include view and effectiveLayout");
  assertLayerList(request.layers, "PNG capture request.layers");
  assertOptions(request.options);
  return request;
}

function normalizeWarnings(warnings) {
  if (warnings === undefined) return [];
  if (!Array.isArray(warnings) || warnings.some((warning) => typeof warning !== "string" || warning.length === 0)) {
    throw new Error("PNG export warnings must be non-empty strings");
  }
  return [...warnings];
}

function safeMessage(value) {
  return String(value)
    .replace(/(?:\/Users|\/private|\/tmp|\/var|\/home)\/[^\s)]+/g, "[path]")
    .replace(/[A-Za-z]:[\\/][^\s)]+/g, "[path]");
}

/** Validate the result that a Renderer returns for a capture request. */
export function createPngExportReceipt(request, { widthPx, heightPx, warnings = [], outputRef = null, revision = request.revision } = {}) {
  assertPngCaptureRequest(request);
  if (revision !== request.revision) throw new Error("PNG export receipt revision does not match the capture request");
  assertPositiveInteger(widthPx, "PNG export receipt.widthPx");
  assertPositiveInteger(heightPx, "PNG export receipt.heightPx");
  const normalizedWarnings = normalizeWarnings(warnings);
  if (outputRef !== null && (typeof outputRef !== "string" || outputRef.length === 0)) throw new Error("PNG export receipt.outputRef must be a non-empty string or null");
  return {
    format: RECEIPT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    artifactId: request.artifactId,
    revision: request.revision,
    widthPx,
    heightPx,
    pixelRatio: request.options.pixelRatio,
    warnings: normalizedWarnings,
    outputRef,
  };
}

export function assertPngExportReceipt(receipt) {
  if (!isRecord(receipt)) throw new TypeError("PNG export receipt must be an object");
  if (receipt.format !== RECEIPT_FORMAT) throw new Error(`Unsupported PNG export receipt format: ${String(receipt.format)}`);
  if (receipt.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported PNG export receipt schemaVersion: ${String(receipt.schemaVersion)}`);
  assertStableId(receipt.artifactId, "PNG export receipt.artifactId");
  if (typeof receipt.revision !== "string" || receipt.revision.length === 0) throw new Error("PNG export receipt.revision must be non-empty");
  assertPositiveInteger(receipt.widthPx, "PNG export receipt.widthPx");
  assertPositiveInteger(receipt.heightPx, "PNG export receipt.heightPx");
  assertPositiveNumber(receipt.pixelRatio, "PNG export receipt.pixelRatio");
  normalizeWarnings(receipt.warnings);
  if (receipt.outputRef !== null && (typeof receipt.outputRef !== "string" || receipt.outputRef.length === 0)) throw new Error("PNG export receipt.outputRef must be a non-empty string or null");
  return receipt;
}

function exportFailure(document, error) {
  const message = safeMessage(error instanceof Error ? error.message : String(error));
  return createDiagramError({
    code: "export-failed",
    message: `PNG export failed: ${message}`,
    objectIds: typeof document?.artifactId === "string" && /^[a-z][a-z0-9._-]*$/.test(document.artifactId) ? [document.artifactId] : [],
    fieldPath: "capturePng",
    recoverable: true,
    suggestedAction: "Check the Renderer capabilities and export options, then retry.",
    cause: message,
  });
}

/** Invoke an Adapter without letting its private runtime state enter the request or receipt. */
export async function capturePngWithAdapter(document, adapter, options) {
  let request;
  try {
    request = createPngCaptureRequest(document, options);
    if (!adapter || typeof adapter.capturePng !== "function") throw new Error("Renderer Adapter does not implement capturePng");
    const rawReceipt = await adapter.capturePng(clone(request));
    const receipt = createPngExportReceipt(request, rawReceipt);
    if (receipt.revision !== request.revision) throw new Error("PNG export receipt revision does not match the capture request");
    return assertPngExportReceipt(receipt);
  } catch (error) {
    throw exportFailure(document, error);
  }
}

export { CAPTURE_FORMAT, LAYERS, RECEIPT_FORMAT, SCHEMA_VERSION };
