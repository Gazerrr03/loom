import { createHash } from "node:crypto";

import { assertPngCaptureRequest, assertPngExportReceipt } from "./png-capture.mjs";
import { assertPngComposition } from "./png-composition.mjs";
import { assertPngExportPreset, captureOptionsFromPreset } from "./png-presets.mjs";

const EVIDENCE_FORMAT = "loom.png.regression-evidence";
const SCHEMA_VERSION = "0.1.0";
const CHECK_NAMES = ["structure", "dimensions", "gutter", "textReadability", "seam"];
const CHECK_STATUSES = new Set(["pass", "pending", "fail"]);
const AUTHOR_CONCLUSIONS = new Set(["accept", "continue-refinement", "change-strategy"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertStableId(value, path) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]*$/.test(value)) throw new Error(`${path} must be a stable identifier`);
}

function assertCheck(check, path) {
  if (!isRecord(check)) throw new Error(`${path} must be an object`);
  if (!CHECK_STATUSES.has(check.status)) throw new Error(`${path}.status is unsupported`);
  if (check.evidence !== null && (typeof check.evidence !== "string" || check.evidence.length === 0)) throw new Error(`${path}.evidence must be non-empty or null`);
}

function structuralInput({ request, preset, composition }) {
  return {
    artifactId: request.artifactId,
    revision: request.revision,
    presetId: preset.presetId,
    range: preset.range,
    widthPx: request.options.widthPx,
    heightPx: request.options.heightPx,
    pixelRatio: request.options.pixelRatio,
    layers: {
      scene: composition.scene.map(({ nodeId, componentRef, bounds, elevation, rotationYDeg, scale, zIndex }) => ({ nodeId, componentRef, bounds, elevation, rotationYDeg, scale, zIndex })),
      routes: composition.routes.map(({ routeId, visualRole, points }) => ({ routeId, visualRole, points })),
      phaseZones: composition.phaseZones.map(({ zoneId, children, bounds }) => ({ zoneId, children, bounds })),
      annotations: composition.annotations.map(({ annotationId, text, visualRole, semanticAnchor, position }) => ({ annotationId, text, visualRole, semanticAnchor, position })),
    },
  };
}

function fingerprint(input) {
  return `sha256:${createHash("sha256").update(`${JSON.stringify(input)}\n`).digest("hex")}`;
}

function defaultChecks({ request, preset, composition }) {
  return {
    structure: { status: "pass", evidence: `Export composition contains ${composition.scene.length} scene nodes, ${composition.routes.length} routes, ${composition.phaseZones.length} phase zones and ${composition.annotations.length} annotations.` },
    dimensions: { status: "pass", evidence: `${preset.range} output requests ${request.options.widthPx} × ${request.options.heightPx} logical pixels at pixel ratio ${request.options.pixelRatio}.` },
    gutter: { status: "pending", evidence: null },
    textReadability: { status: "pending", evidence: null },
    seam: { status: "pending", evidence: null },
  };
}

/** Create a revision-bound, structure-first PNG regression record. */
export function createPngRegressionEvidence({ request, preset, composition, receipt, checks, authorConclusion = "continue-refinement", authorNote = null } = {}) {
  assertPngCaptureRequest(request);
  assertPngExportPreset(preset);
  assertPngComposition(composition);
  if (composition.artifactId !== request.artifactId || composition.revision !== request.revision) throw new Error("PNG regression composition identity must match request");
  assertPngExportReceipt(receipt);
  if (receipt.revision !== request.revision) throw new Error("PNG regression receipt revision must match request revision");
  if (receipt.artifactId !== request.artifactId || receipt.pixelRatio !== request.options.pixelRatio) throw new Error("PNG regression receipt identity or pixelRatio does not match request");
  const expectedOptions = captureOptionsFromPreset(preset);
  for (const field of ["widthPx", "heightPx", "range", "pageId"]) {
    if (request.options[field] !== expectedOptions[field]) throw new Error(`PNG regression request does not match preset ${field}`);
  }
  if (!AUTHOR_CONCLUSIONS.has(authorConclusion)) throw new Error(`PNG regression authorConclusion is unsupported: ${String(authorConclusion)}`);
  if (authorNote !== null && (typeof authorNote !== "string" || authorNote.length === 0)) throw new Error("PNG regression authorNote must be non-empty or null");
  const resolvedChecks = checks ?? defaultChecks({ request, preset, composition });
  for (const name of CHECK_NAMES) assertCheck(resolvedChecks[name], `PNG regression checks.${name}`);
  const structural = structuralInput({ request, preset, composition });
  return {
    format: EVIDENCE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    artifactId: request.artifactId,
    revision: request.revision,
    presetId: preset.presetId,
    requested: {
      range: request.options.range,
      ...(request.options.pageId ? { pageId: request.options.pageId } : {}),
      widthPx: request.options.widthPx,
      heightPx: request.options.heightPx,
      pixelRatio: request.options.pixelRatio,
    },
    receipt: {
      widthPx: receipt.widthPx,
      heightPx: receipt.heightPx,
      pixelRatio: receipt.pixelRatio,
      warnings: [...(receipt.warnings ?? [])],
      outputRef: receipt.outputRef ?? null,
    },
    layers: [...composition.layers],
    structuralFingerprint: fingerprint(structural),
    checks: resolvedChecks,
    pixelDiffBlocking: false,
    authorConclusion,
    authorNote,
  };
}

