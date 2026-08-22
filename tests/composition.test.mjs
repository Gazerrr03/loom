import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertComposition } from "../contracts/composition.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readComposition() {
  const artifact = await readJson(join(repoRoot, "examples/flovvas-massing.diagram.json"));
  return structuredClone(artifact.composition);
}

test("the Golden Case composition defines one shared physical coordinate space", async () => {
  const composition = await readComposition();
  assert.doesNotThrow(() => assertComposition(composition));
  assert.equal(composition.unit, "mm");
  assert.deepEqual(composition.canvas, {
    width: 594,
    height: 210,
    backgroundToken: "canvas.paper",
  });
  assert.equal(composition.pages.length, 2);
  assert.equal(composition.safeAreas.find((area) => area.kind === "gutter").id, "safe-gutter");
  assert.equal(composition.defaultView.projection, "orthographic");
});

test("invalid dimensions, page overlaps, and out-of-place gutters are rejected", async () => {
  const negativeCanvas = await readComposition();
  negativeCanvas.canvas.width = 0;
  assert.throws(() => assertComposition(negativeCanvas), /composition\.canvas\.width/);

  const outsidePage = await readComposition();
  outsidePage.pages[0].bounds.x = -1;
  assert.throws(() => assertComposition(outsidePage), /Page bounds exceed canvas/);

  const overlappingPages = await readComposition();
  overlappingPages.pages[1].bounds.x = 290;
  assert.throws(() => assertComposition(overlappingPages), /Page bounds overlap/);

  const misplacedGutter = await readComposition();
  misplacedGutter.safeAreas.find((area) => area.kind === "gutter").bounds.x = 100;
  assert.throws(() => assertComposition(misplacedGutter), /Gutter must straddle/);
});

test("default view and reading direction remain explicit and positive", async () => {
  const invalidView = await readComposition();
  invalidView.defaultView.zoom = 0;
  assert.throws(() => assertComposition(invalidView), /defaultView\.zoom/);

  const invalidDirection = await readComposition();
  invalidDirection.readingDirection = "by-color";
  assert.throws(() => assertComposition(invalidDirection), /readingDirection/);
});
