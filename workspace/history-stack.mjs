function clone(value) {
  return structuredClone(value);
}

function assertRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function assertId(value, path) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]*$/.test(value)) throw new Error(`${path} must be a stable identifier`);
}

function assertArtifact(value, path = "artifact") {
  assertRecord(value, path);
  if (value.format !== "loom.diagram") throw new Error(`${path}.format is unsupported`);
  if (typeof value.id !== "string" || value.id.length === 0) throw new Error(`${path}.id is required`);
  if (!value.semantic || !value.layout) throw new Error(`${path} must contain semantic and layout data`);
  return value;
}

function sameArtifact(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertEntry(entry, path) {
  assertRecord(entry, path);
  assertArtifact(entry.before, `${path}.before`);
  assertArtifact(entry.after, `${path}.after`);
  assertId(entry.transactionId, `${path}.transactionId`);
  if (typeof entry.kind !== "string" || entry.kind.length === 0) throw new Error(`${path}.kind must be non-empty`);
}

export function assertHistoryStack(history) {
  assertRecord(history, "history");
  assertArtifact(history.present, "history.present");
  if (!Array.isArray(history.past) || !Array.isArray(history.future)) throw new Error("history past/future must be arrays");
  if (!Number.isInteger(history.limit) || history.limit < 1) throw new Error("history.limit must be a positive integer");
  history.past.forEach((entry, index) => assertEntry(entry, `history.past[${index}]`));
  history.future.forEach((entry, index) => assertEntry(entry, `history.future[${index}]`));
  return history;
}

export function createHistoryStack(artifact, { limit = 100 } = {}) {
  assertArtifact(artifact);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("history.limit must be a positive integer");
  return assertHistoryStack({ past: [], present: clone(artifact), future: [], limit, lastEvent: null });
}

function nextHistory(history, patch) {
  assertHistoryStack(history);
  const next = { ...clone(history), ...clone(patch) };
  return assertHistoryStack(next);
}

/** Replace the current saved/present snapshot without creating an edit entry. */
export function replaceHistoryPresent(history, artifact) {
  assertArtifact(artifact);
  return nextHistory(history, { present: clone(artifact) });
}

/** Commit one complete Workspace transaction; preview frames never call this. */
export function commitHistoryTransaction(history, artifact, { transactionId, kind = "workspace.edit" } = {}) {
  assertHistoryStack(history);
  assertArtifact(artifact);
  assertId(transactionId, "history.transactionId");
  if (typeof kind !== "string" || kind.length === 0) throw new Error("history.kind must be non-empty");
  if (sameArtifact(history.present, artifact)) return nextHistory(history, { lastEvent: { type: "noop", transactionId, kind } });
  const entry = { before: clone(history.present), after: clone(artifact), transactionId, kind };
  return nextHistory(history, {
    past: [...history.past, entry].slice(-history.limit),
    present: clone(artifact),
    future: [],
    lastEvent: { type: "committed", transactionId, kind },
  });
}

export function undoHistoryStack(history) {
  assertHistoryStack(history);
  if (history.past.length === 0) return nextHistory(history, { lastEvent: { type: "undo-empty" } });
  const entry = history.past.at(-1);
  return nextHistory(history, {
    past: history.past.slice(0, -1),
    present: clone(entry.before),
    future: [...history.future, clone(entry)].slice(-history.limit),
    lastEvent: { type: "undone", transactionId: entry.transactionId, kind: entry.kind },
  });
}

export function redoHistoryStack(history) {
  assertHistoryStack(history);
  if (history.future.length === 0) return nextHistory(history, { lastEvent: { type: "redo-empty" } });
  const entry = history.future.at(-1);
  return nextHistory(history, {
    past: [...history.past, clone(entry)].slice(-history.limit),
    present: clone(entry.after),
    future: history.future.slice(0, -1),
    lastEvent: { type: "redone", transactionId: entry.transactionId, kind: entry.kind },
  });
}

export function canUndoHistory(history) {
  assertHistoryStack(history);
  return history.past.length > 0;
}

export function canRedoHistory(history) {
  assertHistoryStack(history);
  return history.future.length > 0;
}
