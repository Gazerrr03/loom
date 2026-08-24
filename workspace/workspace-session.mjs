import { openCore, assertCoreState } from "../core/diagram-core.mjs";

const STATUS = new Set([
  "idle",
  "loading",
  "ready",
  "dirty",
  "saving",
  "streaming",
  "error",
  "cancelled",
]);
const SELECTION_KINDS = new Set(["node", "edge", "group", "annotation"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertFilePath(filePath, { allowNull = false } = {}) {
  if (allowNull && filePath === null) return;
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("workspace filePath must be a non-empty string or null");
  }
}

function assertId(value, path) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]*$/.test(value)) {
    throw new Error(`${path} must be a stable identifier`);
  }
}

function assertCoreSnapshot(core, path = "workspace.core") {
  if (core === null) return null;
  try {
    assertCoreState(core);
  } catch (error) {
    throw new Error(`${path} is invalid`, { cause: error });
  }
  return clone(core);
}

function normalizeError(error, fallbackCode) {
  if (isRecord(error) && typeof error.message === "string") {
    return {
      code: typeof error.code === "string" && error.code.length > 0 ? error.code : fallbackCode,
      message: error.message,
      ...(error.objectIds ? { objectIds: clone(error.objectIds) } : {}),
    };
  }
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  };
}

function event(type, message) {
  return { type, message };
}

function baseState({ filePath = null, core = null } = {}) {
  const snapshot = assertCoreSnapshot(core);
  const revision = snapshot?.revision ?? null;
  return {
    status: snapshot ? "ready" : "idle",
    filePath,
    core: snapshot,
    revision,
    savedRevision: revision,
    dirty: false,
    selection: null,
    error: null,
    stream: null,
    lastEvent: null,
  };
}

function assertSelection(selection) {
  if (selection === null) return null;
  if (!isRecord(selection)) throw new TypeError("workspace selection must be an object or null");
  if (!SELECTION_KINDS.has(selection.kind)) throw new Error(`workspace selection kind is unsupported: ${String(selection.kind)}`);
  assertId(selection.id, "workspace selection.id");
  return { kind: selection.kind, id: selection.id };
}

function assertStream(stream) {
  if (stream === null) return null;
  if (!isRecord(stream)) throw new TypeError("workspace stream must be an object or null");
  assertId(stream.transactionId, "workspace stream.transactionId");
  if (!["active", "previewing"].includes(stream.phase)) throw new Error("workspace stream phase is invalid");
  assertCoreSnapshot(stream.baseCore, "workspace stream.baseCore");
  if (stream.previewCore !== null) assertCoreSnapshot(stream.previewCore, "workspace stream.previewCore");
  if (typeof stream.baseDirty !== "boolean") throw new Error("workspace stream.baseDirty must be boolean");
  return stream;
}

/** Validate the public Workspace session state and its recovery invariants. */
export function assertWorkspaceSession(session) {
  if (!isRecord(session)) throw new TypeError("workspace session must be an object");
  if (!STATUS.has(session.status)) throw new Error(`workspace status is unsupported: ${String(session.status)}`);
  assertFilePath(session.filePath, { allowNull: true });
  assertCoreSnapshot(session.core);
  if (!(session.revision === null || typeof session.revision === "string")) {
    throw new Error("workspace revision must be null or a string");
  }
  if (!(session.savedRevision === null || typeof session.savedRevision === "string")) {
    throw new Error("workspace savedRevision must be null or a string");
  }
  if (typeof session.dirty !== "boolean") throw new Error("workspace dirty must be boolean");
  assertSelection(session.selection);
  assertStream(session.stream);
  if (session.status === "streaming" && session.stream === null) {
    throw new Error("streaming workspace must contain a stream session");
  }
  if (session.status !== "streaming" && session.stream !== null) {
    throw new Error("non-streaming workspace must not contain a stream session");
  }
  if (session.status === "idle" && session.core !== null) throw new Error("idle workspace must not contain a core");
  if (session.status === "loading" && session.core !== null) throw new Error("loading workspace must not contain a core");
  if (["ready", "dirty", "saving", "streaming", "cancelled"].includes(session.status) && session.core === null) {
    throw new Error(`${session.status} workspace must contain a core`);
  }
  if (session.status === "ready" && session.dirty) throw new Error("ready workspace cannot be dirty");
  if (session.status === "dirty" && !session.dirty) throw new Error("dirty workspace must be dirty");
  return session;
}

