import assert from "node:assert/strict";
import test from "node:test";
import {
  negotiateRendererCapabilities,
  normalizeRequirements,
} from "../contracts/renderer-capabilities.mjs";

function referenceCapabilities(overrides = {}) {
  return {
    adapterId: "reference-webgl",
    adapterVersion: "0.1.0",
    projections: ["orthographic"],
    componentKinds: ["parametric-scene", "fallback"],
    interactions: ["pick", "move-plane", "rotate-y"],
    exports: ["png"],
    assetFormats: ["glb", "gltf"],
    features: ["orthographic-camera", "instancing"],
    ...overrides,
  };
}

const goldenRequirements = {
  projection: "orthographic",
  componentKinds: ["parametric-scene", "fallback"],
  interactions: ["pick", "move-plane"],
  exports: ["png"],
  assetFormats: ["glb"],
  features: ["orthographic-camera", "instancing"],
};

test("capability negotiation admits a fully capable Adapter", () => {
  const result = negotiateRendererCapabilities(goldenRequirements, referenceCapabilities());

  assert.equal(result.status, "ready");
  assert.equal(result.adapterId, "reference-webgl");
  assert.deepEqual(result.missing, []);
  assert.equal(result.error, null);
});

test("missing required capability fails before load with a structured error", () => {
  const result = negotiateRendererCapabilities(
    goldenRequirements,
    referenceCapabilities({ features: ["orthographic-camera"] }),
    { objectIds: ["stage-workbench"] },
  );

  assert.equal(result.status, "error");
  assert.deepEqual(result.missing, ["features:instancing"]);
  assert.equal(result.error.code, "unsupported-capability");
  assert.deepEqual(result.error.objectIds, ["stage-workbench"]);
  assert.match(result.error.message, /reference-webgl/);
  assert.match(result.error.suggestedAction, /fallback/);
});

test("explicitly declared fallback turns a capability gap into a warning", () => {
  const result = negotiateRendererCapabilities(
    { ...goldenRequirements, assetFormats: ["glb", "image"] },
    referenceCapabilities(),
    { fallbackCapabilities: ["assetFormats:image"] },
  );

  assert.equal(result.status, "fallback");
  assert.deepEqual(result.missing, ["assetFormats:image"]);
  assert.equal(result.warnings[0].capability, "assetFormats:image");
  assert.equal(result.error, null);
});

test("requirements and capability lists reject malformed or duplicate entries", () => {
  assert.deepEqual(normalizeRequirements({ projection: "orthographic" }).projections, ["orthographic"]);
  assert.throws(
    () => normalizeRequirements({ features: ["instancing", "instancing"] }),
    /duplicate capability/,
  );
  assert.throws(
    () => negotiateRendererCapabilities(goldenRequirements, referenceCapabilities({ features: "instancing" })),
    /capabilities\.features must be an array/,
  );
  assert.throws(
    () => negotiateRendererCapabilities(goldenRequirements, referenceCapabilities({ features: ["instancing", "instancing"] })),
    /capabilities\.features contains duplicate capability/,
  );
});
