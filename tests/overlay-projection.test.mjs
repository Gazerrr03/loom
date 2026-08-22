import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRenderDocument } from "../contracts/render-document.mjs";
import { assertOverlayProjection, projectOverlays } from "../contracts/overlay-projection.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

async function readDocument() {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const registry = await readJson("examples/flovvas-template-registry.json");
  const catalog = await readJson("examples/flovvas-template-catalog.json");
  const resolved = await Promise.all(registry.templates.map(({ path }) => readJson(path)));
  const resolvedIds = new Set(resolved.map((component) => component.id));
  return createRenderDocument(artifact, {
    revision: "sha256:golden-case-v1",
    components: [
      ...resolved,
      ...catalog.templates.filter((component) => !resolvedIds.has(component.id)),
    ],
  });
}

test("routes, phase zones and annotations share Diagram coordinates and view", async () => {
  const document = await readDocument();
  const overlays = projectOverlays(document);

  assertOverlayProjection(overlays);
  assert.equal(overlays.routes.length, document.semantic.edges.length);
  assert.equal(overlays.phaseZones.length, 4);
  assert.equal(overlays.annotations.length, document.annotations.length);
  assert.equal(overlays.view.preset, "isometric");
  assert.deepEqual(overlays.routes[0].points, document.effectiveLayout.routes["edge-split"].points);
  assert.equal(overlays.routes[0].includeInExport, true);
  assert.equal(overlays.annotations[0].includeEditorHandles, false);
});

test("visual roles create distinct route hierarchy without changing semantic data", async () => {
  const document = await readDocument();
  const before = structuredClone(document);
  const overlays = projectOverlays(document);
  const styles = new Map(overlays.routes.map((route) => [route.visualRole, route.style]));

  assert.equal(styles.get("main-flow").lineStyle, "solid");
  assert.equal(styles.get("alternative").lineStyle, "dashed");
  assert.equal(styles.get("external-input").lineStyle, "dotted");
  assert.equal(styles.get("compounding-loop").lineStyle, "loop");
  assert.deepEqual(document, before);
});

test("node and edge annotation positions follow Effective Layout", async () => {
  const document = await readDocument();
  const first = projectOverlays(document);
  const moved = structuredClone(document);
  moved.effectiveLayout.nodes["stage-field"].x += 20;
  moved.effectiveLayout.routes["edge-connect"].points[1].x += 20;
  const second = projectOverlays(moved);

  const firstNodeNote = first.annotations.find((annotation) => annotation.annotationId === "annotation-field");
  const secondNodeNote = second.annotations.find((annotation) => annotation.annotationId === "annotation-field");
  assert.equal(secondNodeNote.position.x - firstNodeNote.position.x, 20);
  const firstEdgeNote = first.annotations.find((annotation) => annotation.annotationId === "annotation-gutter");
  const secondEdgeNote = second.annotations.find((annotation) => annotation.annotationId === "annotation-gutter");
  assert.notDeepEqual(secondEdgeNote.position, firstEdgeNote.position);
});

test("invalid route geometry blocks overlay projection", async () => {
  const document = await readDocument();
  const incomplete = structuredClone(document);
  incomplete.effectiveLayout.routes["edge-connect"].points = [];

  assert.throws(() => projectOverlays(incomplete), /Route edge-connect must contain at least two Diagram points/);
});

