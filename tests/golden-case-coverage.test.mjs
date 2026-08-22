import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "examples/flovvas-massing.golden-case.json");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function ids(items, predicate) {
  return items.filter(predicate).map((item) => item.id).sort();
}

test("Golden Case coverage names every required semantic category", async () => {
  const manifest = await readJson(manifestPath);
  const artifact = await readJson(resolve(repoRoot, manifest.artifactPath));
  const coverage = manifest.coverage;

  const actual = {
    primaryStages: ids(
      artifact.semantic.nodes,
      (node) => node.type === "product-stage" && node.visualRole === "main-stage",
    ),
    primaryTransformations: ids(
      artifact.semantic.edges,
      (edge) => edge.type === "transformation" && edge.visualRole === "main-flow",
    ),
    phaseZones: ids(
      artifact.semantic.groups,
      (group) => group.type === "phase-zone" && group.visualRole === "phase-zone",
    ),
    alternatives: ids(
      artifact.semantic.nodes,
      (node) => node.type === "alternative-path" && node.visualRole === "alternative",
    ),
    externalInputs: ids(
      artifact.semantic.nodes,
      (node) => node.type === "external-input" && node.visualRole === "external-input",
    ),
    compoundingLoops: ids(
      artifact.semantic.edges,
      (edge) => edge.type === "feedback" && edge.visualRole === "compounding-loop",
    ),
  };

  for (const [category, expectedIds] of Object.entries(coverage)) {
    assert.ok(Array.isArray(expectedIds), `${category} coverage must be an array`);
    assert.deepEqual(
      actual[category],
      [...expectedIds].sort(),
      `${category} coverage differs; missing or unexpected IDs are listed here`,
    );
  }
});
