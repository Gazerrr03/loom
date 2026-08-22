import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertParameterContract, resolveParameters } from "../contracts/component-parameters.mjs";
import { assertComponentTemplateCatalog } from "../contracts/component-template-catalog.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function readJson(relativePath) { return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8")); }

test("the registry contains seven complete, distinct Golden Template manifests", async () => {
  const registry = await readJson("examples/flovvas-template-registry.json");
  const catalog = await readJson("examples/flovvas-template-catalog.json");
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  assert.doesNotThrow(() => assertComponentTemplateCatalog(catalog));
  assert.equal(registry.goldenTemplateIds.length, 7);
  assert.deepEqual(registry.templates.map((entry) => entry.id), registry.goldenTemplateIds);
  const manifests = await Promise.all(registry.templates.map((entry) => readJson(entry.path)));
  for (const manifest of manifests) {
    assert.equal(manifest.format, "loom.component-template");
    assert.equal(manifest.schemaVersion, "0.1.0");
    assert.doesNotThrow(() => assertParameterContract(manifest));
    assert.equal(manifest.fallback.componentRef, "generic-card-slab");
    assert.deepEqual(manifest.dependencies.primitiveRefs, ["generic-card-slab"]);
  }
  assert.equal(new Set(manifests.map((manifest) => manifest.id)).size, 7);
  assert.ok(registry.goldenTemplateIds.every((id) => artifact.semantic.nodes.some((node) => node.componentRef === id)));
});

test("fixture layout parameters resolve against the matching stage manifest", async () => {
  const registry = await readJson("examples/flovvas-template-registry.json");
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const manifests = new Map(await Promise.all(registry.templates.map(async (entry) => [entry.id, await readJson(entry.path)])));
  for (const node of artifact.semantic.nodes.filter((candidate) => registry.goldenTemplateIds.includes(candidate.componentRef))) {
    const manifest = manifests.get(node.componentRef);
    const layoutParameters = artifact.layout.generated.nodes[node.id].parameters;
    assert.doesNotThrow(() => resolveParameters(manifest, layoutParameters), node.id);
  }
});

test("adjacent stages expose different parameter profiles while sharing one primitive family", async () => {
  const registry = await readJson("examples/flovvas-template-registry.json");
  const manifests = await Promise.all(registry.templates.map((entry) => readJson(entry.path)));
  const profiles = manifests.map((manifest) => Object.keys(manifest.parametersSchema.properties).sort().join(","));
  assert.equal(new Set(profiles).size, 7);
  assert.ok(manifests.every((manifest) => manifest.dependencies.primitiveRefs.includes("generic-card-slab")));
});
