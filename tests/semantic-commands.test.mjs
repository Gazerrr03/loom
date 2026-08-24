import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  applySemanticBatch,
  applySemanticCommand,
  createSemanticCommand,
} from "../contracts/semantic-commands.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function readFixture() {
  return JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
}

function newNode(id = "stage-new") {
  return { id, type: "product-stage", label: "NEW", componentRef: "generic-card-slab", visualRole: "main-stage", phase: "new", properties: {} };
}

test("node, edge, group and annotation commands are atomic and preserve unrelated objects", async () => {
  const artifact = await readFixture();
  const node = applySemanticCommand(artifact, createSemanticCommand({ type: "semantic.node.create", node: newNode() }));
  assert.ok(node.semantic.nodes.some((candidate) => candidate.id === "stage-new"));
  assert.equal(artifact.semantic.nodes.some((candidate) => candidate.id === "stage-new"), false);
  const updated = applySemanticCommand(node, createSemanticCommand({ type: "semantic.node.update", targetId: "stage-new", patch: { label: "NEW label", properties: { emphasis: true } } }));
  assert.equal(updated.semantic.nodes.find((candidate) => candidate.id === "stage-new").label, "NEW label");
  const connected = applySemanticCommand(updated, createSemanticCommand({ type: "semantic.edge.connect", edge: { id: "edge-new", source: "stage-line", target: "stage-new", type: "transformation", properties: {} } }));
  assert.ok(connected.semantic.edges.some((edge) => edge.id === "edge-new"));
  const grouped = applySemanticCommand(connected, createSemanticCommand({ type: "semantic.group.create", group: { id: "phase-new", type: "phase-zone", label: "New", children: ["stage-new"], properties: {} } }));
  assert.ok(grouped.semantic.groups.some((group) => group.id === "phase-new"));
  const annotated = applySemanticCommand(grouped, createSemanticCommand({ type: "semantic.annotation.create", annotation: { id: "annotation-new", text: "New note", visualRole: "note", anchor: { kind: "node", targetId: "stage-new", offset: { x: 0, y: 0 } }, properties: {} } }));
  assert.ok(annotated.annotations.some((annotation) => annotation.id === "annotation-new"));
  assert.equal(annotated.semantic.nodes.find((candidate) => candidate.id === "stage-line").label, "LINE");
});

test("edge, group and annotation updates are reference-checked", async () => {
  const artifact = await readFixture();
  const edge = applySemanticCommand(artifact, createSemanticCommand({ type: "semantic.edge.update", targetId: "edge-split", patch: { label: "SPLIT updated" } }));
  assert.equal(edge.semantic.edges.find((candidate) => candidate.id === "edge-split").label, "SPLIT updated");
  const group = applySemanticCommand(edge, createSemanticCommand({ type: "semantic.group.update", targetId: "phase-conversation", patch: { label: "Conversation updated" } }));
  assert.equal(group.semantic.groups.find((candidate) => candidate.id === "phase-conversation").label, "Conversation updated");
  const annotation = applySemanticCommand(group, createSemanticCommand({ type: "semantic.annotation.update", targetId: "annotation-thesis", patch: { text: "Updated thesis" } }));
  assert.equal(annotation.annotations.find((candidate) => candidate.id === "annotation-thesis").text, "Updated thesis");
});

test("reference protection rejects deleting live nodes, edges and groups", async () => {
  const artifact = await readFixture();
  assert.throws(() => applySemanticCommand(artifact, { type: "semantic.node.delete", targetId: "stage-line" }), /edge/);
  const withProtectedReferences = structuredClone(artifact);
  withProtectedReferences.annotations.push(
    {
      id: "annotation-edge-protection",
      text: "Edge protection",
      visualRole: "note",
      anchor: { kind: "edge", targetId: "edge-split", offset: { x: 0, y: 0 } },
      properties: {},
    },
    {
      id: "annotation-group-protection",
      text: "Group protection",
      visualRole: "note",
      anchor: { kind: "group", targetId: "phase-conversation", offset: { x: 0, y: 0 } },
      properties: {},
    },
  );
  assert.throws(
    () => applySemanticCommand(withProtectedReferences, { type: "semantic.edge.disconnect", targetId: "edge-split" }),
    /annotation/,
  );
  assert.throws(
    () => applySemanticCommand(withProtectedReferences, { type: "semantic.group.delete", targetId: "phase-conversation" }),
    /annotation/,
  );
});

test("batch application is all-or-nothing and reports affected IDs", async () => {
  const artifact = await readFixture();
  const result = applySemanticBatch(artifact, [
    { type: "semantic.node.create", node: newNode("stage-batch") },
    { type: "semantic.edge.connect", edge: { id: "edge-batch", source: "stage-line", target: "stage-batch", type: "input", properties: {} } },
  ]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.affectedIds, ["stage-batch", "edge-batch"]);
  assert.equal(result.commandsApplied, 2);
  assert.equal(artifact.semantic.nodes.some((node) => node.id === "stage-batch"), false);
  assert.throws(() => applySemanticBatch(artifact, [
    { type: "semantic.node.create", node: newNode("stage-will-rollback") },
    { type: "semantic.edge.connect", edge: { id: "edge-invalid", source: "missing", target: "stage-line", type: "input", properties: {} } },
  ]), /Dangling edge endpoint/);
  assert.equal(artifact.semantic.nodes.some((node) => node.id === "stage-will-rollback"), false);
});

test("delete commands clean the matching layout entry after references are removed", async () => {
  const artifact = await readFixture();
  let next = applySemanticCommand(artifact, { type: "semantic.node.create", node: newNode("node-delete") });
  next = applySemanticCommand(next, { type: "semantic.node.delete", targetId: "node-delete" });
  assert.equal(next.semantic.nodes.some((node) => node.id === "node-delete"), false);
  assert.equal(next.layout.generated.nodes["node-delete"], undefined);
  assert.equal(next.layout.overrides.nodes["node-delete"], undefined);
  next = applySemanticCommand(next, { type: "semantic.annotation.delete", targetId: "annotation-thesis" });
  assert.equal(next.annotations.some((annotation) => annotation.id === "annotation-thesis"), false);
});

test("command validation rejects duplicate IDs, unsupported fields and unknown operations", async () => {
  const artifact = await readFixture();
  assert.throws(() => applySemanticCommand(artifact, { type: "semantic.node.create", node: newNode("stage-line") }), /Duplicate semantic ID/);
  assert.throws(() => applySemanticCommand(artifact, { type: "semantic.node.update", targetId: "stage-line", patch: { id: "new-id" } }), /cannot change id/);
  assert.throws(() => applySemanticCommand(artifact, { type: "semantic.node.update", targetId: "stage-line", patch: { screenX: 4 } }), /unsupported/);
  assert.throws(() => applySemanticCommand(artifact, { type: "semantic.unknown.update", targetId: "stage-line", patch: { label: "x" } }), /Unsupported semantic command type/);
});
