import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertSemanticGraph } from "../contracts/semantic-graph.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readArtifact() {
  const artifact = await readJson(join(repoRoot, "examples/flovvas-massing.diagram.json"));
  return structuredClone(artifact.semantic);
}

test("the Golden Case semantic graph resolves all IDs by reference", async () => {
  const semantic = await readArtifact();

  assert.doesNotThrow(() => assertSemanticGraph(semantic));
  assert.equal(semantic.edges[0].source, "stage-line");
  assert.equal(semantic.edges[0].target, "stage-branch");
  assert.ok(semantic.groups.every((group) => group.children.every((id) =>
    semantic.nodes.some((node) => node.id === id),
  )));
});

test("duplicate IDs, dangling endpoints, and invalid group children fail with paths", async () => {
  const duplicate = await readArtifact();
  duplicate.edges[0].id = duplicate.nodes[0].id;
  assert.throws(() => assertSemanticGraph(duplicate), /Duplicate semantic ID: stage-line/);

  const danglingEdge = await readArtifact();
  danglingEdge.edges[0].target = "missing-node";
  assert.throws(
    () => assertSemanticGraph(danglingEdge),
    /Dangling edge endpoint: semantic\.edges\[0\]\.target -> missing-node/,
  );

  const danglingChild = await readArtifact();
  danglingChild.groups[0].children.push("missing-node");
  assert.throws(
    () => assertSemanticGraph(danglingChild),
    /Dangling group child: semantic\.groups\[0\]\.children\[3\] -> missing-node/,
  );
});

test("semantic type and visual presentation remain open and independent", async () => {
  const semantic = await readArtifact();
  semantic.nodes[0].type = "future-domain-specific-node";
  semantic.edges[0].type = "relationship-not-in-an-enum";
  semantic.edges[0].visualRole = "red-dashed-route";

  assert.doesNotThrow(() => assertSemanticGraph(semantic));
});
