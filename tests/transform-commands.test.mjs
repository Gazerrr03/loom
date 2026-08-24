import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCoreState } from "../core/diagram-core.mjs";
import {
  applyNodeTransform,
  beginNodeTransform,
  commitNodeTransform,
  createNodeTransformCommand,
  updateNodeTransform,
} from "../workspace/transform-commands.mjs";

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

test("all P0 node transforms map to one explicit Domain Command", async () => {
  const core = await coreFixture();
  const operations = [
    ["move", { x: 160, y: 92 }, "x"],
    ["rotateY", 18, "rotationYDeg"],
    ["scale", 1.25, "scale"],
    ["elevation", 12, "elevation"],
    ["zIndex", 3, "zIndex"],
  ];
  for (const [operation, value, field] of operations) {
    const result = createNodeTransformCommand({
      baseRevision: baseRevision(core),
      gestureId: `gesture-${operation.toLowerCase()}`,
      nodeId: "stage-line",
      operation,
      value,
    });
    assert.equal(result.command.type, operation === "rotateY" ? "layout.node.rotate-y" : `layout.node.${operation.replace("zIndex", "z-index")}`);
    assert.equal(result.command.targetId, "stage-line");
    assert.equal(result.command.gestureId, `gesture-${operation.toLowerCase()}`);
    assert.equal(result.command[field] !== undefined, true);
  }
});

test("drag preview is ephemeral and pointer-up commits one field-level Human Override", async () => {
  const core = await coreFixture();
  const preview = beginNodeTransform({
    baseRevision: baseRevision(core),
    gestureId: "gesture-drag",
    nodeId: "stage-line",
    operation: "move",
  });
  const frame1 = updateNodeTransform(preview, "move", { x: 140, y: 90 });
  const frame2 = updateNodeTransform(frame1, "move", { x: 160, y: 92 });
  assert.equal(preview.frameCount, 0);
  assert.equal(frame1.frameCount, 1);
  assert.equal(frame2.frameCount, 2);
  assert.equal(Object.hasOwn(core.artifact.layout.overrides.nodes["stage-line"] ?? {}, "x"), false);
  const { command } = commitNodeTransform(frame2);
  const next = applyNodeTransform(core, command);
  assert.equal(next.artifact.layout.overrides.nodes["stage-line"].x, 160);
  assert.equal(next.artifact.layout.overrides.nodes["stage-line"].y, 92);
  assert.equal(next.artifact.layout.overrides.nodes["stage-line"].rotationYDeg, undefined);
  assert.equal(core.artifact.layout.overrides.nodes["stage-line"], undefined);
});

test("Inspector scalar edits normalize to the same command contract", async () => {
  const core = await coreFixture();
  for (const [operation, value, field] of [["rotateY", 24, "rotationYDeg"], ["scale", 1.1, "scale"], ["elevation", 8, "elevation"], ["zIndex", 5, "zIndex"]]) {
    const command = createNodeTransformCommand({
      baseRevision: baseRevision(core),
      gestureId: `gesture-${operation.toLowerCase()}-inspector`,
      nodeId: "stage-line",
      operation,
      value,
    }).command;
    assert.equal(command[field], value);
    assert.equal(Object.keys(command).filter((key) => ["rotationYDeg", "scale", "elevation", "zIndex"].includes(key)).length, 1);
  }
});

test("invalid target, scale, and stale revision fail before a write", async () => {
  const core = await coreFixture();
  const missingTarget = createNodeTransformCommand({ baseRevision: baseRevision(core), gestureId: "bad-target", nodeId: "missing-node", operation: "move", value: { x: 1, y: 2 } }).command;
  assert.throws(() => applyNodeTransform(core, missingTarget), /target does not resolve/);
  assert.throws(() => createNodeTransformCommand({ baseRevision: baseRevision(core), gestureId: "bad-scale", nodeId: "stage-line", operation: "scale", value: -1 }), /greater than zero/);
  const command = createNodeTransformCommand({ baseRevision: baseRevision(core), gestureId: "stale", nodeId: "stage-line", operation: "move", value: { x: 1, y: 2 } }).command;
  assert.throws(() => applyNodeTransform({ ...core, revision: "sha256:newer" }, command), /revision changed/);
  assert.equal(core.artifact.layout.overrides.nodes["stage-line"], undefined);
});

test("a move command preserves unrelated existing overrides", async () => {
  const artifact = await readFixture();
  artifact.layout.overrides.nodes["stage-line"] = { rotationYDeg: 12 };
  const core = createCoreState(artifact);
  const command = createNodeTransformCommand({ baseRevision: baseRevision(core), gestureId: "preserve", nodeId: "stage-line", operation: "move", value: { x: 120, y: 88 } }).command;
  const next = applyNodeTransform(core, command);
  assert.deepEqual(next.artifact.layout.overrides.nodes["stage-line"], { rotationYDeg: 12, x: 120, y: 88 });
});
