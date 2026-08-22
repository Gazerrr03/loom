import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertConstraintProfile, evaluateLayoutConstraints } from "../contracts/layout-constraints.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function readJson(relativePath) { return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8")); }

test("Golden Case constraints distinguish gutter, phase zones, and primary/secondary paths", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const profile = await readJson("examples/flovvas-massing.layout-constraints.json");
  assert.doesNotThrow(() => assertConstraintProfile(profile));
  const result = evaluateLayoutConstraints(artifact, profile);
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
  assert.ok(result.effectiveLayout.nodes["stage-workbench"]);
});

test("moving a protected node anchor into the gutter reports a conflict without deleting it", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const profile = await readJson("examples/flovvas-massing.layout-constraints.json");
  artifact.layout.overrides.nodes["stage-line"] = { x: 266 };
  const result = evaluateLayoutConstraints(artifact, profile);
  assert.equal(result.valid, false);
  assert.deepEqual(result.violations[0], { kind: "critical-gutter", objectIds: ["stage-line"], fieldPath: "layout.nodes.stage-line" });
  assert.ok(artifact.semantic.nodes.some((node) => node.id === "stage-line"));
});

test("missing primary routes and invalid constraint profiles are reportable", async () => {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const profile = await readJson("examples/flovvas-massing.layout-constraints.json");
  delete artifact.layout.generated.routes["edge-split"];
  const result = evaluateLayoutConstraints(artifact, profile);
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((violation) => violation.kind === "missing-route"));

  const invalid = { ...profile, readingDirection: "freeform" };
  assert.throws(() => assertConstraintProfile(invalid), /readingDirection/);
});
