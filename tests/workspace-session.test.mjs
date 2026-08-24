import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  applyWorkspaceDraft,
  beginWorkspaceLoad,
  beginWorkspaceSave,
  beginWorkspaceStream,
  cancelWorkspaceStream,
  completeWorkspaceLoad,
  completeWorkspaceSave,
  completeWorkspaceStream,
  createWorkspaceSession,
  failWorkspaceLoad,
  failWorkspaceSave,
  failWorkspaceStream,
  getWorkspaceVisibleCore,
  isWorkspaceEditable,
  openWorkspace,
  resumeWorkspace,
  setWorkspaceSelection,
  updateWorkspaceStream,
} from "../workspace/workspace-session.mjs";
import { applyCoreCommand, createCoreState } from "../core/diagram-core.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readFixture() {
  return JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
}

async function coreFixture() {
  return createCoreState(await readFixture());
}

function moveCommand(core, x = 160, y = 92) {
  return {
    type: "layout.node.move",
    targetId: "stage-line",
    x,
    y,
    baseRevision: core.revision ?? "draft-revision",
    gestureId: "gesture-session",
  };
}

test("invalid load never enters editing state and a valid load exposes revision", async () => {
  const invalid = await openWorkspace("/path/that/does/not/exist/diagram.json");
  assert.equal(invalid.status, "error");
  assert.equal(invalid.core, null);
  assert.equal(invalid.dirty, false);
  assert.equal(isWorkspaceEditable(invalid), false);

  const directory = await mkdtemp(join(tmpdir(), "loom-workspace-session-"));
  const path = join(directory, "diagram.json");
  await writeFile(path, JSON.stringify(await readFixture()));
  const loaded = await openWorkspace(path);
  assert.equal(loaded.status, "ready");
  assert.equal(loaded.dirty, false);
  assert.ok(loaded.revision?.startsWith("sha256:"));
  assert.equal(loaded.lastEvent.type, "loaded");
});

test("draft, save success, and save failure keep visible status and valid content", async () => {
  const core = await coreFixture();
  const ready = createWorkspaceSession({ filePath: "examples/flovvas-massing.diagram.json", coreState: core });
  const changedCore = applyCoreCommand(core, moveCommand(core));
  const dirty = applyWorkspaceDraft(ready, changedCore);
  assert.equal(dirty.status, "dirty");
  assert.equal(dirty.dirty, true);
  assert.equal(isWorkspaceEditable(dirty), true);

  const saving = beginWorkspaceSave(dirty);
  assert.equal(saving.status, "saving");
  assert.equal(isWorkspaceEditable(saving), false);
  const saved = completeWorkspaceSave(saving, { ...changedCore, revision: "sha256:saved" });
  assert.equal(saved.status, "ready");
  assert.equal(saved.dirty, false);
  assert.equal(saved.savedRevision, "sha256:saved");

  const failed = failWorkspaceSave(beginWorkspaceSave(applyWorkspaceDraft(saved, changedCore)), new Error("disk full"));
  assert.equal(failed.status, "error");
  assert.equal(failed.dirty, true);
  assert.equal(failed.core.artifact.semantic.nodes.length, saved.core.artifact.semantic.nodes.length);
  assert.equal(failed.error.code, "workspace-save-failed");
  assert.equal(resumeWorkspace(failed).status, "dirty");
});

test("selection is stable semantic context and cannot be edited during a stream", async () => {
  const core = await coreFixture();
  const ready = createWorkspaceSession({ coreState: core });
  const selected = setWorkspaceSelection(ready, { kind: "node", id: "stage-line" });
  assert.deepEqual(selected.selection, { kind: "node", id: "stage-line" });
  const streaming = beginWorkspaceStream(selected, { transactionId: "codex-transaction" });
  assert.equal(streaming.status, "streaming");
  assert.equal(isWorkspaceEditable(streaming), false);
  assert.throws(() => setWorkspaceSelection(streaming, null), /selection is unavailable/);
});

test("stream preview does not mutate canonical Core; success commits once", async () => {
  const core = await coreFixture();
  const ready = createWorkspaceSession({ coreState: core });
  const previewCore = applyCoreCommand(core, moveCommand(core, 180, 96));
  const streaming = beginWorkspaceStream(ready, { transactionId: "codex-stream" });
  const previewing = updateWorkspaceStream(streaming, previewCore);
  assert.deepEqual(getWorkspaceVisibleCore(previewing).artifact.layout.overrides, previewCore.artifact.layout.overrides);
  assert.deepEqual(previewing.core.artifact.layout.overrides, ready.core.artifact.layout.overrides);
  assert.equal(previewing.revision, ready.revision);
  const committed = completeWorkspaceStream(previewing, { ...previewCore, revision: "sha256:codex" });
  assert.equal(committed.status, "ready");
  assert.equal(committed.savedRevision, "sha256:codex");
  assert.equal(committed.dirty, false);
});

test("stream failure and cancellation restore the previous valid Artifact", async () => {
  const core = await coreFixture();
  const dirty = applyWorkspaceDraft(createWorkspaceSession({ coreState: core }), applyCoreCommand(core, moveCommand(core)));
  const failed = failWorkspaceStream(
    updateWorkspaceStream(beginWorkspaceStream(dirty, { transactionId: "codex-fail" }), core),
    new Error("invalid semantic patch"),
  );
  assert.equal(failed.status, "error");
  assert.equal(failed.dirty, true);
  assert.deepEqual(failed.core.artifact.layout.overrides, dirty.core.artifact.layout.overrides);
  assert.equal(failed.lastEvent.type, "stream-failed");
  assert.equal(resumeWorkspace(failed).status, "dirty");

  const cancelled = cancelWorkspaceStream(beginWorkspaceStream(dirty, { transactionId: "codex-cancel" }));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.dirty, true);
  assert.deepEqual(cancelled.core.artifact.layout.overrides, dirty.core.artifact.layout.overrides);
  assert.equal(cancelled.lastEvent.type, "stream-cancelled");
});

test("load transitions are explicit and invalid transition cannot bypass recovery", async () => {
  const core = await coreFixture();
  const idle = createWorkspaceSession();
  const loading = beginWorkspaceLoad(idle, "diagram.json");
  assert.equal(loading.status, "loading");
  const ready = completeWorkspaceLoad(loading, core);
  assert.equal(ready.status, "ready");
  assert.throws(() => completeWorkspaceLoad(ready, core), /load is not active/);
  const failed = failWorkspaceLoad(beginWorkspaceLoad(ready, "broken.json"), { code: "invalid-envelope", message: "bad diagram" });
  assert.equal(failed.status, "error");
  assert.equal(failed.error.code, "invalid-envelope");
  assert.equal(resumeWorkspace(failed).status, "idle");
});
