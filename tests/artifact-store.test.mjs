import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createDiagram,
  loadDiagram,
  saveDiagram,
} from "../core/artifact-store.mjs";
import { DiagramContractError } from "../contracts/diagram-error.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(repoRoot, "examples/flovvas-massing.diagram.json");

async function readFixture() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

async function tempPath() {
  const directory = await mkdtemp(join(tmpdir(), "loom-artifact-") );
  return { directory, filePath: join(directory, "example.diagram.json") };
}

test("create and load return independent validated artifacts", async () => {
  const fixture = await readFixture();
  const created = createDiagram(fixture);
  created.semantic.nodes[0].label = "Changed in memory";
  assert.notEqual(created.semantic.nodes[0].label, fixture.semantic.nodes[0].label);

  const { filePath } = await tempPath();
  await writeFile(filePath, JSON.stringify(fixture));
  const loaded = await loadDiagram(filePath);
  assert.match(loaded.revision, /^sha256:[a-f0-9]{64}$/);
  assert.equal(loaded.updatedAt, fixture.metadata.updatedAt);
  assert.deepEqual(loaded.artifact.semantic, fixture.semantic);
});

test("Golden Case load-save-reload preserves semantic and layout content", async () => {
  const fixture = await readFixture();
  const { filePath } = await tempPath();
  const first = await saveDiagram(filePath, fixture, { now: new Date("2026-08-22T01:00:00.000Z") });
  const reopened = await loadDiagram(filePath);

  assert.equal(reopened.revision, first.revision);
  assert.equal(reopened.updatedAt, "2026-08-22T01:00:00.000Z");
  assert.deepEqual(reopened.artifact.semantic, fixture.semantic);
  assert.deepEqual(reopened.artifact.composition, fixture.composition);
  assert.deepEqual(reopened.artifact.layout, fixture.layout);
  assert.deepEqual(reopened.artifact.annotations, fixture.annotations);
  assert.deepEqual(reopened.artifact.presentation, fixture.presentation);
  assert.deepEqual(reopened.artifact.assets, fixture.assets);
});

test("an interrupted atomic save leaves the previous legal file intact", async () => {
  const fixture = await readFixture();
  const { directory, filePath } = await tempPath();
  await saveDiagram(filePath, fixture, { now: new Date("2026-08-22T01:00:00.000Z") });
  const before = await readFile(filePath, "utf8");
  const changed = structuredClone(fixture);
  changed.semantic.nodes[0].label = "This write must not become visible";

  await assert.rejects(
    () => saveDiagram(filePath, changed, {
      now: new Date("2026-08-22T02:00:00.000Z"),
      beforeRename: async () => {
        throw new Error("simulated interruption");
      },
    }),
    /simulated interruption/,
  );
  assert.equal(await readFile(filePath, "utf8"), before);
  assert.deepEqual(await readdir(directory), ["example.diagram.json"]);
});

test("expected revision prevents overwriting a newer file", async () => {
  const fixture = await readFixture();
  const { filePath } = await tempPath();
  const first = await saveDiagram(filePath, fixture, { now: new Date("2026-08-22T01:00:00.000Z") });
  const changed = structuredClone(fixture);
  changed.semantic.nodes[0].label = "New version";
  await saveDiagram(filePath, changed, { now: new Date("2026-08-22T02:00:00.000Z") });

  await assert.rejects(
    () => saveDiagram(filePath, fixture, {
      now: new Date("2026-08-22T03:00:00.000Z"),
      expectedRevision: first.revision,
    }),
    /revision changed/,
  );
});

test("legacy Diagram x/y/elevation Golden Case remains readable without migration", async () => {
  const fixture = await readFixture();
  assert.doesNotThrow(() => createDiagram(fixture));
  assert.equal(fixture.layout.generated.nodes["stage-line"].elevation, 4);
  assert.equal(fixture.layout.generated.routes["edge-split"].points[0].z, undefined);
});

test("unsupported persisted world coordinates are blocked with a structured diagnostic", async () => {
  const fixture = await readFixture();
  fixture.layout.generated.nodes["stage-line"].z = 12;

  assert.throws(
    () => createDiagram(fixture),
    (error) => error instanceof DiagramContractError
      && error.code === "unsupported-coordinate-space"
      && error.recoverable === false
      && error.fieldPath === "artifact.layout.generated.nodes"
      && error.suggestedAction.includes("Diagram x/y"),
  );
});

test("persisted Renderer camera state is blocked and load preserves the diagnostic", async () => {
  const fixture = await readFixture();
  fixture.composition.cameraState = { position: { x: 1, y: 2, z: 3 } };
  const { filePath } = await tempPath();
  await writeFile(filePath, JSON.stringify(fixture));

  await assert.rejects(
    () => loadDiagram(filePath),
    (error) => error instanceof DiagramContractError
      && error.code === "renderer-state-not-persistable"
      && error.recoverable === false
      && error.fieldPath === "artifact.composition",
  );
});
