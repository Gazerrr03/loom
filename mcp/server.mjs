import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { createCoreState, openCore } from "../core/diagram-core.mjs";
import { createComponentResolver } from "../core/component-resolver.mjs";
import {
  assertToolResult,
  createToolCall,
  createToolError,
  createToolResult,
} from "../contracts/tool-envelope.mjs";
import { createComponentToolService } from "./component-tools.mjs";
import { createDiagramToolService } from "./diagram-tools.mjs";
import {
  beginSemanticTransaction,
  cancelSemanticTransaction,
  commitSemanticTransaction,
  failSemanticTransaction,
  getSemanticTransactionVisibleCore,
  previewSemanticTransaction,
} from "./semantic-transaction.mjs";
import { createHistory } from "../workspace/history.mjs";

const SERVER_NAME = "loom";
const SERVER_VERSION = "0.1.0";
const DEFAULT_PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];
const SAFE_LOGICAL_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const CREDENTIAL_KEY = /(?:^|[_-]|access|api|auth|bearer|client|refresh|session|user)(?:token|key|secret|credential|password)s?$/i;
const ABSOLUTE_LOCAL_PATH = /^(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\|file:\/\/(?:\/|[A-Za-z]:[\\/]))/;
const MAX_TRANSACTIONS = 32;
const SERVER_INSTRUCTIONS = [
  "Use only Loom's renderer-independent Diagram, Component, and semantic transaction tools.",
  "Paths are relative to the configured project root; never send absolute paths, credentials, tokens, or Renderer runtime state.",
  "Semantic previews and commits are memory-only; call diagram.save explicitly to persist a returned artifact.",
].join(" ");

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function safeMessage(message) {
  return String(message)
    .replace(/(^|[\s("'=])\/(?!\/)[^\s"'`,;)}]+/g, "$1[path]")
    .replace(/[A-Za-z]:[\\/][^\s)]+/g, "[path]")
    .replace(/\\\\[^\s)]+/g, "[path]")
    .replace(/\b(?:access[_-]?token|api[_-]?key|credential|password|secret|token)\b\s*[:=]\s*[^\s,;}]+/gi, "[redacted]");
}

function assertMcpSafeValue(value, path = "input", seen = new Set()) {
  if (typeof value === "string") {
    if (ABSOLUTE_LOCAL_PATH.test(value)) throw new Error("MCP payload contains an absolute local path");
    return value;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (!isRecord(value) && !Array.isArray(value)) throw new Error("MCP payload contains a non-JSON value");
  if (seen.has(value)) throw new Error("MCP payload contains a cyclic value");
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMcpSafeValue(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (CREDENTIAL_KEY.test(key)) throw new Error("MCP payload contains a credential field");
      assertMcpSafeValue(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
  return value;
}

function safeErrorCode(error) {
  const message = String(error?.message ?? error);
  if (/revision|stale/i.test(message)) return "revision-conflict";
  if (/unsupported template|template does not resolve/i.test(message)) return "unsupported-template";
  if (/dangling|reference/i.test(message)) return "dangling-reference";
  return "invalid-tool-input";
}

function safeErrorResult(toolName, requestId, error, { fieldPath = "input", revision = null } = {}) {
  return createToolError({
    toolName,
    requestId,
    code: safeErrorCode(error),
    message: safeMessage(error?.message ?? error),
    fieldPath,
    recoverable: true,
    suggestedAction: "Fix the input and retry the Loom tool.",
    revision,
  });
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message: safeMessage(message) };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id: id ?? null, error };
}

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function requestIdFor(id) {
  const raw = typeof id === "string" || typeof id === "number" ? String(id) : "anonymous";
  const compact = raw.replace(/\s+/g, "-").slice(0, 140);
  return `mcp-${compact || "anonymous"}`;
}

function resolveProjectPath(rootDir, logicalPath) {
  if (typeof logicalPath !== "string" || logicalPath.length === 0 || !SAFE_LOGICAL_PATH.test(logicalPath)) {
    throw new Error("path must be a safe relative logical path");
  }
  const absoluteRoot = resolve(rootDir);
  const absolutePath = resolve(absoluteRoot, logicalPath);
  const relativePath = relative(absoluteRoot, absolutePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || relativePath.includes(`${sep}..${sep}`)) {
    throw new Error("path escapes the configured project root");
  }
  return absolutePath;
}

async function readProjectJson(rootDir, logicalPath) {
  const filePath = resolveProjectPath(rootDir, logicalPath);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error(`Loom MCP could not load project data: ${logicalPath}`);
  }
}

const CONTROL_PROPERTIES = {
  expectedRevision: {
    type: ["string", "null"],
    description: "Expected current Diagram revision for optimistic writes.",
  },
  dryRun: {
    type: "boolean",
    default: false,
    description: "Validate and summarize without writing a Diagram file.",
  },
};

const artifactSchema = {
  type: "object",
  description: "Renderer-independent Loom Diagram Artifact.",
};

const pathSchema = {
  type: "string",
  pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$",
  description: "Relative path below the configured Loom project root.",
};

const commandSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", description: "Existing semantic command type." },
    targetId: { type: "string" },
    node: { type: "object" },
    edge: { type: "object" },
    group: { type: "object" },
    annotation: { type: "object" },
    patch: { type: "object" },
    transactionId: { type: "string" },
    baseRevision: { type: "string" },
  },
  required: ["type"],
};

