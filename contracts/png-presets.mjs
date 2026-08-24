import { assertComposition } from "./composition.mjs";

const PRESET_FORMAT = "loom.png.export-preset";
const SCHEMA_VERSION = "0.1.0";
const A4_SPREAD_MM = { width: 594, height: 210 };
const A4_PAGE_MM = { width: 297, height: 210 };
const DEFAULT_DPI = 300;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertStableId(value, path) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]*$/.test(value)) throw new Error(`${path} must be a stable identifier`);
}

function assertPositiveNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${path} must be a positive number`);
}

function assertPositiveInteger(value, path) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${path} must be a positive integer`);
}

function pixelsForMillimeters(mm, dpi) {
  return Math.round((mm / 25.4) * dpi);
}

function assertRect(rect, path, expected) {
  if (!isRecord(rect)) throw new Error(`${path} must be an object`);
  for (const field of ["x", "y", "width", "height"]) {
    if (typeof rect[field] !== "number" || !Number.isFinite(rect[field])) throw new Error(`${path}.${field} must be finite`);
  }
  if (expected && ["width", "height"].some((field) => rect[field] !== expected[field])) throw new Error(`${path} must be ${expected.width} × ${expected.height} mm`);
}

function assertCanvas(canvas) {
  if (!isRecord(canvas)) throw new Error("composition.canvas must be an object");
  for (const field of ["width", "height"]) {
    if (typeof canvas[field] !== "number" || !Number.isFinite(canvas[field])) throw new Error(`composition.canvas.${field} must be finite`);
  }
  if (canvas.width !== A4_SPREAD_MM.width || canvas.height !== A4_SPREAD_MM.height) throw new Error("composition.canvas must be 594 × 210 mm");
}

function assertA4Composition(composition) {
  assertComposition(composition);
  if (composition.unit !== "mm") throw new Error("PNG A4 preset requires composition.unit mm");
  assertCanvas(composition.canvas);
  if (!Array.isArray(composition.pages) || composition.pages.length !== 2) throw new Error("PNG A4 preset requires two pages");
  const pages = [...composition.pages].sort((left, right) => left.bounds.x - right.bounds.x);
  pages.forEach((page, index) => {
    assertRect(page.bounds, `composition.pages[${index}].bounds`, A4_PAGE_MM);
    if (page.bounds.x !== index * A4_PAGE_MM.width || page.bounds.y !== 0) throw new Error("PNG A4 pages must form a 594 × 210 mm spread");
  });
  const gutter = composition.safeAreas.find((area) => area.kind === "gutter");
  if (!gutter || JSON.stringify(gutter.bounds) !== JSON.stringify({ x: 291, y: 0, width: 12, height: 210 })) {
    throw new Error("PNG A4 preset requires the 12 mm shared gutter at x=291 mm");
  }
  return composition;
}

function normalizedRange({ range = "spread", pageId } = {}, composition) {
  if (range === "spread") return { range: "spread" };
  if (range !== "page") throw new Error(`PNG preset range is unsupported: ${String(range)}`);
  assertStableId(pageId, "PNG preset pageId");
  const page = composition.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error(`PNG preset page does not resolve: ${pageId}`);
  return { range: "page", pageId };
}

