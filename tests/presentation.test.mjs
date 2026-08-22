import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertPresentationBoundary } from "../contracts/presentation.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readPresentation() {
  const artifact = await readJson(join(repoRoot, "examples/flovvas-massing.diagram.json"));
  return structuredClone({
    semantic: artifact.semantic,
    annotations: artifact.annotations,
    presentation: artifact.presentation,
    assets: artifact.assets,
  });
}

test("Golden Case annotations resolve node, edge, group, and canvas anchors", async () => {
  const boundary = await readPresentation();
  assert.doesNotThrow(() => assertPresentationBoundary(boundary));
  assert.deepEqual(
    boundary.annotations.map((annotation) => annotation.anchor.kind),
    ["canvas", "node", "edge", "edge"],
  );
});

test("an annotation anchor must resolve by its declared semantic kind", async () => {
  const boundary = await readPresentation();
  const cases = [
    ["node", "missing-node"],
    ["edge", "stage-field"],
    ["group", "stage-field"],
  ];
  for (const [kind, targetId] of cases) {
    const candidate = structuredClone(boundary);
    candidate.annotations[1].anchor = { kind, targetId };
    assert.throws(() => assertPresentationBoundary(candidate), /does not resolve/);
  }
});

test("presentation tokens reject renderer runtime objects", async () => {
  const boundary = await readPresentation();
  boundary.presentation.roleOverrides.mainFlow = { colorToken: "ink.primary", runtime: new Map() };
  assert.throws(() => assertPresentationBoundary(boundary), /runtime/);

  const cyclic = await readPresentation();
  const value = {};
  value.self = value;
  cyclic.presentation.roleOverrides.cyclic = value;
  assert.throws(() => assertPresentationBoundary(cyclic), /cyclic/);
});

test("assets require a portable source URI and explicit license", async () => {
  const boundary = await readPresentation();
  boundary.assets[0].license = "";
  assert.throws(() => assertPresentationBoundary(boundary), /license is required/);

  const missingSource = await readPresentation();
  delete missingSource.assets[0].uri;
  assert.throws(() => assertPresentationBoundary(missingSource), /uri must be a non-empty source reference/);
});
