import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  canRedoHistory,
  canUndoHistory,
  commitHistoryTransaction,
  createHistoryStack,
  redoHistoryStack,
  replaceHistoryPresent,
  undoHistoryStack,
} from "../workspace/history-stack.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function readFixture() {
  return JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
}

test("preview snapshots do not enter history and one completed edit is undoable", async () => {
  const artifact = await readFixture();
  let history = createHistoryStack(artifact);
  const preview = structuredClone(artifact);
  preview.layout.overrides.nodes["stage-line"] = { x: 160 };
  assert.equal(history.past.length, 0);
  history = commitHistoryTransaction(history, preview, { transactionId: "node-drag", kind: "layout.node.move" });
  assert.equal(history.past.length, 1);
  history = undoHistoryStack(history);
  assert.equal(history.present.layout.overrides.nodes["stage-line"], undefined);
  assert.equal(canRedoHistory(history), true);
  history = redoHistoryStack(history);
  assert.equal(history.present.layout.overrides.nodes["stage-line"].x, 160);
});

test("route, annotation, and component transactions each preserve one complete snapshot", async () => {
  const artifact = await readFixture();
  let history = createHistoryStack(artifact);
  const route = structuredClone(history.present); route.layout.overrides.routes["edge-split"] = { points: [{ x: 96, y: 152 }, { x: 120, y: 152 }] };
  history = commitHistoryTransaction(history, route, { transactionId: "route-edit", kind: "layout.route.replace-points" });
  const annotation = structuredClone(history.present); annotation.annotations[0].text = "Updated title";
  history = commitHistoryTransaction(history, annotation, { transactionId: "annotation-edit", kind: "annotation.update" });
  const component = structuredClone(history.present); component.semantic.nodes[0].componentRef = "flovvas-card";
  history = commitHistoryTransaction(history, component, { transactionId: "component-edit", kind: "semantic.node.update" });
  assert.equal(history.past.length, 3);
  history = undoHistoryStack(history);
  assert.equal(history.present.annotations[0].text, "Updated title");
  assert.equal(history.present.semantic.nodes[0].componentRef, "flovvas-line");
  history = undoHistoryStack(history);
  assert.equal(history.present.annotations[0].text, "From conversation to a compounding workspace");
  assert.deepEqual(history.present.layout.overrides.routes["edge-split"].points[0], { x: 96, y: 152 });
});

test("new edit clears redo, empty operations are no-op, and snapshots are independent", async () => {
  const artifact = await readFixture();
  let history = createHistoryStack(artifact, { limit: 2 });
  const first = structuredClone(artifact); first.semantic.nodes[0].label = "LINE one";
  history = commitHistoryTransaction(history, first, { transactionId: "one", kind: "semantic.node.update" });
  const second = structuredClone(first); second.semantic.nodes[0].label = "LINE two";
  history = commitHistoryTransaction(history, second, { transactionId: "two", kind: "semantic.node.update" });
  history = undoHistoryStack(history);
  assert.equal(canUndoHistory(history), true);
  assert.equal(canRedoHistory(history), true);
  const third = structuredClone(history.present); third.semantic.nodes[0].label = "LINE three";
  history = commitHistoryTransaction(history, third, { transactionId: "three", kind: "semantic.node.update" });
  assert.equal(canRedoHistory(history), false);
  assert.equal(undoHistoryStack(createHistoryStack(artifact)).lastEvent.type, "undo-empty");
  assert.equal(redoHistoryStack(createHistoryStack(artifact)).lastEvent.type, "redo-empty");
  history.present.semantic.nodes[0].label = "mutated present";
  assert.equal(history.past[0].after.semantic.nodes[0].label, "LINE one");
  const saved = replaceHistoryPresent(history, artifact);
  assert.equal(saved.present.semantic.nodes[0].label, "LINE");
});
