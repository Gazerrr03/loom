import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function startServer() {
  const child = spawn(process.execPath, ["mcp/server.mjs"], {
    cwd: repoRoot,
    env: { ...process.env, LOOM_PROJECT_ROOT: repoRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  const responses = [];
  const waiters = [];
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const message = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else responses.push(message);
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  function nextResponse() {
    if (responses.length > 0) return Promise.resolve(responses.shift());
    return new Promise((resolveResponse) => waiters.push(resolveResponse));
  }

  async function request(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return nextResponse();
  }

  function notify(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async function close() {
    child.stdin.end();
    await once(child, "exit");
    assert.equal(stderr, "");
  }

  return { request, notify, close };
}

async function initializedClient() {
  const client = startServer();
  const initialize = await client.request({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "loom-test-client", version: "0.1.0" },
    },
  });
  assert.equal(initialize.result.serverInfo.name, "loom");
  assert.equal(initialize.result.protocolVersion, "2025-06-18");
  client.notify({ jsonrpc: "2.0", method: "notifications/initialized" });
  return client;
}

test("stdio MCP lifecycle discovers Loom tools and calls the existing Diagram service", async () => {
  const client = await initializedClient();
  try {
    const listed = await client.request({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = listed.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, [
      "diagram.create",
      "diagram.open",
      "diagram.validate",
      "diagram.save",
      "diagram.summary",
      "component.query",
      "component.get",
      "semantic.transaction.begin",
      "semantic.transaction.preview",
      "semantic.transaction.commit",
      "semantic.transaction.cancel",
      "semantic.transaction.fail",
    ]);
    assert.equal(listed.result.tools.find((tool) => tool.name === "diagram.summary").inputSchema.properties.path.type, "string");

    const called = await client.request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "diagram.summary",
        arguments: { path: "examples/flovvas-massing.diagram.json" },
      },
    });
    assert.equal(called.result.isError, false);
    assert.equal(called.result.structuredContent.status, "ok");
    assert.equal(called.result.structuredContent.result.summary.counts.nodes, 15);
    assert.equal(called.result.structuredContent.effects.kind, "read");
    assert.deepEqual(JSON.parse(called.result.content[0].text), called.result.structuredContent);
    assert.doesNotMatch(called.result.content[0].text, /\/Users\/|\/private\/|\/tmp\/|[A-Za-z]:[\\/]/);
  } finally {
    await client.close();
  }
});

test("stdio MCP dispatches Component and stateful Semantic Transaction tools", async () => {
  const client = await initializedClient();
  try {
    const component = await client.request({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "component.query", arguments: { nodeType: "product-stage", semanticQuery: "分支" } },
    });
    assert.equal(component.result.isError, false);
    assert.equal(component.result.structuredContent.result.matches[0].id, "flovvas-branch");

    const begin = await client.request({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "semantic.transaction.begin",
        arguments: {
          transactionId: "stdio-transaction",
          path: "examples/flovvas-massing.diagram.json",
          commands: [{
            type: "semantic.node.update",
            targetId: "stage-line",
            patch: { label: "LINE (MCP)" },
          }],
        },
      },
    });
    assert.equal(begin.result.isError, false);
    assert.equal(begin.result.structuredContent.result.phase, "prepared");
    assert.equal(begin.result.structuredContent.result.path, "examples/flovvas-massing.diagram.json");

    const preview = await client.request({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "semantic.transaction.preview", arguments: { transactionId: "stdio-transaction" } },
    });
    assert.equal(preview.result.isError, false);
    assert.equal(preview.result.structuredContent.result.phase, "previewing");
    assert.equal(preview.result.structuredContent.result.artifact.semantic.nodes.find((node) => node.id === "stage-line").label, "LINE (MCP)");
    assert.equal(preview.result.structuredContent.effects.changed, false);

    const commit = await client.request({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "semantic.transaction.commit", arguments: { transactionId: "stdio-transaction" } },
    });
    assert.equal(commit.result.isError, false);
    assert.equal(commit.result.structuredContent.result.phase, "committed");
    assert.equal(commit.result.structuredContent.result.persisted, false);
    assert.equal(commit.result.structuredContent.result.artifact.semantic.nodes.find((node) => node.id === "stage-line").label, "LINE (MCP)");
    assert.equal(commit.result.structuredContent.effects.kind, "write");
    assert.deepEqual(commit.result.structuredContent.effects.paths, []);
  } finally {
    await client.close();
  }
});

test("stdio MCP returns structured execution errors without leaking absolute paths", async () => {
  const client = await initializedClient();
  try {
    const invalid = await client.request({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "diagram.open", arguments: { path: "../secret.diagram.json" } },
    });
    assert.equal(invalid.result.isError, true);
    assert.equal(invalid.result.structuredContent.status, "error");
    assert.equal(invalid.result.structuredContent.error.code, "invalid-tool-input");
    assert.doesNotMatch(JSON.stringify(invalid), /\/Users\/|\/private\/|\/tmp\/|[A-Za-z]:[\\/]/);

    const unsafePayload = await client.request({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "diagram.validate", arguments: { artifact: { metadata: { source: "/workspace/private.diagram.json" } } } },
    });
    assert.equal(unsafePayload.result.isError, true);
    assert.equal(unsafePayload.result.structuredContent.error.message, "MCP payload contains an absolute local path");
    assert.doesNotMatch(JSON.stringify(unsafePayload), /private\.diagram|workspace/);

    const unsafeCredential = await client.request({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "diagram.validate", arguments: { artifact: { metadata: { apiToken: "super-secret" } } } },
    });
    assert.equal(unsafeCredential.result.isError, true);
    assert.equal(unsafeCredential.result.structuredContent.error.message, "MCP payload contains a credential field");
    assert.doesNotMatch(JSON.stringify(unsafeCredential), /super-secret|apiToken/);

    const malformedArguments = await client.request({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "diagram.summary", arguments: null },
    });
    assert.equal(malformedArguments.error.code, -32602);

    const begin = await client.request({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "semantic.transaction.begin",
        arguments: {
          transactionId: "safe-failure",
          path: "examples/flovvas-massing.diagram.json",
          commands: [],
        },
      },
    });
    assert.equal(begin.result.isError, false);
    const failed = await client.request({
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: { name: "semantic.transaction.fail", arguments: { transactionId: "safe-failure", message: "token=super-secret" } },
    });
    assert.equal(failed.result.isError, false);
    assert.equal(failed.result.structuredContent.result.error.message, "[redacted]");
    assert.doesNotMatch(JSON.stringify(failed), /super-secret/);

    const unknown = await client.request({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "loom.unknown", arguments: {} },
    });
    assert.equal(unknown.error.code, -32602);
  } finally {
    await client.close();
  }
});
