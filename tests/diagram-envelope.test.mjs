import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertDiagramEnvelope,
  DIAGRAM_FORMAT,
  DIAGRAM_SCHEMA_VERSION,
} from "../contracts/diagram-envelope.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("the Golden Case is a valid Diagram file envelope", async () => {
  const schema = await readJson(join(repoRoot, "contracts/diagram.schema.json"));
  const artifact = await readJson(join(repoRoot, "examples/flovvas-massing.diagram.json"));

  assert.deepEqual(schema.required.slice(0, 4), ["format", "schemaVersion", "id", "metadata"]);
  assert.equal(schema.properties.format.const, DIAGRAM_FORMAT);
  assert.equal(schema.properties.schemaVersion.const, DIAGRAM_SCHEMA_VERSION);
  assert.doesNotThrow(() => assertDiagramEnvelope(artifact));
});

test("missing or incompatible envelope fields are rejected before parsing", () => {
  const valid = {
    format: DIAGRAM_FORMAT,
    schemaVersion: DIAGRAM_SCHEMA_VERSION,
    id: "example-diagram",
    metadata: {
      title: "Example",
      createdAt: "2026-08-22T00:00:00+08:00",
      updatedAt: "2026-08-22T00:00:00+08:00",
    },
  };

  for (const [label, candidate] of [
    ["missing format", { ...valid, format: undefined }],
    ["wrong format", { ...valid, format: "other.diagram" }],
    ["missing schemaVersion", { ...valid, schemaVersion: undefined }],
    ["wrong schemaVersion", { ...valid, schemaVersion: "0.2.0" }],
  ]) {
    assert.throws(() => assertDiagramEnvelope(candidate), /Diagram envelope|Unsupported/ , label);
  }
});

test("an unknown future version never silently downgrades", () => {
  const future = {
    format: DIAGRAM_FORMAT,
    schemaVersion: "99.0.0",
    id: "future-diagram",
    metadata: {
      title: "Future",
      createdAt: "2026-08-22T00:00:00+08:00",
      updatedAt: "2026-08-22T00:00:00+08:00",
    },
  };

  assert.throws(() => assertDiagramEnvelope(future), /Unsupported Diagram schemaVersion/);
});
