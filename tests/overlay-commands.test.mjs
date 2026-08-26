import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCoreState } from "../core/diagram-core.mjs";
import {
  applyOverlayCommand,
  beginRouteEdit,
  commitRouteEdit,
  createAnnotationEditCommand,
  updateRouteEdit,
} from "../workspace/overlay-commands.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function readFixture() {
  return JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
}

async function coreFixture() {
  return createCoreState(await readFixture());
}

function baseRevision(core) {
  return core.revision ?? "draft-revision";
}

test("route control points preview in Diagram space and commit once", async () => {
  const core = await coreFixture();
  const original = core.artifact.layout.generated.routes["edge-split"].points;
  const preview = beginRouteEdit({ baseRevision: baseRevision(core), gestureId: "route-drag", edgeId: "edge-split" });
  const frame = updateRouteEdit(preview, [
    { x: 120, y: 78 },
    { x: 140, y: 78 },
    { x: 140, y: 96 },
  ]);
  assert.deepEqual(core.artifact.layout.generated.routes["edge-split"].points, original);
  const { command } = commitRouteEdit(frame);
  const next = applyOverlayCommand(core, command);
  assert.deepEqual(next.artifact.layout.overrides.routes["edge-split"].points, [
    { x: 120, y: 78 },
    { x: 140, y: 78 },
    { x: 140, y: 96 },
  ]);
  assert.deepEqual(core.artifact.layout.overrides.routes["edge-split"], undefined);
  assert.throws(
    () => updateRouteEdit(
      beginRouteEdit({ baseRevision: baseRevision(core), gestureId: "route-diagonal", edgeId: "edge-split" }),
      [{ x: 120, y: 78 }, { x: 140, y: 96 }],
    ),
    /only one world axis \(X or Z\).*diagonal segment/,
  );
});

test("annotation text and anchor edits preserve other annotations and node overrides", async () => {
  const artifact = await readFixture();
  artifact.layout.overrides.nodes["stage-line"] = { x: 140 };
  const core = createCoreState(artifact);
  const command = createAnnotationEditCommand({
    baseRevision: baseRevision(core),
    gestureId: "annotation-edit",
    annotationId: "annotation-thesis",
    patch: {
      text: "Updated thesis",
      anchor: { kind: "node", targetId: "stage-line", offset: { x: 4, y: 6 } },
    },
  });
  const next = applyOverlayCommand(core, command);
  const annotation = next.artifact.annotations.find((candidate) => candidate.id === "annotation-thesis");
  assert.equal(annotation.text, "Updated thesis");
  assert.deepEqual(annotation.anchor, { kind: "node", targetId: "stage-line", offset: { x: 4, y: 6 } });
  assert.deepEqual(next.artifact.layout.overrides.nodes["stage-line"], { x: 140 });
  assert.equal(core.artifact.annotations.find((candidate) => candidate.id === "annotation-thesis").text, "From conversation to a compounding workspace");
});

test("invalid route and annotation references fail before writing", async () => {
  const core = await coreFixture();
  const missingRoute = commitRouteEdit(updateRouteEdit(beginRouteEdit({ baseRevision: baseRevision(core), gestureId: "missing-route", edgeId: "missing-edge" }), [{ x: 1, y: 2 }, { x: 3, y: 2 }]));
  assert.throws(() => applyOverlayCommand(core, missingRoute.command), /target does not resolve/);
  assert.throws(() => updateRouteEdit(beginRouteEdit({ baseRevision: baseRevision(core), gestureId: "bad-points", edgeId: "edge-split" }), [{ x: 1 }, { x: 3, y: 2 }]), /finite Diagram coordinates/);
  const badAnchor = createAnnotationEditCommand({
    baseRevision: baseRevision(core),
    gestureId: "bad-anchor",
    annotationId: "annotation-thesis",
    patch: { anchor: { kind: "node", targetId: "missing-node", offset: { x: 0, y: 0 } } },
  });
  assert.throws(() => applyOverlayCommand(core, badAnchor), /does not resolve/);
  assert.equal(core.artifact.annotations.find((candidate) => candidate.id === "annotation-thesis").text, "From conversation to a compounding workspace");
});

test("stale overlay commands are rejected and overlays use the same Diagram revision", async () => {
  const core = await coreFixture();
  const route = commitRouteEdit(updateRouteEdit(beginRouteEdit({ baseRevision: baseRevision(core), gestureId: "stale-route", edgeId: "edge-split" }), [{ x: 1, y: 2 }, { x: 3, y: 2 }])).command;
  const annotation = createAnnotationEditCommand({ baseRevision: baseRevision(core), gestureId: "stale-annotation", annotationId: "annotation-thesis", patch: { text: "stale" } });
  const newer = { ...core, revision: "sha256:newer" };
  assert.throws(() => applyOverlayCommand(newer, route), /revision changed/);
  assert.throws(() => applyOverlayCommand(newer, annotation), /revision changed/);
});

test("unsupported annotation fields and empty patches are rejected", () => {
  assert.throws(() => createAnnotationEditCommand({ baseRevision: "draft", gestureId: "invalid-fields", annotationId: "annotation-thesis", patch: {} }), /at least one field/);
  assert.throws(() => createAnnotationEditCommand({ baseRevision: "draft", gestureId: "invalid-fields", annotationId: "annotation-thesis", patch: { screenX: 20 } }), /unsupported/);
});
