import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertPngExportPreset, captureOptionsFromPreset, createPngExportPreset } from "../contracts/png-presets.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readComposition() {
  const artifact = JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
  return { artifact, composition: artifact.composition };
}

test("default spread preset is deterministic and matches the double A4 canvas and gutter", async () => {
  const { composition } = await readComposition();
  const first = createPngExportPreset(composition);
  const second = createPngExportPreset(composition);
  assert.deepEqual(first, second);
  assertPngExportPreset(first);
  assert.equal(first.range, "spread");
  assert.equal(first.widthMm, 594);
  assert.equal(first.heightMm, 210);
  assert.equal(first.widthPx, 7016);
  assert.equal(first.heightPx, 2480);
  assert.equal(first.gutterSafeAreaId, "safe-gutter");
  assert.equal(first.backgroundToken, "canvas.paper");
});

test("page preset uses one A4 page and converts the selected DPI without changing Composition", async () => {
  const { artifact, composition } = await readComposition();
  const before = structuredClone(artifact);
  const preset = createPngExportPreset(composition, {
    presetId: "page-right-a4-150dpi",
    range: "page",
    pageId: "page-right",
    dpi: 150,
    pixelRatio: 2,
    transparentBackground: true,
    backgroundToken: "canvas.paper",
    includeSafeAreaGuides: true,
  });
  assert.equal(preset.widthMm, 297);
  assert.equal(preset.heightMm, 210);
  assert.equal(preset.widthPx, 1754);
  assert.equal(preset.heightPx, 1240);
  assert.equal(preset.pixelRatio, 2);
  assert.equal(preset.transparentBackground, true);
  assert.equal(preset.includeSafeAreaGuides, true);
  assert.deepEqual(artifact, before);

  const captureOptions = captureOptionsFromPreset(preset);
  assert.deepEqual(captureOptions, {
    widthPx: 1754,
    heightPx: 1240,
    pixelRatio: 2,
    transparentBackground: true,
    includeSafeAreaGuides: true,
    range: "page",
    pageId: "page-right",
    includeEditorChrome: false,
  });
});

test("invalid A4 geometry, page, dpi and background values fail before creating a preset", async () => {
  const { composition } = await readComposition();
  const wrongCanvas = structuredClone(composition);
  wrongCanvas.canvas.width = 600;
  assert.throws(() => createPngExportPreset(wrongCanvas), /594/);
  const wrongGutter = structuredClone(composition);
  wrongGutter.safeAreas.find((area) => area.kind === "gutter").bounds.width = 8;
  assert.throws(() => createPngExportPreset(wrongGutter), /12 mm shared gutter/);
  assert.throws(() => createPngExportPreset(composition, { range: "page", pageId: "missing" }), /page does not resolve/);
  assert.throws(() => createPngExportPreset(composition, { dpi: 0 }), /dpi/);
  assert.throws(() => createPngExportPreset(composition, { backgroundToken: "" }), /backgroundToken/);
});

test("preset validation rejects stale pixel dimensions and editor chrome cannot be requested", async () => {
  const { composition } = await readComposition();
  const preset = createPngExportPreset(composition);
  const wrongPixels = { ...preset, widthPx: preset.widthPx + 1 };
  assert.throws(() => assertPngExportPreset(wrongPixels), /pixel dimensions/);
  assert.equal(captureOptionsFromPreset(preset).includeEditorChrome, false);
  const malformed = { ...preset, pixelRatio: 0 };
  assert.throws(() => assertPngExportPreset(malformed), /pixelRatio/);
});
