import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  applyCoreCommand,
  createCoreState,
  openCore,
  reflowCore,
  saveCore,
} from "../core/diagram-core.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(repoRoot, "examples/flovvas-massing.diagram.json");

async function readFixture() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

async function tempPath() {
  const directory = await mkdtemp(join(tmpdir(), "loom-core-"));
  return join(directory, "example.diagram.json");
}

test("Core derives Effective Layout from Generated Layout and field-level overrides", async () => {
  const artifact = await readFixture();
  artifact.layout.overrides.nodes["stage-field"] = { x: 302, scale: 1.25 };

  const state = createCoreState(artifact, { seed: "core-test-v1" });

  assert.equal(state.revision, null);
  assert.equal(state.effectiveLayout.nodes["stage-field"].x, 302);
  assert.equal(state.effectiveLayout.nodes["stage-field"].scale, 1.25);
  assert.notEqual(state.effectiveLayout.nodes["stage-field"].y, undefined);
  assert.equal(state.artifact.layout.engine.seed, "core-test-v1");
  assert.ok(state.updatedAt);
});

test("Core save and open provide one lossless Artifact round trip", async () => {
  const fixture = await readFixture();
  fixture.layout.overrides.nodes["stage-card"] = { x: 230 };
  const filePath = await tempPath();

  const saved = await saveCore(filePath, fixture, {
    now: new Date("2026-08-24T01:00:00.000Z"),
    seed: "core-round-trip-v1",
  });
  const reopened = await openCore(filePath);

  assert.match(saved.revision, /^sha256:[a-f0-9]{64}$/);
  assert.equal(reopened.revision, saved.revision);
  assert.equal(reopened.updatedAt, "2026-08-24T01:00:00.000Z");
  assert.deepEqual(reopened.artifact.semantic, saved.artifact.semantic);
  assert.deepEqual(reopened.artifact.composition, saved.artifact.composition);
  assert.deepEqual(reopened.artifact.layout, saved.artifact.layout);
  assert.deepEqual(reopened.artifact.annotations, saved.artifact.annotations);
  assert.deepEqual(reopened.artifact.presentation, saved.artifact.presentation);
  assert.deepEqual(reopened.artifact.assets, saved.artifact.assets);
  assert.equal(reopened.effectiveLayout.nodes["stage-card"].x, 230);
});

test("Core applies one validated command without mutating the previous state", async () => {
  const filePath = await tempPath();
  const saved = await saveCore(filePath, await readFixture(), {
    now: new Date("2026-08-24T02:00:00.000Z"),
  });
  const next = applyCoreCommand(saved, {
    type: "layout.node.move",
    targetId: "stage-card",
    x: 245,
    y: 88,
    baseRevision: saved.revision,
    gestureId: "gesture-core-1",
  });

  assert.equal(saved.artifact.layout.overrides.nodes["stage-card"], undefined);
  assert.deepEqual(next.artifact.layout.overrides.nodes["stage-card"], { x: 245, y: 88 });
  assert.equal(next.effectiveLayout.nodes["stage-card"].x, 245);
  assert.equal(next.revision, saved.revision);
});

test("Core rejects a stale command and preserves unrelated overrides during reflow", async () => {
  const previousArtifact = await readFixture();
  previousArtifact.layout.overrides.nodes["stage-field"] = { x: 302, scale: 1.25 };
  const previous = createCoreState(previousArtifact, { seed: "core-reflow-v1" });
  const staleCommand = {
    type: "layout.node.move",
    targetId: "stage-card",
    x: 1,
    y: 2,
    baseRevision: "sha256:stale",
    gestureId: "gesture-core-stale",
  };
  assert.throws(() => applyCoreCommand({ ...previous, revision: "sha256:current" }, staleCommand), /revision changed/);

  const nextArtifact = structuredClone(previous.artifact);
  nextArtifact.semantic.nodes.push({
    id: "stage-core-new",
    type: "product-stage",
    label: "NEW",
    componentRef: "generic-card-slab",
    visualRole: "main-stage",
    phase: "workspace",
    properties: { sequence: 8 },
  });
  const reflowed = reflowCore(previous, nextArtifact, { seed: "core-reflow-v2" });

  assert.ok(reflowed.artifact.layout.generated.nodes["stage-core-new"]);
  assert.deepEqual(reflowed.artifact.layout.overrides.nodes["stage-field"], { x: 302, scale: 1.25 });
  assert.equal(reflowed.effectiveLayout.nodes["stage-field"].x, 302);
  assert.equal(reflowed.revision, null);
});

test("Core rejects invalid artifacts before deriving or writing", async () => {
  const invalid = await readFixture();
  invalid.semantic.edges[0].source = "missing-node";
  assert.throws(() => createCoreState(invalid), /Dangling edge endpoint/);

  const filePath = await tempPath();
  await assert.rejects(() => saveCore(filePath, invalid), /Dangling edge endpoint/);
});
