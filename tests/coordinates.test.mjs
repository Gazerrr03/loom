import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  diagramToPage,
  diagramToView,
  pageToDiagram,
  screenToView,
  viewToDiagram,
  viewToScreen,
} from "../contracts/coordinates.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function readComposition() {
  const artifact = JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
  return artifact.composition;
}

test("Diagram and Page coordinates round-trip without changing mm semantics", async () => {
  const composition = await readComposition();
  const point = { x: 525, y: 35, elevation: 10 };
  const page = composition.pages[1];
  const local = diagramToPage(point, page, composition.canvas);
  assert.deepEqual(local, { x: 228, y: 35, elevation: 10 });
  assert.deepEqual(pageToDiagram(local, page, composition.canvas), point);
});

test("View and Screen conversions are derived and round-trip", async () => {
  const composition = await readComposition();
  const diagramPoint = { x: 220, y: 118, elevation: 12 };
  const viewPoint = diagramToView(diagramPoint, { canvas: composition.canvas, zoom: 1.5 });
  assert.deepEqual(viewToDiagram(viewPoint, { canvas: composition.canvas, zoom: 1.5 }), diagramPoint);
  const screen = viewToScreen(viewPoint, { originX: 600, originY: 400, pixelsPerUnit: 2, pixelRatio: 2 });
  assert.deepEqual(screenToView(screen, { originX: 600, originY: 400, pixelsPerUnit: 2, pixelRatio: 2 }), viewPoint);
});

test("out-of-range Diagram points and invalid scale values are rejected", async () => {
  const composition = await readComposition();
  assert.throws(() => diagramToView({ x: -1, y: 20 }, { canvas: composition.canvas, zoom: 1 }), /outside the Diagram canvas/);
  assert.throws(() => diagramToView({ x: 10, y: 20 }, { canvas: composition.canvas, zoom: 0 }), /zoom must be positive/);
  assert.throws(() => screenToView({ xPx: 2, yPx: 3 }, { originX: 0, originY: 0, pixelsPerUnit: 0, pixelRatio: 1 }), /scale values must be positive/);
});
