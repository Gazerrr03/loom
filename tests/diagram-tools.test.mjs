import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDiagramToolService } from "../mcp/diagram-tools.mjs";
import { createToolCall, assertToolResult } from "../contracts/tool-envelope.mjs";

const sourceRoot = new URL("../examples/", import.meta.url);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-diagram-tools-"));
  await cp(new URL("flovvas-massing.diagram.json", sourceRoot), join(root, "flovvas-massing.diagram.json"));
  return { root, service: createDiagramToolService({ rootDir: root }) };
}

test("create, open, summary and validate share a revision-aware tool envelope", async () => {
  const { root, service } = await fixture();
  const opened = await service.execute(createToolCall({
    toolName: "diagram.open",
    requestId: "open-001",
    input: { path: "flovvas-massing.diagram.json" },
  }));
  assertToolResult(opened);
  assert.equal(opened.status, "ok");
  assert.ok(opened.revision.startsWith("sha256:"));
  assert.equal(opened.effects.kind, "read");
  assert.equal(opened.result.summary.counts.nodes, 15);

  const summary = await service.execute(createToolCall({
    toolName: "diagram.summary",
    requestId: "summary-001",
    input: { path: "flovvas-massing.diagram.json" },
  }));
  assert.equal(summary.result.summary.revision, opened.revision);

  const validation = await service.execute(createToolCall({
    toolName: "diagram.validate",
    requestId: "validate-001",
    input: { artifact: opened.result.artifact },
  }));
  assert.equal(validation.result.valid, true);
  assert.equal(validation.effects.kind, "none");

  const created = await service.execute(createToolCall({
    toolName: "diagram.create",
    requestId: "create-001",
    input: { path: "created.diagram.json", artifact: opened.result.artifact },
  }));
  assert.equal(created.result.created, true);
  assert.equal(created.effects.kind, "write");
  assert.equal((await stat(join(root, "created.diagram.json"))).isFile(), true);
  const duplicate = await service.execute(createToolCall({
    toolName: "diagram.create",
    requestId: "create-duplicate",
    input: { path: "created.diagram.json", artifact: opened.result.artifact },
  }));
  assert.equal(duplicate.status, "error");
  assert.match(duplicate.error.message, /diagram\.save/);
});

test("save supports dry-run, expected revision, and atomic revision tracking", async () => {
  const { service } = await fixture();
  const opened = await service.execute(createToolCall({ toolName: "diagram.open", requestId: "open-002", input: { path: "flovvas-massing.diagram.json" } }));
  const artifact = structuredClone(opened.result.artifact);
  artifact.metadata.title = "Updated title";
  const dryRun = await service.execute(createToolCall({
    toolName: "diagram.save",
    requestId: "save-dry-run",
    input: { path: "flovvas-massing.diagram.json", artifact },
    expectedRevision: opened.revision,
    dryRun: true,
  }));
  assert.equal(dryRun.result.wouldWrite, true);
  assert.equal(dryRun.effects.kind, "none");
  const saved = await service.execute(createToolCall({
    toolName: "diagram.save",
    requestId: "save-002",
    input: { path: "flovvas-massing.diagram.json", artifact },
    expectedRevision: opened.revision,
  }));
  assert.equal(saved.result.saved, true);
  assert.notEqual(saved.revision, opened.revision);
  assert.equal(saved.effects.changed, true);
  const stale = await service.execute(createToolCall({
    toolName: "diagram.save",
    requestId: "save-stale",
    input: { path: "flovvas-massing.diagram.json", artifact },
    expectedRevision: opened.revision,
  }));
  assert.equal(stale.status, "error");
  assert.equal(stale.error.code, "revision-conflict");
  assert.equal(stale.effects.changed, false);
});

test("invalid input and unsafe paths fail before file access without leaking absolute paths", async () => {
  const { service } = await fixture();
  const traversal = await service.execute(createToolCall({ toolName: "diagram.open", requestId: "bad-path", input: { path: "../secret.json" } }));
  assert.equal(traversal.status, "error");
  assert.equal(traversal.error.code, "invalid-tool-input");
  assert.match(traversal.error.fieldPath, /input\.path/);
  assert.doesNotMatch(traversal.error.message, /\/Users|\/private|\/tmp/);

  const missingArtifact = await service.execute(createToolCall({ toolName: "diagram.validate", requestId: "bad-artifact", input: { artifact: {} } }));
  assert.equal(missingArtifact.status, "error");
  assert.equal(missingArtifact.error.code, "invalid-envelope");
  assert.equal(missingArtifact.effects.changed, false);

  const validArtifact = JSON.parse(await readFile(new URL("../examples/flovvas-massing.diagram.json", import.meta.url), "utf8"));
  const dryRunTraversal = await service.execute(createToolCall({
    toolName: "diagram.create",
    requestId: "bad-create-path",
    input: { path: "../secret.json", artifact: validArtifact },
    dryRun: true,
  }));
  assert.equal(dryRunTraversal.status, "error");
  assert.equal(dryRunTraversal.error.code, "invalid-tool-input");
});

test("tool service rejects unsupported tool names using the shared actionable error", async () => {
  const { service } = await fixture();
  const result = await service.execute(createToolCall({ toolName: "diagram.delete", requestId: "unsupported", input: {} }));
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "invalid-tool-input");
  assert.equal(result.effects.kind, "none");
});

test("tool service preserves structured coordinate compatibility blocks", async () => {
  const { root, service } = await fixture();
  const artifact = JSON.parse(await readFile(new URL("../examples/flovvas-massing.diagram.json", import.meta.url), "utf8"));
  artifact.layout.generated.nodes["stage-line"].z = 12;
  await writeFile(join(root, "unsupported-coordinate.diagram.json"), JSON.stringify(artifact));

  const result = await service.execute(createToolCall({
    toolName: "diagram.open",
    requestId: "open-unsupported-coordinate",
    input: { path: "unsupported-coordinate.diagram.json" },
  }));

  assert.equal(result.status, "error");
  assert.equal(result.error.code, "unsupported-coordinate-space");
  assert.equal(result.error.recoverable, false);
  assert.equal(result.error.fieldPath, "artifact.layout.generated.nodes");
  assert.match(result.error.suggestedAction, /Diagram x\/y/);
});
