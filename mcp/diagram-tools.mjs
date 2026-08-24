import { resolve, relative, sep } from "node:path";
import { stat } from "node:fs/promises";
import {
  assertDiagramArtifact,
  createDiagram,
} from "../core/artifact-store.mjs";
import {
  createCoreState,
  openCore,
  saveCore,
} from "../core/diagram-core.mjs";
import {
  assertToolCall,
  createToolError,
  createToolResult,
} from "../contracts/tool-envelope.mjs";

const LIFECYCLE_TOOLS = new Set([
  "diagram.create",
  "diagram.open",
  "diagram.validate",
  "diagram.save",
  "diagram.summary",
]);
const SAFE_LOGICAL_PATH = /^[A-Za-z0-9._/-]+$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function summarizeArtifact(artifact, revision = null) {
  return {
    artifactId: artifact.id,
    title: artifact.metadata.title,
    revision,
    counts: {
      nodes: artifact.semantic.nodes.length,
      edges: artifact.semantic.edges.length,
      groups: artifact.semantic.groups.length,
      annotations: artifact.annotations.length,
      assets: artifact.assets.length,
    },
    componentRefs: [...new Set(artifact.semantic.nodes.map((node) => node.componentRef))].sort(),
    updatedAt: artifact.metadata.updatedAt,
  };
}

function safeMessage(message) {
  return String(message)
    .replace(/(?:\/Users|\/private|\/tmp|\/var|\/home)\/[^\s)]+/g, "[path]")
    .replace(/[A-Za-z]:[\\/][^\s)]+/g, "[path]");
}

function errorCode(error) {
  const message = String(error?.message ?? error);
  if (/revision changed|revision conflict/i.test(message)) return "revision-conflict";
  if (/unsupported|path|input|could not be read/i.test(message)) return "invalid-tool-input";
  return "invalid-envelope";
}

function errorField(toolName) {
  if (toolName === "diagram.open" || toolName === "diagram.summary") return "input.path";
  if (toolName === "diagram.save" || toolName === "diagram.create") return "input.artifact";
  return "input";
}

function resolveLogicalPath(rootDir, logicalPath) {
  if (typeof logicalPath !== "string" || logicalPath.length === 0) throw new Error("input.path must be a non-empty relative path");
  if (!SAFE_LOGICAL_PATH.test(logicalPath) || logicalPath.startsWith("/") || logicalPath.split("/").includes("..")) {
    throw new Error("input.path must be a safe relative logical path");
  }
  const absoluteRoot = resolve(rootDir);
  const absolutePath = resolve(absoluteRoot, logicalPath);
  const relativePath = relative(absoluteRoot, absolutePath);
  if (relativePath.startsWith(`..${sep}`) || relativePath === ".." || relativePath.includes(`${sep}..${sep}`)) {
    throw new Error("input.path escapes the configured artifact root");
  }
  return absolutePath;
}

function requireArtifact(input) {
  if (!isRecord(input?.artifact)) throw new Error("input.artifact must be an object");
  return createDiagram(input.artifact);
}

function effects(kind, logicalPath, changed, reversible = true) {
  return {
    kind,
    paths: logicalPath ? [logicalPath] : [],
    changed,
    reversible,
  };
}

function safeEffectsPath(logicalPath) {
  if (typeof logicalPath !== "string" || !SAFE_LOGICAL_PATH.test(logicalPath) || logicalPath.startsWith("/") || logicalPath.split("/").includes("..")) {
    return null;
  }
  return logicalPath;
}

/**
 * Renderer-independent lifecycle tools for Codex. Every operation returns the
 * shared tool envelope; no tool exposes a filesystem absolute path or runtime
 * Renderer object.
 */
