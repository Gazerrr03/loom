import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertRendererCapabilities,
  resolveRendererMapping,
} from "../contracts/renderer-mapping.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readManifest() {
  return JSON.parse(await readFile(join(repoRoot, "examples/flovvas-workbench.component.json"), "utf8"));
}

function referenceCapabilities(overrides = {}) {
  return {
    adapterId: "reference-webgl",
    adapterVersion: "0.1.0",
    projections: ["orthographic"],
    componentKinds: ["parametric-scene", "fallback"],
    interactions: ["pick", "move-plane"],
    exports: ["png"],
    assetFormats: ["glb", "gltf"],
    features: ["orthographic-camera", "instancing"],
    ...overrides,
  };
}

test("a capable Adapter receives a mapping without changing semantic identity", async () => {
  const manifest = await readManifest();
  const result = resolveRendererMapping(manifest, referenceCapabilities(), {
    id: "stage-workbench",
    type: "product-stage",
    label: "WORKBENCH",
    parameters: { modules: 7 },
  });

  assert.equal(result.status, "mapped");
  assert.equal(result.implementationRef, "builtin://scenes/flovvas-workbench");
  assert.equal(result.semanticType, "product-stage");
  assert.equal(result.label, "WORKBENCH");
  assert.equal(result.parameters.modules, 7);
});

test("missing mapping or capability returns a labelled fallback", async () => {
  const manifest = await readManifest();
  const node = { id: "stage-workbench", type: "product-stage", label: "WORKBENCH" };

  const noMapping = resolveRendererMapping(manifest, referenceCapabilities({ adapterId: "other-renderer" }), node);
  assert.equal(noMapping.status, "fallback");
  assert.equal(noMapping.componentRef, "generic-card-slab");
  assert.equal(noMapping.label, "WORKBENCH");
  assert.match(noMapping.reasons[0], /no mapping/);

  const noFeature = resolveRendererMapping(manifest, referenceCapabilities({ features: ["orthographic-camera"] }), node);
  assert.equal(noFeature.status, "fallback");
  assert.match(noFeature.reasons[0], /Missing capabilities: instancing/);
});

test("a template without fallback returns a structured error rather than a silent empty node", async () => {
  const manifest = await readManifest();
  delete manifest.fallback;
  assert.throws(
    () => resolveRendererMapping(manifest, referenceCapabilities(), { id: "stage-workbench", label: "WORKBENCH" }),
    /fallback\.componentRef/,
  );
});

test("capability declarations are checked before mapping is used", () => {
  assert.doesNotThrow(() => assertRendererCapabilities(referenceCapabilities()));
  assert.throws(() => assertRendererCapabilities(referenceCapabilities({ features: "instancing" })), /features/);
});