function schema(properties, required = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

const TOOL_DEFINITIONS = [
  {
    name: "diagram.create",
    title: "Create Diagram",
    description: "Validate and optionally persist a new renderer-independent Loom Diagram. Use dryRun for a preview.",
    inputSchema: schema({ path: pathSchema, artifact: artifactSchema, ...CONTROL_PROPERTIES }, ["artifact"]),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "diagram.open",
    title: "Open Diagram",
    description: "Open and validate a Diagram from a relative path below the configured Loom project root.",
    inputSchema: schema({ path: pathSchema }, ["path"]),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "diagram.validate",
    title: "Validate Diagram",
    description: "Validate a Diagram file or in-memory Artifact against the Loom contracts.",
    inputSchema: schema({ path: pathSchema, artifact: artifactSchema }, []),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "diagram.save",
    title: "Save Diagram",
    description: "Atomically save a validated Diagram Artifact below the configured Loom project root.",
    inputSchema: schema({ path: pathSchema, artifact: artifactSchema, ...CONTROL_PROPERTIES }, ["path", "artifact"]),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "diagram.summary",
    title: "Summarize Diagram",
    description: "Read a compact structural summary and revision for a Diagram at a relative project path.",
    inputSchema: schema({ path: pathSchema }, ["path"]),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "component.query",
    title: "Query Components",
    description: "Find shared Component Templates by node type and/or semantic query, including match reasons and capabilities.",
    inputSchema: schema({
      nodeType: { type: "string" },
      semanticQuery: { type: "string" },
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "component.get",
    title: "Get Component",
    description: "Read one shared Component Template definition and its safe Renderer mapping summary.",
    inputSchema: schema({ templateId: { type: "string" } }, ["templateId"]),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "semantic.transaction.begin",
    title: "Begin Semantic Transaction",
    description: "Prepare a semantic batch from a Diagram path or Artifact without writing a file.",
    inputSchema: schema({
      transactionId: { type: "string" },
      path: pathSchema,
      artifact: artifactSchema,
      baseRevision: { type: ["string", "null"] },
      commands: { type: "array", items: commandSchema },
      preserveOverrides: { type: "boolean", default: true },
      history: { type: "boolean", default: true },
      historyLimit: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
    }, ["transactionId", "commands"]),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "semantic.transaction.preview",
    title: "Preview Semantic Transaction",
    description: "Rebuild an ephemeral semantic preview from the transaction's original base revision.",
    inputSchema: schema({
      transactionId: { type: "string" },
      commands: { type: "array", items: commandSchema },
      seed: { type: "string" },
      preserveOverrides: { type: "boolean" },
    }, ["transactionId"]),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "semantic.transaction.commit",
    title: "Commit Semantic Transaction",
    description: "Commit exactly the latest semantic preview as one in-memory revision/history entry; use diagram.save to persist it.",
    inputSchema: schema({ transactionId: { type: "string" } }, ["transactionId"]),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "semantic.transaction.cancel",
    title: "Cancel Semantic Transaction",
    description: "Discard the current semantic preview and keep the valid base state visible.",
    inputSchema: schema({ transactionId: { type: "string" } }, ["transactionId"]),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "semantic.transaction.fail",
    title: "Fail Semantic Transaction",
    description: "Discard the current semantic preview with an explicit recoverable failure message.",
    inputSchema: schema({
      transactionId: { type: "string" },
      message: { type: "string" },
    }, ["transactionId", "message"]),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

const TOOL_BY_NAME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
const DIAGRAM_TOOL_NAMES = new Set(["diagram.create", "diagram.open", "diagram.validate", "diagram.save", "diagram.summary"]);
const COMPONENT_TOOL_NAMES = new Set(["component.query", "component.get"]);
const SEMANTIC_TOOL_NAMES = new Set([
  "semantic.transaction.begin",
  "semantic.transaction.preview",
  "semantic.transaction.commit",
  "semantic.transaction.cancel",
  "semantic.transaction.fail",
]);

function memoryEffects() {
  return { kind: "none", paths: [], changed: false, reversible: true };
}

function memoryCommitEffects() {
  return { kind: "write", paths: [], changed: true, reversible: true };
}

function transactionResult(transaction, logicalPath, includeArtifact = false) {
  const result = {
    transactionId: transaction.transactionId,
    phase: transaction.phase,
    baseRevision: transaction.baseRevision,
    path: logicalPath,
    preserveHumanOverrides: transaction.preserveOverrides,
    summary: clone(transaction.summary),
  };
  if (includeArtifact) {
    const visibleCore = getSemanticTransactionVisibleCore(transaction);
    result.artifact = clone(visibleCore.artifact);
    result.effectiveLayout = clone(visibleCore.effectiveLayout);
    result.constraintReport = clone(visibleCore.constraintReport);
    result.revision = visibleCore.revision;
  }
  if (transaction.error !== null) result.error = clone(transaction.error);
  return result;
}

function assertArguments(name, args, requestId) {
  assertMcpSafeValue(args);
  createToolCall({ toolName: name, requestId, input: args });
}

function splitDiagramArguments(args) {
  const {
    expectedRevision = null,
    dryRun = false,
    ...input
  } = args;
  return { input, expectedRevision, dryRun };
}

async function loadServices(projectRoot) {
  const [catalog, registry] = await Promise.all([
    readProjectJson(projectRoot, "examples/flovvas-template-catalog.json"),
    readProjectJson(projectRoot, "examples/flovvas-template-registry.json"),
  ]);
  const manifests = await Promise.all(registry.templates.map(({ path }) => readProjectJson(projectRoot, path)));
  const resolver = createComponentResolver({
    catalog,
    registry,
    manifests,
    capabilities: {
      adapterId: "reference-webgl",
      adapterVersion: "0.1.0",
      projections: ["orthographic"],
      componentKinds: ["parametric-scene", "fallback"],
      interactions: ["pick", "move-plane"],
      exports: ["png"],
      assetFormats: ["glb", "gltf"],
      features: ["orthographic-camera", "instancing"],
    },
  });
  return {
    diagram: createDiagramToolService({ rootDir: projectRoot }),
    component: createComponentToolService({ catalog, resolver }),
  };
}

export async function createLoomMcpServer({ projectRoot = process.env.LOOM_PROJECT_ROOT ?? process.cwd() } = {}) {
  const absoluteProjectRoot = resolve(projectRoot);
  const services = await loadServices(absoluteProjectRoot);
  const transactions = new Map();
  const transactionPaths = new Map();
  let initialized = false;
  let negotiatedProtocolVersion = null;

  async function executeDiagramOrComponent(name, args, requestId) {
    const service = DIAGRAM_TOOL_NAMES.has(name) ? services.diagram : services.component;
    const { input, expectedRevision, dryRun } = splitDiagramArguments(args);
    const call = createToolCall({ toolName: name, requestId, input, expectedRevision, dryRun });
    return service.execute(call);
  }

  async function transactionBase(args) {
    const hasPath = args.path !== undefined;
    const hasArtifact = args.artifact !== undefined;
    if (hasPath === hasArtifact) throw new Error("semantic transaction requires exactly one of path or artifact");
    if (hasPath) {
      const logicalPath = args.path;
      const filePath = services.diagram.resolveLogicalPath(logicalPath);
      return { core: await openCore(filePath), logicalPath };
    }
    const revision = args.baseRevision ?? null;
    return { core: createCoreState(args.artifact, { revision }) , logicalPath: null };
  }

  function getTransaction(transactionId) {
    const entry = transactions.get(transactionId);
    if (!entry) throw new Error("semantic transaction does not resolve; begin it first");
    return entry;
  }

  async function executeSemantic(name, args, requestId) {
    if (name === "semantic.transaction.begin") {
      if (transactions.size >= MAX_TRANSACTIONS) throw new Error("too many active semantic transactions");
      if (transactions.has(args.transactionId)) throw new Error("semantic transaction ID is already active");
      const { core, logicalPath } = await transactionBase(args);
      const history = args.history === false
        ? null
        : createHistory(core, { limit: args.historyLimit ?? 100 });
      const transaction = beginSemanticTransaction(core, args.commands, {
        transactionId: args.transactionId,
        preserveOverrides: args.preserveOverrides ?? true,
        history,
      });
      transactions.set(args.transactionId, transaction);
      transactionPaths.set(args.transactionId, logicalPath);
      return createToolResult({
        toolName: name,
        requestId,
        result: transactionResult(transaction, logicalPath),
        revision: transaction.baseRevision,
        effects: memoryEffects(),
      });
    }

    const entry = getTransaction(args.transactionId);
    const logicalPath = transactionPaths.get(args.transactionId) ?? null;
    if (name === "semantic.transaction.preview") {
      const transaction = previewSemanticTransaction(entry, {
        ...(args.commands === undefined ? {} : { commands: args.commands }),
        ...(args.seed === undefined ? {} : { seed: args.seed }),
        ...(args.preserveOverrides === undefined ? {} : { preserveOverrides: args.preserveOverrides }),
      });
      transactions.set(args.transactionId, transaction);
      return createToolResult({
        toolName: name,
        requestId,
        result: transactionResult(transaction, logicalPath, true),
        revision: transaction.previewCore.revision,
        effects: memoryEffects(),
      });
    }
    if (name === "semantic.transaction.commit") {
      const committed = commitSemanticTransaction(entry);
      transactions.set(args.transactionId, committed.transaction);
      return createToolResult({
        toolName: name,
        requestId,
        result: {
          ...transactionResult(committed.transaction, logicalPath, true),
          expectedRevision: committed.expectedRevision,
          committedRevision: committed.revision,
          persisted: false,
          nextAction: "Call diagram.save with the returned artifact to persist the committed revision.",
        },
        revision: committed.revision,
        effects: memoryCommitEffects(),
      });
    }
    if (name === "semantic.transaction.cancel") {
      const transaction = cancelSemanticTransaction(entry);
      transactions.set(args.transactionId, transaction);
      return createToolResult({
        toolName: name,
        requestId,
        result: transactionResult(transaction, logicalPath),
        revision: transaction.baseRevision,
        effects: memoryEffects(),
      });
    }
    const transaction = failSemanticTransaction(entry, new Error(safeMessage(args.message)));
    transactions.set(args.transactionId, transaction);
    return createToolResult({
      toolName: name,
      requestId,
      result: transactionResult(transaction, logicalPath),
      revision: transaction.baseRevision,
      effects: memoryEffects(),
    });
  }

  async function callTool(name, args, requestId) {
    if (!isRecord(args)) throw new Error("tools/call arguments must be an object");
    if (!TOOL_BY_NAME.has(name)) throw new Error("Unknown Loom tool");
    try {
      assertArguments(name, args, requestId);
      if (DIAGRAM_TOOL_NAMES.has(name) || COMPONENT_TOOL_NAMES.has(name)) {
        const result = await executeDiagramOrComponent(name, args, requestId);
        assertMcpSafeValue(assertToolResult(result), "toolResult");
        return result;
      }
      if (SEMANTIC_TOOL_NAMES.has(name)) {
        const result = await executeSemantic(name, args, requestId);
        assertMcpSafeValue(assertToolResult(result), "toolResult");
        return result;
      }
      throw new Error("Unknown Loom tool");
    } catch (error) {
      return safeErrorResult(name, requestId, error, {
        fieldPath: name.startsWith("semantic.transaction") ? "input" : (name === "component.get" ? "input.templateId" : "input"),
        revision: null,
      });
    }
  }

  async function handle(message) {
    if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return jsonRpcError(null, -32600, "Invalid JSON-RPC request");
    }
    const id = Object.hasOwn(message, "id") ? message.id : null;
    const isNotification = !Object.hasOwn(message, "id");
    if (message.method === "ping") return isNotification ? null : response(id, {});
    if (message.method === "notifications/initialized") return null;
    if (message.method === "initialize") {
      if (isNotification || initialized) return jsonRpcError(id, -32600, "Invalid initialize request");
      if (!isRecord(message.params) || typeof message.params.protocolVersion !== "string") {
        return jsonRpcError(id, -32602, "initialize requires a protocolVersion");
      }
      const requested = message.params.protocolVersion;
      negotiatedProtocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : DEFAULT_PROTOCOL_VERSION;
      initialized = true;
      return response(id, {
        protocolVersion: negotiatedProtocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    if (!initialized) return jsonRpcError(id, -32002, "Server must be initialized before this request");
    if (isNotification) return null;
    if (message.method === "tools/list") {
      return response(id, { tools: TOOL_DEFINITIONS.map(clone) });
    }
    if (message.method === "tools/call") {
      if (!isRecord(message.params) || typeof message.params.name !== "string") {
        return jsonRpcError(id, -32602, "tools/call requires a tool name");
      }
      if (!TOOL_BY_NAME.has(message.params.name)) {
        return jsonRpcError(id, -32602, "Unknown Loom tool");
      }
      if (Object.hasOwn(message.params, "arguments") && !isRecord(message.params.arguments)) {
        return jsonRpcError(id, -32602, "tools/call arguments must be an object");
      }
      const args = message.params.arguments ?? {};
      const requestId = requestIdFor(id);
      const toolResult = await callTool(message.params.name, args, requestId);
      return response(id, {
        content: [{ type: "text", text: JSON.stringify(toolResult) }],
        structuredContent: toolResult,
        isError: toolResult.status === "error",
      });
    }
    return jsonRpcError(id, -32601, "Method not found");
  }

  return {
    handle,
    tools: TOOL_DEFINITIONS.map(clone),
    get protocolVersion() {
      return negotiatedProtocolVersion;
    },
  };
}

export async function runStdio(server, { input = process.stdin, output = process.stdout } = {}) {
  const readline = createInterface({ input, crlfDelay: Infinity });
  let queue = Promise.resolve();
  readline.on("line", (line) => {
    queue = queue.then(async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        output.write(`${JSON.stringify(jsonRpcError(null, -32700, "Parse error"))}\n`);
        return;
      }
      try {
        const result = await server.handle(message);
        if (result !== null) output.write(`${JSON.stringify(result)}\n`);
      } catch (error) {
        process.stderr.write(`Loom MCP server error: ${safeMessage(error?.message ?? error)}\n`);
        if (isRecord(message) && Object.hasOwn(message, "id")) {
          output.write(`${JSON.stringify(jsonRpcError(message.id, -32603, "Internal server error"))}\n`);
        }
      }
    });
  });
  await new Promise((resolveClose, rejectClose) => {
    readline.once("close", () => queue.then(resolveClose, rejectClose));
    input.once("error", rejectClose);
  });
}

async function start() {
  const server = await createLoomMcpServer();
  await runStdio(server);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  start().catch((error) => {
    process.stderr.write(`Loom MCP startup failed: ${safeMessage(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}