export function createDiagramToolService({ rootDir = process.cwd() } = {}) {
  const artifactRoot = resolve(rootDir);

  async function execute(call) {
    assertToolCall(call);
    if (!LIFECYCLE_TOOLS.has(call.toolName)) {
      return createToolError({
        toolName: call.toolName,
        requestId: call.requestId,
        code: "invalid-tool-input",
        message: `Unsupported Diagram lifecycle tool: ${call.toolName}`,
        fieldPath: "toolName",
        suggestedAction: "Use one of diagram.create, diagram.open, diagram.validate, diagram.save, or diagram.summary.",
      });
    }

    try {
      if (call.toolName === "diagram.open") return await open(call);
      if (call.toolName === "diagram.summary") return await summary(call);
      if (call.toolName === "diagram.validate") return await validate(call);
      if (call.toolName === "diagram.create") return await create(call);
      return await save(call);
    } catch (error) {
      return createToolError({
        toolName: call.toolName,
        requestId: call.requestId,
        code: errorCode(error),
        message: safeMessage(error.message ?? error),
        fieldPath: errorField(call.toolName),
        recoverable: true,
        suggestedAction: errorCode(error) === "revision-conflict"
          ? "Reload the current revision before trying again."
          : "Fix the input and retry the lifecycle operation.",
        revision: call.expectedRevision ?? null,
        effects: effects(call.toolName === "diagram.save" ? "write" : "read", safeEffectsPath(call.input.path), false),
      });
    }
  }

  async function open(call) {
    const filePath = resolveLogicalPath(artifactRoot, call.input.path);
    const state = await openCore(filePath);
    return createToolResult({
      toolName: call.toolName,
      requestId: call.requestId,
      result: { artifact: clone(state.artifact), summary: summarizeArtifact(state.artifact, state.revision) },
      revision: state.revision,
      effects: effects("read", call.input.path, false),
    });
  }

  async function summary(call) {
    const filePath = resolveLogicalPath(artifactRoot, call.input.path);
    const state = await openCore(filePath);
    return createToolResult({
      toolName: call.toolName,
      requestId: call.requestId,
      result: { summary: summarizeArtifact(state.artifact, state.revision) },
      revision: state.revision,
      effects: effects("read", call.input.path, false),
    });
  }

  async function validate(call) {
    let artifact;
    let logicalPath = null;
    let revision = null;
    if (call.input.path !== undefined) {
      logicalPath = call.input.path;
      const state = await openCore(resolveLogicalPath(artifactRoot, logicalPath));
      artifact = state.artifact;
      revision = state.revision;
    } else {
      artifact = requireArtifact(call.input);
      const state = createCoreState(artifact);
      artifact = state.artifact;
    }
    assertDiagramArtifact(artifact);
    return createToolResult({
      toolName: call.toolName,
      requestId: call.requestId,
      result: { valid: true, summary: summarizeArtifact(artifact, revision) },
      revision,
      effects: effects(logicalPath ? "read" : "none", logicalPath, false),
    });
  }

  async function create(call) {
    const artifact = requireArtifact(call.input);
    const logicalPath = call.input.path ?? null;
    const filePath = logicalPath === null ? null : resolveLogicalPath(artifactRoot, logicalPath);
    if (call.dryRun || logicalPath === null) {
      const state = createCoreState(artifact);
      return createToolResult({
        toolName: call.toolName,
        requestId: call.requestId,
        result: { created: false, dryRun: call.dryRun, artifact: clone(state.artifact), summary: summarizeArtifact(state.artifact) },
        revision: null,
        effects: effects("none", null, false),
      });
    }
    try {
      await stat(filePath);
      throw new Error("Diagram path already exists; use diagram.save for an existing file");
    } catch (error) {
      if (error.message !== "Diagram path already exists; use diagram.save for an existing file" && error.code !== "ENOENT") throw error;
      if (error.message === "Diagram path already exists; use diagram.save for an existing file") throw error;
    }
    const saved = await saveCore(filePath, artifact, { now: new Date() });
    return createToolResult({
      toolName: call.toolName,
      requestId: call.requestId,
      result: { created: true, artifact: clone(saved.artifact), summary: summarizeArtifact(saved.artifact, saved.revision) },
      revision: saved.revision,
      effects: effects("write", logicalPath, true),
    });
  }

  async function save(call) {
    const artifact = requireArtifact(call.input);
    const logicalPath = call.input.path;
    const filePath = resolveLogicalPath(artifactRoot, logicalPath);
    if (call.dryRun) {
      const state = createCoreState(artifact);
      return createToolResult({
        toolName: call.toolName,
        requestId: call.requestId,
        result: { wouldWrite: true, summary: summarizeArtifact(state.artifact, call.expectedRevision) },
        revision: call.expectedRevision,
        effects: effects("none", null, false),
      });
    }
    const saved = await saveCore(filePath, artifact, {
      expectedRevision: call.expectedRevision ?? undefined,
      now: new Date(),
    });
    return createToolResult({
      toolName: call.toolName,
      requestId: call.requestId,
      result: { saved: true, artifact: clone(saved.artifact), summary: summarizeArtifact(saved.artifact, saved.revision) },
      revision: saved.revision,
      effects: effects("write", logicalPath, true),
    });
  }

  return {
    rootDir: artifactRoot,
    execute,
    resolveLogicalPath: (logicalPath) => resolveLogicalPath(artifactRoot, logicalPath),
  };
}
