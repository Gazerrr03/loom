import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  commitInspectorTransform,
  parseInspectorTransformValue,
  previewInspectorTransform,
} from "../workspace/transform-inspector.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readFixture() {
  return JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
}

test("Inspector transforms create one field-level command and preserve other overrides", async () => {
  const artifact = await readFixture();
  artifact.layout.overrides.nodes["stage-line"] = { rotationYDeg: 12 };
  const result = commitInspectorTransform(artifact, {
    baseRevision: "sha256:golden-case",
    gestureId: "inspector-scale-1",
    nodeId: "stage-line",
    operation: "scale",
    value: "1.25",
  });

  assert.equal(result.command.type, "layout.node.scale");
  assert.equal(result.command.scale, 1.25);
  assert.deepEqual(result.artifact.layout.overrides.nodes["stage-line"], { rotationYDeg: 12, scale: 1.25 });
  assert.deepEqual(artifact.layout.overrides.nodes["stage-line"], { rotationYDeg: 12 });
});

test("Inspector preview does not mutate the canonical Artifact and commits one final frame", async () => {
  const artifact = await readFixture();
  const preview = previewInspectorTransform(artifact, {
    baseRevision: "sha256:golden-case",
    gestureId: "inspector-elevation-1",
    nodeId: "stage-line",
    operation: "elevation",
    value: "18",
  });

  assert.equal(preview.command.type, "layout.node.elevation");
  assert.equal(preview.artifact.layout.overrides.nodes["stage-line"].elevation, 18);
  assert.equal(artifact.layout.overrides.nodes["stage-line"]?.elevation, undefined);
});

test("Inspector values reject empty, non-finite, non-positive scale, and fractional z-index", () => {
  assert.equal(parseInspectorTransformValue("rotateY", "-24"), -24);
  assert.throws(() => parseInspectorTransformValue("scale", "0"), /greater than zero/);
  assert.throws(() => parseInspectorTransformValue("elevation", "not-a-number"), /finite number/);
  assert.throws(() => parseInspectorTransformValue("zIndex", "1.5"), /integer/);
  assert.throws(() => parseInspectorTransformValue("scale", ""), /must be a number/);
});

test("Inspector transform module is browser-safe", async () => {
  const source = await readFile(join(repoRoot, "workspace/transform-inspector.mjs"), "utf8");
  assert.doesNotMatch(source, /from\s+["']node:/);
  assert.doesNotMatch(source, /workspace\/transform-commands\.mjs/);
});
