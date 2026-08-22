/**
 * Cross-field checks for the shared Diagram composition space.
 *
 * JSON Schema describes the shape of each rectangle, but the canvas/page
 * relationship and the special meaning of a gutter need a small executable
 * contract. All coordinates remain in the declared composition.unit.
 */

const UNITS = new Set(["mm", "px"]);
const READING_DIRECTIONS = new Set([
  "left-to-right",
  "lower-left-to-upper-right",
  "top-to-bottom",
  "freeform",
]);
const PROJECTIONS = new Set(["orthographic", "perspective"]);
const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;

function assertStableId(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error(`${path} must be a lowercase stable identifier`);
  }
}

function assertFiniteNumber(value, path, { positive = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || (positive && value <= 0)) {
    throw new Error(`${path} must be a finite ${positive ? "positive " : ""}number`);
  }
}

function assertRect(rect, path, { positiveSize = false } = {}) {
  if (rect === null || typeof rect !== "object" || Array.isArray(rect)) {
    throw new Error(`${path} must be an object`);
  }
  for (const field of ["x", "y", "width", "height"]) {
    assertFiniteNumber(rect[field], `${path}.${field}`);
  }
  if (rect.width < 0 || rect.height < 0 || (positiveSize && (rect.width === 0 || rect.height === 0))) {
    throw new Error(`${path} must have non-negative${positiveSize ? " positive" : ""} size`);
  }
}

function rectContains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function rectsOverlap(a, b) {
  return (
    Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
    Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)
  );
}

function sharedPageBoundaries(pages) {
  const boundaries = [];
  for (let leftIndex = 0; leftIndex < pages.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < pages.length; rightIndex += 1) {
      const left = pages[leftIndex].bounds;
      const right = pages[rightIndex].bounds;
      if (left.x + left.width === right.x || right.x + right.width === left.x) {
        const x = left.x + left.width === right.x ? right.x : left.x;
        const yStart = Math.max(left.y, right.y);
        const yEnd = Math.min(left.y + left.height, right.y + right.height);
        if (yEnd > yStart) boundaries.push({ axis: "x", value: x, start: yStart, end: yEnd });
      }
      if (left.y + left.height === right.y || right.y + right.height === left.y) {
        const y = left.y + left.height === right.y ? right.y : left.y;
        const xStart = Math.max(left.x, right.x);
        const xEnd = Math.min(left.x + left.width, right.x + right.width);
        if (xEnd > xStart) boundaries.push({ axis: "y", value: y, start: xStart, end: xEnd });
      }
    }
  }
  return boundaries;
}

function gutterStraddlesBoundary(gutter, boundaries) {
  return boundaries.some((boundary) => {
    if (boundary.axis === "x") {
      return (
        gutter.x < boundary.value &&
        gutter.x + gutter.width > boundary.value &&
        gutter.y < boundary.end &&
        gutter.y + gutter.height > boundary.start
      );
    }
    return (
      gutter.y < boundary.value &&
      gutter.y + gutter.height > boundary.value &&
      gutter.x < boundary.end &&
      gutter.x + gutter.width > boundary.start
    );
  });
}

export function assertComposition(composition) {
  if (composition === null || typeof composition !== "object" || Array.isArray(composition)) {
    throw new TypeError("composition must be an object");
  }
  if (!UNITS.has(composition.unit)) {
    throw new Error(`Unsupported composition.unit: ${String(composition.unit)}`);
  }
  if (!READING_DIRECTIONS.has(composition.readingDirection)) {
    throw new Error(`Unsupported composition.readingDirection: ${String(composition.readingDirection)}`);
  }

  if (
    composition.canvas === null ||
    typeof composition.canvas !== "object" ||
    Array.isArray(composition.canvas)
  ) {
    throw new Error("composition.canvas must be an object");
  }
  for (const field of ["width", "height"]) {
    assertFiniteNumber(composition.canvas[field], `composition.canvas.${field}`, { positive: true });
  }
  const canvasRect = { x: 0, y: 0, ...composition.canvas };
  const ids = new Set();
  if (!Array.isArray(composition.pages) || composition.pages.length === 0) {
    throw new Error("composition.pages must contain at least one page");
  }
  for (const [index, page] of composition.pages.entries()) {
    assertStableId(page.id, `composition.pages[${index}].id`);
    if (ids.has(page.id)) throw new Error(`Duplicate composition ID: ${page.id}`);
    ids.add(page.id);
    assertRect(page.bounds, `composition.pages[${index}].bounds`, { positiveSize: true });
    if (!rectContains(canvasRect, page.bounds)) {
      throw new Error(`Page bounds exceed canvas: ${page.id}`);
    }
  }
  for (let leftIndex = 0; leftIndex < composition.pages.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < composition.pages.length; rightIndex += 1) {
      if (rectsOverlap(composition.pages[leftIndex].bounds, composition.pages[rightIndex].bounds)) {
        throw new Error(
          `Page bounds overlap: ${composition.pages[leftIndex].id} and ${composition.pages[rightIndex].id}`,
        );
      }
    }
  }

  if (!Array.isArray(composition.safeAreas)) {
    throw new Error("composition.safeAreas must be an array");
  }
  for (const [index, safeArea] of composition.safeAreas.entries()) {
    assertStableId(safeArea.id, `composition.safeAreas[${index}].id`);
    if (ids.has(safeArea.id)) throw new Error(`Duplicate composition ID: ${safeArea.id}`);
    ids.add(safeArea.id);
    assertRect(safeArea.bounds, `composition.safeAreas[${index}].bounds`, { positiveSize: true });
    if (!rectContains(canvasRect, safeArea.bounds)) {
      throw new Error(`Safe area bounds exceed canvas: ${safeArea.id}`);
    }
  }
  const boundaries = sharedPageBoundaries(composition.pages);
  for (const safeArea of composition.safeAreas.filter((candidate) => candidate.kind === "gutter")) {
    if (!gutterStraddlesBoundary(safeArea.bounds, boundaries)) {
      throw new Error(`Gutter must straddle a shared page boundary: ${safeArea.id}`);
    }
  }

  const view = composition.defaultView;
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    throw new Error("composition.defaultView must be an object");
  }
  if (!PROJECTIONS.has(view.projection)) {
    throw new Error(`Unsupported defaultView.projection: ${String(view.projection)}`);
  }
  if (typeof view.preset !== "string" || view.preset.length === 0) {
    throw new Error("composition.defaultView.preset must be a non-empty string");
  }
  for (const field of ["azimuthDeg", "elevationDeg"]) {
    assertFiniteNumber(view[field], `composition.defaultView.${field}`);
  }
  assertFiniteNumber(view.zoom, "composition.defaultView.zoom", { positive: true });

  return composition;
}
