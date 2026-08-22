import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertToolCall, assertToolEnvelope, assertToolResult, createToolCall, createToolError, createToolResult } from "../contracts/tool-envelope.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("MCP tool schema and builders share a versioned call/result envelope", async () => {
  const schema = JSON.parse(await readFile(join(repoRoot, "contracts/mcp-tools.schema.json"), "utf8"));
  assert.deepEqual(Object.keys(schema.$defs).sort(), ["effect", "error", "requestId", "revision", "toolCall", "toolName", "toolResult"]);

  const call = createToolCall({
    toolName: "diagram.save",
    requestId: "req-001",
    input: { artifactId: "flovvas-massing-golden-case" },
    expectedRevision: "sha256:before",
    dryRun: false,
  });
  assert.equal(assertToolEnvelope(call), call);
  assert.doesNotThrow(() => assertToolCall(call));

  const result = createToolResult({
    toolName: call.toolName,
    requestId: call.requestId,
    result: { artifactId: "flovvas-massing-golden-case", changed: true },
    revision: "sha256:after",
    effects: { kind: "write", paths: ["diagrams/flovvas.diagram.json"], changed: true, reversible: true },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.error, null);
  assert.equal(assertToolEnvelope(result), result);
  assert.doesNotThrow(() => assertToolResult(result));
});

test("tool errors reuse the shared actionable error fields and preserve revision/effect context", () => {
  const result = createToolError({
    toolName: "diagram.save",
    requestId: "req-002",
    code: "revision-conflict",
    message: "The Diagram changed since the requested revision.",
    objectIds: ["flovvas-massing-golden-case"],
    fieldPath: "revision",
    recoverable: true,
    suggestedAction: "Reload the current revision before saving again.",
    revision: "sha256:current",
    effects: { kind: "write", paths: ["diagrams/flovvas.diagram.json"], changed: false, reversible: true },
  });
  assert.equal(result.status, "error");
  assert.equal(result.result, null);
  assert.equal(result.error.code, "revision-conflict");
  assert.equal(result.revision, "sha256:current");
  assert.equal(result.effects.changed, false);
  assert.doesNotThrow(() => assertToolEnvelope(result));
});

test("tool envelopes reject renderer-private payloads, unsafe paths, and mismatched status", () => {
  const call = createToolCall({ toolName: "diagram.load", requestId: "req-003", input: {} });
  assert.throws(() => assertToolCall({ ...call, input: { rendererScene: {} } }), /Renderer private/);
  assert.throws(() => assertToolResult({
    format: "loom.mcp.tool-result",
    schemaVersion: "0.1.0",
    toolName: "diagram.save",
    requestId: "req-004",
    status: "ok",
    result: {},
    error: null,
    revision: null,
    effects: { kind: "write", paths: ["../secret"], changed: false, reversible: true },
  }), /safe relative/);
  assert.throws(() => assertToolResult({
    format: "loom.mcp.tool-result",
    schemaVersion: "0.1.0",
    toolName: "diagram.load",
    requestId: "req-005",
    status: "ok",
    result: null,
    error: { code: "invalid-tool-input", message: "bad", objectIds: [], fieldPath: null, recoverable: true, suggestedAction: null },
    revision: null,
    effects: { kind: "none", paths: [], changed: false, reversible: true },
  }), /successful tool result/);
  assert.throws(() => createToolError({
    toolName: "diagram.load",
    requestId: "req-006",
    code: "invalid-tool-input",
    message: "bad",
    cause: "/Users/qizhi_dong/private.json",
  }), /local path/);
});