/** Create a deterministic 300-DPI A4 spread/page preset from Composition. */
export function createPngExportPreset(composition, {
  presetId = "spread-a4-300dpi",
  range = "spread",
  pageId,
  dpi = DEFAULT_DPI,
  pixelRatio = 1,
  transparentBackground = false,
  backgroundToken = composition?.canvas?.backgroundToken ?? "canvas.paper",
  includeSafeAreaGuides = false,
} = {}) {
  const validatedComposition = assertA4Composition(composition);
  assertStableId(presetId, "PNG preset.presetId");
  assertPositiveNumber(dpi, "PNG preset.dpi");
  assertPositiveNumber(pixelRatio, "PNG preset.pixelRatio");
  if (typeof transparentBackground !== "boolean") throw new Error("PNG preset.transparentBackground must be boolean");
  if (typeof includeSafeAreaGuides !== "boolean") throw new Error("PNG preset.includeSafeAreaGuides must be boolean");
  if (typeof backgroundToken !== "string" || backgroundToken.length === 0) throw new Error("PNG preset.backgroundToken must be non-empty");
  const selection = normalizedRange({ range, pageId }, validatedComposition);
  const physical = selection.range === "spread" ? A4_SPREAD_MM : A4_PAGE_MM;
  return {
    format: PRESET_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    presetId,
    unit: "mm",
    range: selection.range,
    ...(selection.pageId ? { pageId: selection.pageId } : {}),
    widthMm: physical.width,
    heightMm: physical.height,
    dpi,
    widthPx: pixelsForMillimeters(physical.width, dpi),
    heightPx: pixelsForMillimeters(physical.height, dpi),
    pixelRatio,
    transparentBackground,
    backgroundToken,
    includeSafeAreaGuides,
    gutterSafeAreaId: validatedComposition.safeAreas.find((area) => area.kind === "gutter").id,
  };
}

export function assertPngExportPreset(preset) {
  if (!isRecord(preset)) throw new TypeError("PNG export preset must be an object");
  if (preset.format !== PRESET_FORMAT) throw new Error(`Unsupported PNG preset format: ${String(preset.format)}`);
  if (preset.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported PNG preset schemaVersion: ${String(preset.schemaVersion)}`);
  assertStableId(preset.presetId, "PNG preset.presetId");
  if (preset.unit !== "mm") throw new Error("PNG preset.unit must be mm");
  if (!["spread", "page"].includes(preset.range)) throw new Error("PNG preset.range is unsupported");
  if (preset.range === "page") assertStableId(preset.pageId, "PNG preset.pageId");
  assertPositiveNumber(preset.widthMm, "PNG preset.widthMm");
  assertPositiveNumber(preset.heightMm, "PNG preset.heightMm");
  assertPositiveNumber(preset.dpi, "PNG preset.dpi");
  assertPositiveInteger(preset.widthPx, "PNG preset.widthPx");
  assertPositiveInteger(preset.heightPx, "PNG preset.heightPx");
  if (preset.widthPx !== pixelsForMillimeters(preset.widthMm, preset.dpi) || preset.heightPx !== pixelsForMillimeters(preset.heightMm, preset.dpi)) {
    throw new Error("PNG preset pixel dimensions do not match widthMm, heightMm and dpi");
  }
  assertPositiveNumber(preset.pixelRatio, "PNG preset.pixelRatio");
  if (typeof preset.transparentBackground !== "boolean") throw new Error("PNG preset.transparentBackground must be boolean");
  if (typeof preset.backgroundToken !== "string" || preset.backgroundToken.length === 0) throw new Error("PNG preset.backgroundToken must be non-empty");
  if (typeof preset.includeSafeAreaGuides !== "boolean") throw new Error("PNG preset.includeSafeAreaGuides must be boolean");
  assertStableId(preset.gutterSafeAreaId, "PNG preset.gutterSafeAreaId");
  return preset;
}

/** Convert a preset into the #48 capture options without changing the source artifact. */
export function captureOptionsFromPreset(preset) {
  assertPngExportPreset(preset);
  return {
    widthPx: preset.widthPx,
    heightPx: preset.heightPx,
    pixelRatio: preset.pixelRatio,
    transparentBackground: preset.transparentBackground,
    includeSafeAreaGuides: preset.includeSafeAreaGuides,
    range: preset.range,
    ...(preset.pageId ? { pageId: preset.pageId } : {}),
    includeEditorChrome: false,
  };
}

export { A4_PAGE_MM, A4_SPREAD_MM, DEFAULT_DPI, PRESET_FORMAT, SCHEMA_VERSION };
