import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCoreState } from "../core/diagram-core.mjs";
import {
  beginSemanticTransaction,
  cancelSemanticTransaction,
  commitSemanticTransaction,
  failSemanticTransaction,
  getSemanticTransactionVisibleCore,
  previewSemanticTransaction,
} from "../mcp/semantic-transaction.mjs";
import { createHistory } from "../workspace/history.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readFixture() {
  return JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
}

function updateLabel(core, label, targetId = "stage-line") {
  return {
    type: "semantic.node.update",
    targetId,
    patch: { label },
    ...(core.revision ? { baseRevision: core.revision } : {}),
  };
}

async function coreFixture(options = {}) {
  return createCoreState(await readFixture(), options);
}

test("dry-run returns a readable summary without writing or mutating the base Core", async () => {
  const core = await coreFixture({ revision: "sha256:base" });
  const before = structuredClone(core);
  const transaction = beginSemanticTransaction(core, [updateLabel(core, "LINE (Codex)")], { transactionId: "codex-dry-run" });
  const preview = previewSemanticTransaction(transaction);

  assert.equal(preview.phase, "previewing");
  assert.equal(preview.summary.commandCount, 1);
  assert.deepEqual(preview.summary.affectedIds, ["stage-line"]);
  assert.equal(preview.summary.changed, true);
  assert.equal(preview.summary.effects.fileWrite, false);
  assert.equal(preview.summary.preserveHumanOverrides, true);
  assert.equal(preview.baseCore.artifact.semantic.nodes.find((node) => node.id === "stage-line").label, "LINE");
  assert.equal(preview.previewCore.artifact.semantic.nodes.find((node) => node.id === "stage-line").label, "LINE (Codex)");
  assert.deepEqual(core, before);
  assert.equal(core.revision, "sha256:base");
});

test("streamed frames always derive from the canonical base and expose only an ephemeral preview", async () => {
  const core = await coreFixture();
  const transaction = beginSemanticTransaction(core, [updateLabel(core, "LINE (frame 1)")], { transactionId: "codex-stream" });
  const frame1 = previewSemanticTransaction(transaction);
  const frame2 = previewSemanticTransaction(frame1, {
    commands: [updateLabel(core, "LINE (frame 2)"), updateLabel(core, "BRANCH (frame 2)", "stage-branch")],
  });

  assert.equal(frame1.previewCore.artifact.semantic.nodes.find((node) => node.id === "stage-branch").label, "BRANCH");
  assert.equal(frame2.previewCore.artifact.semantic.nodes.find((node) => node.id === "stage-line").label, "LINE (frame 2)");
  assert.equal(frame2.previewCore.artifact.semantic.nodes.find((node) => node.id === "stage-branch").label, "BRANCH (frame 2)");
  assert.equal(core.artifact.semantic.nodes.find((node) => node.id === "stage-line").label, "LINE");
  assert.equal(getSemanticTransactionVisibleCore(frame2).artifact.semantic.nodes.find((node) => node.id === "stage-line").label, "LINE (frame 2)");
  assert.equal(frame2.baseRevision, null);
});

test("commit creates one traceable revision and one optional history transaction", async () => {
  const core = await coreFixture({ revision: "sha256:base" });
  const history = createHistory(core);
  const transaction = beginSemanticTransaction(core, [updateLabel(core, "LINE (committed)")], {
    transactionId: "codex-commit",
    history,
  });
  const committed = commitSemanticTransaction(previewSemanticTransaction(transaction));

  assert.match(committed.revision, /^sha256:[a-f0-9]{64}$/);
  assert.equal(committed.core.revision, committed.revision);
  assert.equal(committed.expectedRevision, "sha256:base");
  assert.equal(committed.transaction.phase, "committed");
  assert.equal(committed.transaction.committedRevision, committed.revision);
  assert.equal(committed.core.artifact.semantic.nodes.find((node) => node.id === "stage-line").label, "LINE (committed)");
  assert.equal(committed.history.past.length, 1);
  assert.equal(committed.history.past[0].transactionId, "codex-commit");
  assert.equal(committed.history.past[0].kind, "codex.semantic.batch");
  assert.equal(committed.summary.effects.historyEntries, 1);
});

test("semantic reflow preserves unrelated Human Override fields by default", async () => {
  const fixture = await readFixture();
  fixture.layout.overrides.nodes["stage-field"] = { x: 999, scale: 1.25 };
  const core = createCoreState(fixture, { revision: "sha256:base" });
  const transaction = beginSemanticTransaction(core, [updateLabel(core, "LINE (reflow)")], { transactionId: "codex-reflow" });
  const preview = previewSemanticTransaction(transaction);

  assert.deepEqual(preview.previewCore.artifact.layout.overrides.nodes["stage-field"], { x: 999, scale: 1.25 });
  assert.deepEqual(preview.previewCore.artifact.layout.overrides.nodes["stage-line"], undefined);
  assert.equal(preview.summary.preserveHumanOverrides, true);
});

test("a caller can explicitly opt out of retaining existing overrides", async () => {
  const fixture = await readFixture();
  fixture.layout.overrides.nodes["stage-field"] = { x: 999 };
  const core = createCoreState(fixture, { revision: "sha256:base" });
  const transaction = beginSemanticTransaction(core, [updateLabel(core, "LINE (without override)")], {
    transactionId: "codex-no-override",
    preserveOverrides: false,
  });
  const preview = previewSemanticTransaction(transaction);

  assert.equal(preview.previewCore.artifact.layout.overrides.nodes["stage-field"], undefined);
  assert.equal(preview.summary.preserveHumanOverrides, false);
});

test("failed and cancelled transactions discard previews and expose the valid base Core", async () => {
  const core = await coreFixture({ revision: "sha256:base" });
  const transaction = beginSemanticTransaction(core, [updateLabel(core, "LINE (temporary)")], { transactionId: "codex-recovery" });
  const preview = previewSemanticTransaction(transaction);
  const failed = failSemanticTransaction(preview, new Error("invalid semantic patch"));
  assert.equal(failed.phase, "failed");
  assert.equal(failed.previewCore, null);
  assert.equal(failed.error.code, "semantic-transaction-failed");
  assert.deepEqual(getSemanticTransactionVisibleCore(failed), core);

  const cancelled = cancelSemanticTransaction(preview);
  assert.equal(cancelled.phase, "cancelled");
  assert.equal(cancelled.previewCore, null);
  assert.deepEqual(getSemanticTransactionVisibleCore(cancelled), core);
  assert.throws(() => commitSemanticTransaction(cancelled), /requires a preview/);
});

test("stale command revisions fail before a preview can be produced", async () => {
  const core = await coreFixture({ revision: "sha256:base" });
  assert.throws(
    () => beginSemanticTransaction(core, [{ ...updateLabel(core, "stale"), baseRevision: "sha256:other" }], { transactionId: "codex-stale" }),
    /base revision changed/,
  );
});
