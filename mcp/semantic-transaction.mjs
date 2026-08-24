import { createHash } from "node:crypto";

import { assertCoreState, reflowCore } from "../core/diagram-core.mjs";
import { applySemanticBatch, assertSemanticCommand } from "../contracts/semantic-commands.mjs";
import { assertHistoryState, commitHistoryTransaction } from "../workspace/history.mjs";

const TRANSACTION_PHASES = new Set(["prepared", "previewing", "committed", "cancelled", "failed"]);
const TRANSACTION_KIND = "codex.semantic.batch";

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

function assertRevision(value, path) {
  if (value !== null && (typeof value !== "string" || value.length === 0)) {
    throw new Error(`${path} must be a non-empty string or null`);
  }
}

function assertCoreSnapshot(core, path) {
  try {
    assertCoreState(core);
  } catch (error) {
    throw new Error(`${path} is invalid`, { cause: error });
  }
  return clone(core);
}

function hashArtifact(artifact) {
  const bytes = `${JSON.stringify(artifact, null, 2)}\n`;
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function emptyOverrides() {
  return { nodes: {}, routes: {}, groups: {}, view: {} };
}

function withOverridePolicy(core, preserveOverrides) {
  if (preserveOverrides) return core;
  const next = clone(core);
  next.artifact.layout.overrides = emptyOverrides();
  return next;
}

function normalizeCommands(commands, baseRevision) {
  if (!Array.isArray(commands)) throw new TypeError("semantic transaction commands must be an array");
  const next = commands.map((command) => {
    assertSemanticCommand(command);
    if (command.baseRevision !== undefined && command.baseRevision !== baseRevision) {
      throw new Error("semantic transaction base revision changed before preview");
    }
    return clone(command);
  });
  return next;
}

function summaryFor({ transactionId, baseRevision, commands, affectedIds = [], changed = false, preserveOverrides }) {
  return {
    transactionId,
    baseRevision,
    commandCount: commands.length,
    affectedIds: [...affectedIds],
    changed,
    preserveHumanOverrides: preserveOverrides,
    effects: {
      kind: "memory",
      fileWrite: false,
      historyEntries: changed ? 1 : 0,
    },
  };
}

function normalizeError(error) {
  return {
    code: typeof error?.code === "string" && error.code.length > 0 ? error.code : "semantic-transaction-failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

function assertSummary(summary) {
  if (!isRecord(summary)) throw new TypeError("semantic transaction summary must be an object");
  assertId(summary.transactionId, "transaction.summary.transactionId");
  assertRevision(summary.baseRevision, "transaction.summary.baseRevision");
  if (!Number.isInteger(summary.commandCount) || summary.commandCount < 0) throw new Error("transaction.summary.commandCount must be a non-negative integer");
  if (!Array.isArray(summary.affectedIds) || summary.affectedIds.some((id) => typeof id !== "string")) throw new Error("transaction.summary.affectedIds must be string IDs");
  if (typeof summary.changed !== "boolean") throw new Error("transaction.summary.changed must be boolean");
  if (typeof summary.preserveHumanOverrides !== "boolean") throw new Error("transaction.summary.preserveHumanOverrides must be boolean");
  if (!isRecord(summary.effects) || summary.effects.kind !== "memory" || summary.effects.fileWrite !== false) {
    throw new Error("transaction.summary.effects must describe a memory-only preview");
  }
}

/** Validate the immutable public state of one semantic transaction. */
export function assertSemanticTransaction(transaction) {
  if (!isRecord(transaction)) throw new TypeError("semantic transaction must be an object");
  assertId(transaction.transactionId, "transaction.transactionId");
  if (!TRANSACTION_PHASES.has(transaction.phase)) throw new Error(`transaction phase is unsupported: ${String(transaction.phase)}`);
  assertCoreSnapshot(transaction.baseCore, "transaction.baseCore");
  assertRevision(transaction.baseRevision, "transaction.baseRevision");
  if (transaction.baseRevision !== transaction.baseCore.revision) throw new Error("transaction.baseRevision must match transaction.baseCore.revision");
  if (typeof transaction.preserveOverrides !== "boolean") throw new Error("transaction.preserveOverrides must be boolean");
  if (!Array.isArray(transaction.commands)) throw new Error("transaction.commands must be an array");
  transaction.commands.forEach(assertSemanticCommand);
  if (transaction.previewCore !== null) assertCoreSnapshot(transaction.previewCore, "transaction.previewCore");
  if (transaction.committedCore !== null) assertCoreSnapshot(transaction.committedCore, "transaction.committedCore");
  assertRevision(transaction.committedRevision, "transaction.committedRevision");
  if (transaction.committedCore !== null && transaction.committedRevision !== transaction.committedCore.revision) {
    throw new Error("transaction.committedRevision must match transaction.committedCore.revision");
  }
  if (transaction.history !== null) assertHistoryState(transaction.history);
  if (transaction.error !== null) {
    if (!isRecord(transaction.error) || typeof transaction.error.code !== "string" || typeof transaction.error.message !== "string") {
      throw new Error("transaction.error must contain code and message");
    }
  }
  assertSummary(transaction.summary);
  if (transaction.summary.baseRevision !== transaction.baseRevision) throw new Error("transaction.summary.baseRevision must match transaction.baseRevision");
  if (transaction.summary.preserveHumanOverrides !== transaction.preserveOverrides) throw new Error("transaction.summary.preserveHumanOverrides must match transaction.preserveOverrides");
  if (transaction.phase === "prepared" && transaction.previewCore !== null) throw new Error("prepared transaction cannot contain a preview");
  if (transaction.phase === "previewing" && transaction.previewCore === null) throw new Error("previewing transaction must contain a preview");
  if (transaction.phase === "committed" && (transaction.committedCore === null || transaction.committedRevision === null)) throw new Error("committed transaction must contain a committed Core and revision");
  if (["cancelled", "failed"].includes(transaction.phase) && transaction.previewCore !== null) throw new Error(`${transaction.phase} transaction must discard its preview`);
  return transaction;
}

function nextTransaction(transaction, patch) {
  assertSemanticTransaction(transaction);
  const next = { ...clone(transaction), ...clone(patch) };
  return assertSemanticTransaction(next);
}

/** Prepare a dry-run transaction without writing a file or changing Core. */
export function beginSemanticTransaction(baseCore, commands, { transactionId, preserveOverrides = true, history = null } = {}) {
  assertId(transactionId, "transactionId");
  const base = assertCoreSnapshot(baseCore, "transaction.baseCore");
  const normalized = normalizeCommands(commands, base.revision);
  if (history !== null) {
    assertHistoryState(history);
    if (JSON.stringify(history.present) !== JSON.stringify(base)) throw new Error("transaction history must start at base Core");
  }
  const transaction = {
    transactionId,
    phase: "prepared",
    baseCore: base,
    baseRevision: base.revision,
    commands: normalized,
    preserveOverrides,
    previewCore: null,
    committedCore: null,
    committedRevision: null,
    history: history === null ? null : clone(history),
    error: null,
    summary: summaryFor({ transactionId, baseRevision: base.revision, commands: normalized, preserveOverrides, changed: false }),
  };
  return assertSemanticTransaction(transaction);
}

/**
 * Build an ephemeral preview from the original base Core. Supplying commands
 * again models streamed frames: each frame replaces the previous frame and
 * never compounds against an already-previewed Artifact.
 */
export function previewSemanticTransaction(transaction, { commands = transaction.commands, seed, preserveOverrides } = {}) {
  assertSemanticTransaction(transaction);
  if (!["prepared", "previewing"].includes(transaction.phase)) throw new Error(`transaction cannot preview while it is ${transaction.phase}`);
  const nextCommands = normalizeCommands(commands, transaction.baseRevision);
  const keepOverrides = preserveOverrides ?? transaction.preserveOverrides;
  if (typeof keepOverrides !== "boolean") throw new Error("preserveOverrides must be boolean");
  const applied = applySemanticBatch(transaction.baseCore.artifact, nextCommands);
  const previousForReflow = withOverridePolicy(transaction.baseCore, keepOverrides);
  const preview = reflowCore(previousForReflow, applied.artifact, { seed });
  const previewRevision = hashArtifact(preview.artifact);
  const previewCore = { ...preview, revision: previewRevision };
  return nextTransaction(transaction, {
    phase: "previewing",
    commands: nextCommands,
    preserveOverrides: keepOverrides,
    previewCore,
    committedCore: null,
    committedRevision: null,
    error: null,
    summary: summaryFor({
      transactionId: transaction.transactionId,
      baseRevision: transaction.baseRevision,
      commands: nextCommands,
      affectedIds: applied.affectedIds,
      changed: applied.changed,
      preserveOverrides: keepOverrides,
    }),
  });
}

/** Commit exactly the last preview as one Core revision/history entry. */
export function commitSemanticTransaction(transaction) {
  assertSemanticTransaction(transaction);
  if (transaction.phase !== "previewing" || transaction.previewCore === null) {
    throw new Error("semantic transaction requires a preview before commit");
  }
  const committedCore = clone(transaction.previewCore);
  const committedRevision = transaction.previewCore.revision ?? hashArtifact(committedCore.artifact);
  committedCore.revision = committedRevision;
  const nextHistory = transaction.history === null
    ? null
    : commitHistoryTransaction(transaction.history, committedCore, {
      transactionId: transaction.transactionId,
      kind: TRANSACTION_KIND,
    });
  const committed = nextTransaction(transaction, {
    phase: "committed",
    committedCore,
    committedRevision,
    history: nextHistory,
    error: null,
    summary: {
      ...transaction.summary,
      committedRevision,
      effects: { ...transaction.summary.effects, historyEntries: transaction.summary.changed ? 1 : 0 },
    },
  });
  return {
    transaction: committed,
    core: clone(committedCore),
    revision: committedRevision,
    expectedRevision: transaction.baseRevision,
    history: nextHistory === null ? null : clone(nextHistory),
    summary: clone(committed.summary),
  };
}

/** Cancel and discard the preview; the base Core remains the visible result. */
export function cancelSemanticTransaction(transaction) {
  assertSemanticTransaction(transaction);
  if (!["prepared", "previewing"].includes(transaction.phase)) throw new Error(`transaction cannot cancel while it is ${transaction.phase}`);
  return nextTransaction(transaction, {
    phase: "cancelled",
    previewCore: null,
    committedCore: null,
    committedRevision: null,
    error: null,
    summary: { ...transaction.summary, effects: { ...transaction.summary.effects, historyEntries: 0 } },
  });
}

/** Fail and rollback a transaction without retaining a partial preview. */
export function failSemanticTransaction(transaction, error) {
  assertSemanticTransaction(transaction);
  if (!["prepared", "previewing"].includes(transaction.phase)) throw new Error(`transaction cannot fail while it is ${transaction.phase}`);
  return nextTransaction(transaction, {
    phase: "failed",
    previewCore: null,
    committedCore: null,
    committedRevision: null,
    error: normalizeError(error),
    summary: { ...transaction.summary, changed: false, effects: { ...transaction.summary.effects, historyEntries: 0 } },
  });
}

/** Return the Core that Workspace may display for the current transaction phase. */
export function getSemanticTransactionVisibleCore(transaction) {
  assertSemanticTransaction(transaction);
  if (transaction.phase === "committed" && transaction.committedCore !== null) return clone(transaction.committedCore);
  if (transaction.phase === "previewing" && transaction.previewCore !== null) return clone(transaction.previewCore);
  return clone(transaction.baseCore);
}

export { TRANSACTION_KIND };