function nextState(session, patch) {
  assertWorkspaceSession(session);
  const next = {
    ...clone(session),
    ...clone(patch),
  };
  assertWorkspaceSession(next);
  return next;
}

/** Create an idle session, or a ready session around an already validated Core state. */
export function createWorkspaceSession(options = {}) {
  assertFilePath(options.filePath ?? null, { allowNull: true });
  return assertWorkspaceSession(baseState({ filePath: options.filePath ?? null, core: options.coreState ?? null }));
}

/** Start opening a file. No invalid artifact can enter an editing state. */
export function beginWorkspaceLoad(session, filePath) {
  assertWorkspaceSession(session);
  assertFilePath(filePath);
  if (["loading", "saving", "streaming"].includes(session.status)) {
    throw new Error(`cannot open a file while workspace is ${session.status}`);
  }
  if (session.status === "dirty") throw new Error("cannot open a file while workspace has unsaved changes");
  return nextState(session, {
    status: "loading",
    filePath,
    core: null,
    revision: null,
    savedRevision: null,
    dirty: false,
    selection: null,
    error: null,
    stream: null,
    lastEvent: event("loading", `正在打开 ${filePath}`),
  });
}

/** Complete a load with a validated Core snapshot. */
export function completeWorkspaceLoad(session, coreState) {
  assertWorkspaceSession(session);
  if (session.status !== "loading") throw new Error("workspace load is not active");
  const core = assertCoreSnapshot(coreState, "workspace.core");
  return nextState(session, {
    status: "ready",
    core,
    revision: core.revision,
    savedRevision: core.revision,
    dirty: false,
    selection: null,
    error: null,
    stream: null,
    lastEvent: event("loaded", `已打开 revision ${core.revision ?? "未保存"}`),
  });
}

/** Record a load failure without retaining a possibly invalid artifact. */
export function failWorkspaceLoad(session, error) {
  assertWorkspaceSession(session);
  if (session.status !== "loading") throw new Error("workspace load is not active");
  return nextState(session, {
    status: "error",
    core: null,
    revision: null,
    savedRevision: null,
    dirty: false,
    selection: null,
    error: normalizeError(error, "workspace-load-failed"),
    stream: null,
    lastEvent: event("load-failed", "打开失败，未进入编辑态"),
  });
}

/** Open a file through Core and return a user-visible session in every outcome. */
export async function openWorkspace(filePath, options = {}) {
  const loading = beginWorkspaceLoad(createWorkspaceSession(), filePath);
  try {
    return completeWorkspaceLoad(loading, await openCore(filePath, options));
  } catch (error) {
    return failWorkspaceLoad(loading, error);
  }
}

/** Apply an in-memory Core change while keeping the previous saved revision. */
export function applyWorkspaceDraft(session, coreState) {
  assertWorkspaceSession(session);
  if (!["ready", "dirty"].includes(session.status)) {
    throw new Error(`workspace cannot be edited while it is ${session.status}`);
  }
  const core = assertCoreSnapshot(coreState, "workspace.core");
  return nextState(session, {
    status: "dirty",
    core,
    revision: core.revision,
    dirty: true,
    error: null,
    lastEvent: event("changed", "有未保存修改"),
  });
}

/** Enter the save phase; callers must provide the persisted Core result on completion. */
export function beginWorkspaceSave(session) {
  assertWorkspaceSession(session);
  if (session.status !== "dirty") throw new Error("only a dirty workspace can be saved");
  return nextState(session, {
    status: "saving",
    error: null,
    lastEvent: event("saving", "正在保存"),
  });
}

/** Mark a successful save and make the returned revision the new clean baseline. */
export function completeWorkspaceSave(session, coreState) {
  assertWorkspaceSession(session);
  if (session.status !== "saving") throw new Error("workspace save is not active");
  const core = assertCoreSnapshot(coreState, "workspace.core");
  return nextState(session, {
    status: "ready",
    core,
    revision: core.revision,
    savedRevision: core.revision,
    dirty: false,
    error: null,
    lastEvent: event("saved", `已保存 revision ${core.revision ?? "未保存"}`),
  });
}

/** Keep the valid dirty Core after a save failure and expose the error. */
export function failWorkspaceSave(session, error) {
  assertWorkspaceSession(session);
  if (session.status !== "saving") throw new Error("workspace save is not active");
  return nextState(session, {
    status: "error",
    dirty: true,
    error: normalizeError(error, "workspace-save-failed"),
    lastEvent: event("save-failed", "保存失败，当前修改仍可恢复"),
  });
}

