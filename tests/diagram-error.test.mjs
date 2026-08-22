import assert from "node:assert/strict";
import test from "node:test";
import { assertDiagramError, createDiagramError } from "../contracts/diagram-error.mjs";

test("representative validation failures share one actionable error envelope", () => {
  const cases = [
    {
      code: "duplicate-id",
      message: "Semantic ID is used twice.",
      objectIds: ["stage-line"],
      fieldPath: "semantic.nodes[0].id",
      recoverable: true,
      suggestedAction: "Rename the duplicate object ID.",
    },
    {
      code: "dangling-reference",
      message: "Edge target does not exist.",
      objectIds: ["edge-split", "stage-line"],
      fieldPath: "semantic.edges[0].target",
      recoverable: true,
      suggestedAction: "Choose an existing node ID.",
    },
    {
      code: "unsupported-version",
      message: "Diagram schema version is not supported.",
      objectIds: [],
      fieldPath: "schemaVersion",
      recoverable: false,
      suggestedAction: "Open the file with a compatible Loom version.",
    },
    {
      code: "missing-asset",
      message: "Referenced GLB asset is unavailable.",
      objectIds: ["asset-card-slab"],
      fieldPath: "assets[0].uri",
      recoverable: true,
      suggestedAction: "Restore the asset or choose a fallback component.",
    },
  ];

  for (const input of cases) {
    const error = createDiagramError(input);
    assert.doesNotThrow(() => assertDiagramError(error));
    assert.equal(typeof error.code, "string");
    assert.ok(Array.isArray(error.objectIds));
    assert.equal(typeof error.fieldPath, "string");
    assert.equal(typeof error.recoverable, "boolean");
    assert.equal(typeof error.suggestedAction, "string");
  }
});

test("error validation rejects unsupported codes, malformed paths, and leaked local paths", () => {
  assert.throws(
    () => createDiagramError({
      code: "unknown-error",
      message: "Nope",
      recoverable: false,
    }),
    /Unsupported error code/,
  );
  assert.throws(
    () => createDiagramError({
      code: "invalid-layout",
      message: "Bad layout",
      fieldPath: "/Users/qizhi/Desktop/diagram.json",
      recoverable: true,
    }),
    /safe field path/,
  );
  assert.throws(
    () => createDiagramError({
      code: "render-failed",
      message: "Could not load /Users/qizhi/private.glb",
      recoverable: true,
    }),
    /local path/,
  );
  assert.throws(
    () => createDiagramError({
      code: "missing-asset",
      message: "Asset unavailable",
      recoverable: true,
      suggestedFallback: "/tmp/generic-card-slab.glb",
    }),
    /local path/,
  );
  assert.throws(
    () => assertDiagramError({
      code: "invalid-layout",
      message: "Bad layout",
      objectIds: [],
      fieldPath: null,
      recoverable: true,
      suggestedAction: null,
      cause: null,
      internalDebug: "should not cross the contract",
    }),
    /Unsupported error field/,
  );
});

test("recoverable errors may omit an object or suggestion without losing the envelope", () => {
  const error = createDiagramError({
    code: "unsupported-version",
    message: "Unsupported future version.",
    recoverable: false,
  });
  assert.deepEqual(error.objectIds, []);
  assert.equal(error.fieldPath, null);
  assert.equal(error.suggestedAction, null);
  assert.equal(error.cause, null);
});