export function assertPngRegressionEvidence(evidence) {
  if (!isRecord(evidence)) throw new TypeError("PNG regression evidence must be an object");
  if (evidence.format !== EVIDENCE_FORMAT) throw new Error(`Unsupported PNG regression format: ${String(evidence.format)}`);
  if (evidence.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported PNG regression schemaVersion: ${String(evidence.schemaVersion)}`);
  assertStableId(evidence.artifactId, "PNG regression.artifactId");
  if (typeof evidence.revision !== "string" || evidence.revision.length === 0) throw new Error("PNG regression.revision must be non-empty");
  assertStableId(evidence.presetId, "PNG regression.presetId");
  if (!isRecord(evidence.requested) || !isRecord(evidence.receipt)) throw new Error("PNG regression requested and receipt are required");
  for (const field of ["widthPx", "heightPx"]) if (!Number.isInteger(evidence.requested[field]) || evidence.requested[field] <= 0) throw new Error(`PNG regression.requested.${field} must be positive`);
  if (typeof evidence.requested.pixelRatio !== "number" || evidence.requested.pixelRatio <= 0) throw new Error("PNG regression.requested.pixelRatio must be positive");
  for (const field of ["widthPx", "heightPx"]) if (!Number.isInteger(evidence.receipt[field]) || evidence.receipt[field] <= 0) throw new Error(`PNG regression.receipt.${field} must be positive`);
  if (typeof evidence.receipt.pixelRatio !== "number" || evidence.receipt.pixelRatio <= 0) throw new Error("PNG regression.receipt.pixelRatio must be positive");
  if (typeof evidence.receipt.outputRef !== "string" && evidence.receipt.outputRef !== null) throw new Error("PNG regression.receipt.outputRef must be a string or null");
  if (!Array.isArray(evidence.receipt.warnings) || evidence.receipt.warnings.some((warning) => typeof warning !== "string")) throw new Error("PNG regression.receipt.warnings must be strings");
  if (!Array.isArray(evidence.layers) || JSON.stringify(evidence.layers) !== JSON.stringify(["scene", "routes", "phaseZones", "annotations"])) throw new Error("PNG regression.layers is incomplete");
  if (typeof evidence.structuralFingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(evidence.structuralFingerprint)) throw new Error("PNG regression.structuralFingerprint is invalid");
  for (const name of CHECK_NAMES) assertCheck(evidence.checks?.[name], `PNG regression checks.${name}`);
  if (evidence.pixelDiffBlocking !== false) throw new Error("PNG regression pixelDiffBlocking must remain false");
  if (!AUTHOR_CONCLUSIONS.has(evidence.authorConclusion)) throw new Error("PNG regression authorConclusion is unsupported");
  if (evidence.authorNote !== null && typeof evidence.authorNote !== "string") throw new Error("PNG regression authorNote must be a string or null");
  return evidence;
}

/** Compare two records without turning pixel-level difference into a blocker. */
export function comparePngRegressionEvidence(previous, current) {
  assertPngRegressionEvidence(previous);
  assertPngRegressionEvidence(current);
  const differences = [];
  for (const field of ["artifactId", "revision", "presetId"]) {
    if (previous[field] !== current[field]) differences.push(field);
  }
  if (previous.requested.widthPx !== current.requested.widthPx || previous.requested.heightPx !== current.requested.heightPx) differences.push("requested.dimensions");
  if (previous.structuralFingerprint !== current.structuralFingerprint) differences.push("structuralFingerprint");
  return {
    status: differences.length === 0 ? "stable" : "changed",
    differences,
    pixelDiffBlocking: false,
  };
}

export { CHECK_NAMES, EVIDENCE_FORMAT, SCHEMA_VERSION };
