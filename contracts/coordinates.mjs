/**
 * Explicit Diagram -> Page -> View -> Screen coordinate conversions.
 * Diagram coordinates are canonical and use the composition unit; all other
 * layers are derived for a particular viewport and are never persisted.
 */

function assertRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
}

function assertNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
}

function assertPoint(point, path) {
  assertRecord(point, path);
  for (const field of ["x", "y"]) assertNumber(point[field], `${path}.${field}`);
  if (point.elevation !== undefined) assertNumber(point.elevation, `${path}.elevation`);
}

function assertCanvas(canvas) {
  assertRecord(canvas, "canvas");
  assertNumber(canvas.width, "canvas.width");
  assertNumber(canvas.height, "canvas.height");
  if (canvas.width <= 0 || canvas.height <= 0) throw new Error("canvas dimensions must be positive");
}

export function assertDiagramPoint(point, canvas, path = "diagramPoint") {
  assertPoint(point, path);
  assertCanvas(canvas);
  if (point.x < 0 || point.x > canvas.width || point.y < 0 || point.y > canvas.height) {
    throw new Error(`${path} is outside the Diagram canvas`);
  }
  return point;
}

export function diagramToPage(point, page, canvas) {
  assertDiagramPoint(point, canvas);
  assertRecord(page, "page");
  assertRecord(page.bounds, "page.bounds");
  if (point.x < page.bounds.x || point.x > page.bounds.x + page.bounds.width || point.y < page.bounds.y || point.y > page.bounds.y + page.bounds.height) {
    throw new Error("diagramPoint is outside page bounds");
  }
  return { x: point.x - page.bounds.x, y: point.y - page.bounds.y, ...(point.elevation === undefined ? {} : { elevation: point.elevation }) };
}

export function pageToDiagram(point, page, canvas) {
  assertPoint(point, "pagePoint");
  assertRecord(page, "page");
  return assertDiagramPoint({ x: point.x + page.bounds.x, y: point.y + page.bounds.y, ...(point.elevation === undefined ? {} : { elevation: point.elevation }) }, canvas);
}

function viewOptions(options) {
  assertRecord(options, "viewOptions");
  assertCanvas(options.canvas);
  assertNumber(options.zoom, "viewOptions.zoom");
  if (options.zoom <= 0) throw new Error("viewOptions.zoom must be positive");
  return options;
}

export function diagramToView(point, options) {
  const { canvas, zoom } = viewOptions(options);
  assertDiagramPoint(point, canvas);
  return { x: (point.x - canvas.width / 2) * zoom, y: (point.y - canvas.height / 2) * zoom, ...(point.elevation === undefined ? {} : { elevation: point.elevation * zoom }) };
}

export function viewToDiagram(point, options) {
  const { canvas, zoom } = viewOptions(options);
  assertPoint(point, "viewPoint");
  return assertDiagramPoint({ x: point.x / zoom + canvas.width / 2, y: point.y / zoom + canvas.height / 2, ...(point.elevation === undefined ? {} : { elevation: point.elevation / zoom }) }, canvas);
}

function screenOptions(options) {
  assertRecord(options, "screenOptions");
  for (const field of ["originX", "originY", "pixelsPerUnit", "pixelRatio"]) assertNumber(options[field], `screenOptions.${field}`);
  if (options.pixelsPerUnit <= 0 || options.pixelRatio <= 0) throw new Error("screen scale values must be positive");
  return options;
}

export function viewToScreen(point, options) {
  const { originX, originY, pixelsPerUnit, pixelRatio } = screenOptions(options);
  assertPoint(point, "viewPoint");
  return { xPx: originX + point.x * pixelsPerUnit * pixelRatio, yPx: originY + point.y * pixelsPerUnit * pixelRatio, ...(point.elevation === undefined ? {} : { elevationPx: point.elevation * pixelsPerUnit * pixelRatio }) };
}

export function screenToView(point, options) {
  const { originX, originY, pixelsPerUnit, pixelRatio } = screenOptions(options);
  assertRecord(point, "screenPoint");
  assertNumber(point.xPx, "screenPoint.xPx");
  assertNumber(point.yPx, "screenPoint.yPx");
  return { x: (point.xPx - originX) / (pixelsPerUnit * pixelRatio), y: (point.yPx - originY) / (pixelsPerUnit * pixelRatio), ...(point.elevationPx === undefined ? {} : { elevation: point.elevationPx / (pixelsPerUnit * pixelRatio) }) };
}
