import { assertCoreState, applyCoreCommand } from "../core/diagram-core.mjs";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertId(value, path) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]*$/.test(value)) {
    throw new Error(`${path} must be a stable identifier`);
  }
}

function assertEntry(entry, path) {
  if (!isRecord(entry)) throw new TypeError(`${path} must be an object`);
  assertCoreState(entry.before);
  assertCoreState(entry.after);
  assertId(entry.transactionId, `${path}.transactionId`);
  if (typeof entry.kind !== "string" || entry.kind.length === 0) throw new Error(`${path}.kind must be non-empty`);
}

function sameCore(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Validate one bounded, immutable history state. */
export function assertHistoryState(history) {
  if (!isRecord(history)) throw new TypeError("history must be an object");
  assertCoreState(history.present);
  if (!Array.isArray(history.past) || !Array.isArray(history.future)) throw new Error("history past/future must be arrays");
  if (!Number.isInteger(history.limit) || history.limit < 1) throw new Error("history.limit must be a positive integer");
  history.past.forEach((entry, index) => assertEntry(entry, `history.past[${index}]`));
  history.future.forEach((entry, index) => assertEntry(entry, `history.future[${index}]`));
  return history;
}

/** Create an empty undo/redo stack around one valid Core snapshot. */
export function createHistory(coreState, { limit = 100 } = {}) {
  assertCoreState(coreState);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("history.limit must be a positive integer");
  return assertHistoryState({
    past: [],
    present: clone(coreState),
    future: [],
    limit,
    lastEvent: null,
  });
}

function nextHistory(history, patch) {
  assertHistoryState(history);
  const next = { ...clone(history), ...clone(patch) };
  assertHistoryState(next);
  return next;
}

/** Commit one transaction. Preview frames should call no history function. */
export function commitHistoryTransaction(history, nextCore, { transactionId, kind = "workspace.edit" } = {}) {
  assertHistoryState(history);
  assertCoreState(nextCore);
  assertId(transactionId, "history transactionId");
  if (typeof kind !== "string" || kind.length === 0) throw new Error("history kind must be non-empty");
  if (sameCore(history.present, nextCore)) {
    return nextHistory(history, { lastEvent: { type: "noop", transactionId, kind } });
  }
  const entry = {
    before: clone(history.present),
    after: clone(nextCore),
    transactionId,
    kind,
  };
  const past = [...history.past, entry].slice(-history.limit);
  return nextHistory(history, {
    past,
    present: clone(nextCore),
    future: [],
    lastEvent: { type: "committed", transactionId, kind },
  });
}

/** Apply one command and record it as exactly one transaction. */
export function commitHistoryCommand(history, command, apply = applyCoreCommand) {
  assertHistoryState(history);
  if (!isRecord(command)) throw new TypeError("history command must be an object");
  const nextCore = apply(history.present, command);
  return commitHistoryTransaction(history, nextCore, {
    transactionId: command.gestureId ?? command.transactionId,
    kind: command.type ?? "workspace.edit",
  });
}

/** Move one transaction from past to future without mutating either snapshot. */
export function undoHistory(history) {
  assertHistoryState(history);
  if (history.past.length === 0) return nextHistory(history, { lastEvent: { type: "undo-empty" } });
  const entry = history.past.at(-1);
  const past = history.past.slice(0, -1);
  const future = [...history.future, clone(entry)].slice(-history.limit);
  return nextHistory(history, {
    past,
    present: clone(entry.before),
    future,
    lastEvent: { type: "undone", transactionId: entry.transactionId, kind: entry.kind },
  });
}

/** Re-apply one transaction from future. */
export function redoHistory(history) {
  assertHistoryState(history);
  if (history.future.length === 0) return nextHistory(history, { lastEvent: { type: "redo-empty" } });
  const entry = history.future.at(-1);
  const future = history.future.slice(0, -1);
  const past = [...history.past, clone(entry)].slice(-history.limit);
  return nextHistory(history, {
    past,
    present: clone(entry.after),
    future,
    lastEvent: { type: "redone", transactionId: entry.transactionId, kind: entry.kind },
  });
}

export function canUndo(history) {
  assertHistoryState(history);
  return history.past.length > 0;
}

export function canRedo(history) {
  assertHistoryState(history);
  return history.future.length > 0;
}

