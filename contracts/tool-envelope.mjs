import { assertDiagramError, createDiagramError } from "./diagram-error.mjs";

const TOOL_CALL_FORMAT = "loom.mcp.tool-call";
const TOOL_RESULT_FORMAT = "loom.mcp.tool-result";
const SCHEMA_VERSION = "0.1.0";
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const REQUEST_ID_PATTERN = /^\S{1,160}$/;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const PRIVATE_KEYS = /(?:runtime|scene|mesh|geometry|material|gpu|shader|camera|cache|renderer)/i;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path} contains unsupported field: ${key}`);
  }
}

function assertSafePayload(value, path = "payload", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} must not contain NaN or Infinity`);
    return value;
  }
  if (!isRecord(value) && !Array.isArray(value)) throw new Error(`${path} contains a non-JSON value`);
  if (seen.has(value)) throw new Error(`${path} contains a cyclic value`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertSafePayload(item, `${path}[${index}]`, seen));
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error(`${path} contains a runtime object`);
    for (const [key, child] of Object.entries(value)) {
      if (PRIVATE_KEYS.test(key)) throw new Error(`${path}.${key} exposes Renderer private state`);
      assertSafePayload(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
  return value;
}

function assertToolName(value) {
  if (typeof value !== "string" || !TOOL_NAME_PATTERN.test(value)) throw new Error("toolName must be a stable dotted identifier");
}

function assertRequestId(value) {
  if (typeof value !== "string" || !REQUEST_ID_PATTERN.test(value)) throw new Error("requestId must be a non-empty token of at most 160 characters");
}

function assertRevision(value, path) {
  if (value !== null && (typeof value !== "string" || value.length === 0)) throw new Error(`${path} must be a non-empty string or null`);
}

function assertEffect(effects) {
  if (!isRecord(effects)) throw new TypeError("effects must be an object");
  assertExactKeys(effects, new Set(["kind", "paths", "changed", "reversible"]), "effects");
  if (!["none", "read", "write"].includes(effects.kind)) throw new Error("effects.kind is unsupported");
  if (!Array.isArray(effects.paths)) throw new Error("effects.paths must be an array");
  for (const [index, path] of effects.paths.entries()) {
    if (typeof path !== "string" || !SAFE_PATH_PATTERN.test(path) || path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`effects.paths[${index}] must be a safe relative logical path`);
    }
  }
  if (typeof effects.changed !== "boolean" || typeof effects.reversible !== "boolean") throw new Error("effects.changed and effects.reversible must be boolean");
  if (effects.kind === "none" && (effects.paths.length > 0 || effects.changed)) throw new Error("none effects cannot change paths");
  if (effects.kind === "read" && effects.changed) throw new Error("read effects cannot change an artifact");
  return effects;
}

export function assertToolCall(call) {
  if (!isRecord(call)) throw new TypeError("tool call must be an object");
  assertExactKeys(call, new Set(["format", "schemaVersion", "toolName", "requestId", "input", "expectedRevision", "dryRun"]), "toolCall");
  if (call.format !== TOOL_CALL_FORMAT) throw new Error(`Unsupported tool call format: ${String(call.format)}`);
  if (call.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported tool call schemaVersion: ${String(call.schemaVersion)}`);
  assertToolName(call.toolName);
  assertRequestId(call.requestId);
  if (!isRecord(call.input)) throw new Error("toolCall.input must be an object");
  assertSafePayload(call.input, "toolCall.input");
  assertRevision(call.expectedRevision, "toolCall.expectedRevision");
  if (typeof call.dryRun !== "boolean") throw new Error("toolCall.dryRun must be boolean");
  return call;
}

export function assertToolResult(result) {
  if (!isRecord(result)) throw new TypeError("tool result must be an object");
  assertExactKeys(result, new Set(["format", "schemaVersion", "toolName", "requestId", "status", "result", "error", "revision", "effects"]), "toolResult");
  if (result.format !== TOOL_RESULT_FORMAT) throw new Error(`Unsupported tool result format: ${String(result.format)}`);
  if (result.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported tool result schemaVersion: ${String(result.schemaVersion)}`);
  assertToolName(result.toolName);
  assertRequestId(result.requestId);
  if (!["ok", "error"].includes(result.status)) throw new Error("toolResult.status must be ok or error");
  assertRevision(result.revision, "toolResult.revision");
  assertEffect(result.effects);
  if (result.status === "ok") {
    if (!isRecord(result.result) || result.error !== null) throw new Error("successful tool result requires result object and null error");
    assertSafePayload(result.result, "toolResult.result");
  } else {
    if (result.result !== null) throw new Error("error tool result must set result to null");
    assertDiagramError(result.error);
  }
  return result;
}

export function assertToolEnvelope(value) {
  if (!isRecord(value)) throw new TypeError("tool envelope must be an object");
  if (value.format === TOOL_CALL_FORMAT) return assertToolCall(value);
  if (value.format === TOOL_RESULT_FORMAT) return assertToolResult(value);
  throw new Error(`Unsupported tool envelope format: ${String(value.format)}`);
}

export function createToolCall({ toolName, requestId, input = {}, expectedRevision = null, dryRun = false }) {
  return assertToolCall({
    format: TOOL_CALL_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    toolName,
    requestId,
    input,
    expectedRevision,
    dryRun,
  });
}

export function createToolResult({ toolName, requestId, result = {}, revision = null, effects = { kind: "none", paths: [], changed: false, reversible: true }, error = null }) {
  const status = error === null ? "ok" : "error";
  const value = {
    format: TOOL_RESULT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    toolName,
    requestId,
    status,
    result: status === "ok" ? result : null,
    error: status === "error" ? error : null,
    revision,
    effects,
  };
  return assertToolResult(value);
}

export function createToolError({ toolName, requestId, code, message, objectIds = [], fieldPath = null, recoverable = true, suggestedAction = null, cause = null, revision = null, effects = { kind: "none", paths: [], changed: false, reversible: true } }) {
  const error = createDiagramError({ code, message, objectIds, fieldPath, recoverable, suggestedAction, cause });
  return createToolResult({ toolName, requestId, revision, effects, error });
}

export { SCHEMA_VERSION, TOOL_CALL_FORMAT, TOOL_RESULT_FORMAT };
