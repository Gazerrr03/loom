import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCoreState } from "../core/diagram-core.mjs";
import { beginNodeTransform, commitNodeTransform, updateNodeTransform } from "../workspace/transform-commands.mjs";
import { applyOverlayCommand, beginRouteEdit, commitRouteEdit, updateRouteEdit } from "../workspace/overlay-commands.mjs";
import {
  canRedo,
  canUndo,
  commitHistoryCommand,
  commitHistoryTransaction,
  createHistory,
  redoHistory,
  undoHistory,
} from "../workspace/history.mjs";

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

function moveCommand(core, transactionId, x) {
  const preview = beginNodeTransform({ baseRevision: baseRevision(core), gestureId: transactionId, nodeId: "stage-line", operation: "move" });
  return commitNodeTransform(updateNodeTransform(preview, "move", { x, y: 92 })).command;
}

test("preview frames do not create history entries; one pointer-up creates one undoable transaction", async () => {
  const core = await coreFixture();
  const history = createHistory(core);
  const preview = beginNodeTransform({ baseRevision: baseRevision(core), gestureId: "drag-history", nodeId: "stage-line", operation: "move" });
  const frame1 = updateNodeTransform(preview, "move", { x: 140, y: 90 });
  const frame2 = updateNodeTransform(frame1, "move", { x: 160, y: 92 });
  assert.equal(history.past.length, 0);
  const after = commitHistoryCommand(history, commitNodeTransform(frame2).command);
  assert.equal(after.past.length, 1);
  assert.equal(after.future.length, 0);
  assert.equal(after.lastEvent.transactionId, "drag-history");
  const undone = undoHistory(after);
  assert.equal(undone.present.artifact.layout.overrides.nodes["stage-line"], undefined);
  assert.equal(undone.future.length, 1);
  const redone = redoHistory(undone);
  assert.equal(redone.present.artifact.layout.overrides.nodes["stage-line"].x, 160);
});

test("route and Codex batch changes can each become one history transaction", async () => {
  const core = await coreFixture();
  const history = createHistory(core);
  const routePreview = beginRouteEdit({ baseRevision: baseRevision(core), gestureId: "route-history", edgeId: "edge-split" });
  const routeCommand = commitRouteEdit(updateRouteEdit(routePreview, [{ x: 120, y: 72 }, { x: 144, y: 72 }])).command;
  const afterRoute = commitHistoryCommand(history, routeCommand, applyOverlayCommand);
  assert.equal(afterRoute.past.length, 1);
  const batchCore = structuredClone(afterRoute.present);
  batchCore.artifact.semantic.nodes.find((node) => node.id === "stage-line").label = "LINE (Codex)";
  batchCore.artifact.semantic.nodes.find((node) => node.id === "stage-branch").label = "BRANCH (Codex)";
  const afterBatch = commitHistoryTransaction(afterRoute, batchCore, { transactionId: "codex-batch", kind: "codex.semantic.batch" });
  assert.equal(afterBatch.past.length, 2);
  assert.equal(afterBatch.lastEvent.kind, "codex.semantic.batch");
  const undone = undoHistory(afterBatch);
  assert.equal(undone.present.artifact.semantic.nodes.find((node) => node.id === "stage-line").label, "LINE");
  assert.equal(undone.present.artifact.layout.overrides.routes["edge-split"].points[0].x, 120);
});

test("new work after undo clears redo, and bounded history drops only the oldest transaction", async () => {
  const core = await coreFixture();
  let history = createHistory(core, { limit: 2 });
  history = commitHistoryCommand(history, moveCommand(history.present, "move-one", 120));
  history = commitHistoryCommand(history, moveCommand(history.present, "move-two", 140));
  history = commitHistoryCommand(history, moveCommand(history.present, "move-three", 160));
  assert.equal(history.past.length, 2);
  assert.equal(history.past[0].transactionId, "move-two");
  history = undoHistory(history);
  assert.equal(canRedo(history), true);
  history = commitHistoryCommand(history, moveCommand(history.present, "move-new", 180));
  assert.equal(canRedo(history), false);
  assert.equal(history.lastEvent.transactionId, "move-new");
  assert.equal(canUndo(history), true);
});

test("empty undo/redo are explicit no-ops and snapshots remain independent", async () => {
  const core = await coreFixture();
  let history = createHistory(core);
  const undone = undoHistory(history);
  const redone = redoHistory(undone);
  assert.equal(undone.lastEvent.type, "undo-empty");
  assert.equal(redone.lastEvent.type, "redo-empty");
  const moved = commitHistoryCommand(history, moveCommand(history.present, "independent", 130));
  moved.present.artifact.layout.overrides.nodes["stage-line"].x = 999;
  assert.equal(moved.past[0].after.artifact.layout.overrides.nodes["stage-line"].x, 130);
});

