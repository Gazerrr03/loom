import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  applyAnnotationCommand,
  createAnnotationEditCommand,
  createAnnotationEditor,
} from "../workspace/annotation-editor.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readFixture() {
  return JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
}

test("annotation preview supports canvas, node, and edge anchors without mutating canonical Artifact", async () => {
  const artifact = await readFixture();
  const before = structuredClone(artifact);
  const editor = createAnnotationEditor({ artifact, revision: "sha256:golden-case-v1" });
  editor.begin({ annotationId: "annotation-thesis" });
  editor.preview({ patch: { text: "Updated thesis", anchor: { kind: "canvas", position: { x: 44, y: 38 } } } });
  assert.deepEqual(editor.getArtifact(), before);
  assert.equal(editor.getState().previewing, true);
  assert.deepEqual(editor.getDisplayArtifact().annotations[0].anchor, { kind: "canvas", position: { x: 44, y: 38 } });
  editor.cancel();
  assert.deepEqual(editor.getArtifact(), before);
});

test("annotation commit writes one update and preserves other annotations and layout overrides", async () => {
  const artifact = await readFixture();
  artifact.layout.overrides.nodes["stage-line"] = { x: 140 };
  const editor = createAnnotationEditor({ artifact, revision: "sha256:golden-case-v1" });
  editor.begin({ annotationId: "annotation-gutter" });
  const result = editor.commit({ patch: { text: "A clearer route note", anchor: { kind: "edge", targetId: "edge-connect", offset: { x: 4, y: -6 } } } });
  assert.equal(result.command.type, "annotation.update");
  assert.equal(result.command.targetId, "annotation-gutter");
  assert.equal(result.command.gestureId, "workspace-annotation-1");
  assert.equal(result.artifact.annotations.find((annotation) => annotation.id === "annotation-gutter").text, "A clearer route note");
  assert.equal(result.artifact.annotations.find((annotation) => annotation.id === "annotation-field").text, "Connections make relationships inspectable");
  assert.deepEqual(result.artifact.layout.overrides.nodes["stage-line"], { x: 140 });
  assert.equal(editor.getState().commitCount, 1);
});

test("invalid target, empty text, and invalid anchor are rejected before writing", async () => {
  const artifact = await readFixture();
  const editor = createAnnotationEditor({ artifact });
  assert.equal(editor.begin({ annotationId: "missing-annotation" }).reason, "annotation-not-found");
  editor.begin({ annotationId: "annotation-thesis" });
  assert.throws(() => editor.preview({ patch: { text: "   " } }), /must not be empty/);
  assert.throws(() => editor.preview({ patch: { anchor: { kind: "node", targetId: "missing-node", offset: { x: 0, y: 0 } } } }), /does not resolve/);
  editor.cancel();
  const command = createAnnotationEditCommand({ baseRevision: "draft", gestureId: "invalid-anchor", annotationId: "annotation-thesis", patch: { anchor: { kind: "canvas", position: { x: 900, y: 400 } } } });
  assert.throws(() => applyAnnotationCommand(artifact, command), /outside the Diagram canvas/);
  assert.equal(artifact.annotations[0].text, "From conversation to a compounding workspace");
});
