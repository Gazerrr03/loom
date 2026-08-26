import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertLayout,
  clearOverride,
  mergeEffectiveLayout,
} from "../contracts/layout.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readArtifact() {
  return readJson(join(repoRoot, "examples/flovvas-massing.diagram.json"));
}

test("effective layout applies overrides by field and preserves generated siblings", async () => {
  const artifact = await readArtifact();
  const effective = mergeEffectiveLayout(artifact.layout, artifact.composition.defaultView);

  assert.equal(effective.nodes["stage-workbench"].x, 522);
  assert.equal(effective.nodes["stage-workbench"].y, 35);
  assert.equal(effective.nodes["stage-workbench"].scale, 1);
  assert.equal(effective.nodes["stage-workbench"].rotationYDeg, -4);
  assert.equal(effective.view.preset, "isometric");
});

test("nested parameters merge by key while route points remain one overridable field", async () => {
  const artifact = await readArtifact();
  const layout = structuredClone(artifact.layout);
  layout.generated.nodes["stage-line"].parameters = { cardCount: 6, density: "high" };
  layout.overrides.nodes["stage-line"] = { parameters: { cardCount: 8 } };
  layout.overrides.routes["edge-split"] = { points: [{ x: 1, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 4 }] };

  const effective = mergeEffectiveLayout(layout);
  assert.deepEqual(effective.nodes["stage-line"].parameters, { cardCount: 8, density: "high" });
  assert.deepEqual(effective.routes["edge-split"].points, [{ x: 1, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 4 }]);
});

test("a diagonal route override is structurally blocked before merge", async () => {
  const artifact = await readArtifact();
  const layout = structuredClone(artifact.layout);
  layout.overrides.routes["edge-split"] = { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
  assert.throws(() => mergeEffectiveLayout(layout), /only one world axis \(X or Z\).*diagonal segment/);
});

test("single-field, object, and full-layer clears are immutable and table-driven", async () => {
  const artifact = await readArtifact();
  const original = structuredClone(artifact.layout);
  const cases = [
    {
      target: { kind: "node", id: "stage-workbench", field: "x" },
      expected: { nodes: { "stage-workbench": { rotationYDeg: -4 } } },
    },
    {
      target: { kind: "node", id: "stage-workbench" },
      expected: { nodes: {} },
    },
    {
      target: {},
      expected: { nodes: {}, routes: {}, groups: {}, view: {} },
    },
  ];

  for (const { target, expected } of cases) {
    const next = clearOverride(original, target);
    for (const [kind, value] of Object.entries(expected)) {
      assert.deepEqual(next.overrides[kind], value);
    }
    assert.deepEqual(original, artifact.layout);
  }
});

test("an override cannot silently target a missing generated object", async () => {
  const artifact = await readArtifact();
  const layout = structuredClone(artifact.layout);
  layout.overrides.nodes.missing = { x: 10 };
  assert.throws(() => assertLayout(layout), /no Generated Layout target: nodes\.missing/);
});
