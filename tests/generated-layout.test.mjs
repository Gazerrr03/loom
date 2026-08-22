import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertGeneratedLayout, generateLayout } from "../contracts/generated-layout.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function readJson(relativePath) { return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8")); }

test("Generated Layout covers every semantic object and is stable for the same seed", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const constraints = await readJson("examples/flovvas-massing.layout-constraints.json");
  const first = generateLayout(artifact, { seed: "golden-layout-v1", constraints });
  const second = generateLayout(artifact, { seed: "golden-layout-v1", constraints });
  assert.deepEqual(first.layout, second.layout);
  assert.equal(first.layout.engine.id, "loom-deterministic-layout");
  assert.deepEqual(Object.keys(first.layout.generated.nodes).sort(), artifact.semantic.nodes.map((node) => node.id).sort());
  assert.deepEqual(Object.keys(first.layout.generated.routes).sort(), artifact.semantic.edges.map((edge) => edge.id).sort());
  assert.deepEqual(Object.keys(first.layout.generated.groups).sort(), artifact.semantic.groups.map((group) => group.id).sort());
  assertGeneratedLayout(artifact, first.layout);
  assert.equal(first.constraintReport.valid, true);
});

test("primary routes follow the lower-left to upper-right reading direction", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const constraints = await readJson("examples/flovvas-massing.layout-constraints.json");
  const { layout, constraintReport } = generateLayout(artifact, { seed: "golden-layout-v1", constraints });
  assert.equal(constraintReport.violations.length, 0);
  for (const edge of artifact.semantic.edges.filter((candidate) => candidate.visualRole === "main-flow")) {
    const points = layout.generated.routes[edge.id].points;
    assert.ok(points.at(-1).x >= points[0].x, edge.id);
    assert.ok(points.at(-1).y <= points[0].y, edge.id);
  }
});

test("constraint conflicts are returned as a report without mutating the artifact or overrides", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const constraints = await readJson("examples/flovvas-massing.layout-constraints.json");
  const before = structuredClone(artifact);
  const conflictProfile = { ...constraints, gutterSafeAreaId: "safe-outer" };
  const { layout, constraintReport } = generateLayout(artifact, { seed: "golden-layout-v1", constraints: conflictProfile });
  assert.equal(constraintReport.valid, false);
  assert.ok(constraintReport.violations.some((violation) => violation.kind === "critical-gutter"));
  assert.deepEqual(artifact, before);
  assert.equal(artifact.layout.overrides.nodes["stage-line"], undefined);
  assert.equal(layout.generated.nodes["stage-line"].x >= 0, true);
});
