import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "examples/flovvas-massing.golden-case.json");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("Golden Case manifest identifies and versions its artifact", async () => {
  const manifest = await readJson(manifestPath);

  assert.equal(manifest.format, "loom.golden-case");
  assert.match(manifest.schemaVersion, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.caseId, /^[a-z][a-z0-9-]+$/);
  assert.match(manifest.caseVersion, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.artifactId, /^[a-z][a-z0-9-]+$/);
  assert.match(manifest.artifactRevision, /^sha256:[a-f0-9]{64}$/);

  const artifactPath = resolve(repoRoot, manifest.artifactPath);
  const sourcePath = resolve(repoRoot, manifest.semanticSourcePath);
  const artifact = await readJson(artifactPath);
  const source = await readFile(sourcePath, "utf8");
  const artifactBytes = await readFile(artifactPath);
  const revision = `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}`;

  assert.equal(artifact.id, manifest.artifactId);
  assert.equal(revision, manifest.artifactRevision);
  assert.ok(source.includes("- **Case ID:** `" + manifest.caseId + "`"));
  assert.ok(source.includes("- **Case version:** `" + manifest.caseVersion + "`"));
  assert.ok(source.includes("examples/flovvas-massing.golden-case.json"));
});
