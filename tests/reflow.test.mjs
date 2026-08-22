import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generateLayout } from "../contracts/generated-layout.mjs";
import { clearOverride, mergeEffectiveLayout } from "../contracts/layout.mjs";
import { effectiveLayoutAfterReflow, reconcileGeneratedLayout, retainApplicableOverrides } from "../contracts/reflow.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function readJson(relativePath) { return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8")); }

test("adding a semantic node preserves unrelated Human Override fields", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  artifact.layout.overrides.nodes["stage-field"] = { x: 302, scale: 1.25 };
  const nextArtifact = structuredClone(artifact);
  nextArtifact.semantic.nodes.push({
    id: "stage-new",
    type: "product-stage",
    label: "NEW",
    componentRef: "generic-card-slab",
    visualRole: "main-stage",
    phase: "workspace",
    properties: { sequence: 8 },
  });
  const constraints = await readJson("examples/flovvas-massing.layout-constraints.json");
  const generated = generateLayout(nextArtifact, { seed: "reflow-v2", constraints }).layout;
  const result = effectiveLayoutAfterReflow(artifact, nextArtifact, generated);
  assert.ok(result.artifact.layout.generated.nodes["stage-new"]);
  assert.deepEqual(result.artifact.layout.overrides.nodes["stage-field"], { x: 302, scale: 1.25 });
  assert.equal(result.effectiveLayout.nodes["stage-field"].x, 302);
  assert.equal(result.effectiveLayout.nodes["stage-field"].scale, 1.25);
});

test("deleted objects lose stale overrides while surviving fields remain", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  artifact.layout.overrides.nodes["stage-card"] = { x: 230 };
  artifact.layout.overrides.nodes["stage-field"] = { x: 302 };
  const generated = structuredClone(artifact.layout);
  delete generated.generated.nodes["stage-card"];
  const kept = retainApplicableOverrides(artifact.layout.overrides, generated.generated);
  assert.equal(kept.nodes["stage-card"], undefined);
  assert.deepEqual(kept.nodes["stage-field"], { x: 302 });
});

test("clearing one override returns that field to the latest Generated Layout", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  artifact.layout.overrides.nodes["stage-field"] = { x: 302, scale: 1.25 };
  const next = clearOverride(artifact.layout, { kind: "node", id: "stage-field", field: "x" });
  const effective = mergeEffectiveLayout(next, artifact.composition.defaultView);
  assert.equal(effective.nodes["stage-field"].x, artifact.layout.generated.nodes["stage-field"].x);
  assert.equal(effective.nodes["stage-field"].scale, 1.25);
  assert.equal(artifact.layout.overrides.nodes["stage-field"].x, 302);
});

test("reconcile is immutable and keeps the new engine identity", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const generated = generateLayout(artifact, { seed: "reflow-v2" }).layout;
  const next = reconcileGeneratedLayout(artifact, artifact, generated);
  assert.notEqual(next, artifact);
  assert.equal(next.layout.engine.seed, "reflow-v2");
  assert.deepEqual(artifact.layout.engine.seed, "flovvas-v1");
});