/** Select one semantic object; Renderer-private selection state is never stored. */
export function setWorkspaceSelection(session, selection) {
  assertWorkspaceSession(session);
  if (!["ready", "dirty"].includes(session.status)) {
    throw new Error(`workspace selection is unavailable while it is ${session.status}`);
  }
  return nextState(session, { selection: assertSelection(selection), lastEvent: event("selection-changed", "选择已更新") });
}

/** Start a Codex stream while retaining the canonical pre-stream snapshot. */
export function beginWorkspaceStream(session, { transactionId }) {
  assertWorkspaceSession(session);
  if (!["ready", "dirty"].includes(session.status)) {
    throw new Error(`workspace stream cannot start while it is ${session.status}`);
  }
  assertId(transactionId, "workspace transactionId");
  const baseCore = assertCoreSnapshot(session.core, "workspace stream.baseCore");
  return nextState(session, {
    status: "streaming",
    error: null,
    stream: {
      phase: "active",
      transactionId,
      baseCore,
      previewCore: null,
      baseDirty: session.dirty,
    },
    lastEvent: event("streaming", "Codex 修改正在流入 Workspace"),
  });
}

/** Update only the ephemeral streaming preview; canonical session.core stays unchanged. */
export function updateWorkspaceStream(session, previewCore) {
  assertWorkspaceSession(session);
  if (session.status !== "streaming") throw new Error("workspace stream is not active");
  const core = assertCoreSnapshot(previewCore, "workspace stream.previewCore");
  return nextState(session, {
    stream: { ...session.stream, phase: "previewing", previewCore: core },
    lastEvent: event("stream-preview", "Codex 修改预览已更新"),
  });
}

/** Commit one successful Codex transaction and replace the saved baseline. */
export function completeWorkspaceStream(session, committedCore) {
  assertWorkspaceSession(session);
  if (session.status !== "streaming") throw new Error("workspace stream is not active");
  const core = assertCoreSnapshot(committedCore, "workspace.core");
  return nextState(session, {
    status: "ready",
    core,
    revision: core.revision,
    savedRevision: core.revision,
    dirty: false,
    error: null,
    stream: null,
    lastEvent: event("stream-completed", `Codex 修改已提交 revision ${core.revision ?? "未保存"}`),
  });
}

function restoreStream(session, type, error = null) {
  const stream = session.stream;
  const core = assertCoreSnapshot(stream.baseCore, "workspace stream.baseCore");
  return nextState(session, {
    status: error ? "error" : "cancelled",
    core,
    revision: core.revision,
    dirty: stream.baseDirty,
    error,
    stream: null,
    lastEvent: event(type, error ? "Codex 修改失败，已恢复上一份合法 Artifact" : "Codex 修改已取消，已恢复上一份合法 Artifact"),
  });
}

/** Restore the pre-stream Core after a failed Codex transaction. */
export function failWorkspaceStream(session, error) {
  assertWorkspaceSession(session);
  if (session.status !== "streaming") throw new Error("workspace stream is not active");
  return restoreStream(session, "stream-failed", normalizeError(error, "workspace-stream-failed"));
}

/** Restore the pre-stream Core after cancellation without leaving a partial write. */
export function cancelWorkspaceStream(session) {
  assertWorkspaceSession(session);
  if (session.status !== "streaming") throw new Error("workspace stream is not active");
  return restoreStream(session, "stream-cancelled");
}

/** Dismiss a visible error/cancelled state without changing the valid Core snapshot. */
export function resumeWorkspace(session) {
  assertWorkspaceSession(session);
  if (!["error", "cancelled"].includes(session.status)) return session;
  const status = session.core === null ? "idle" : session.dirty ? "dirty" : "ready";
  return nextState(session, {
    status,
    error: null,
    lastEvent: event("resumed", "Workspace 已恢复可操作状态"),
  });
}

/** Return what the canvas may display; streaming previews never become canonical automatically. */
export function getWorkspaceVisibleCore(session) {
  assertWorkspaceSession(session);
  return clone(session.status === "streaming" ? (session.stream.previewCore ?? session.core) : session.core);
}

export function isWorkspaceEditable(session) {
  assertWorkspaceSession(session);
  return ["ready", "dirty"].includes(session.status);
}
