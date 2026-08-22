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

test("Golden Case acceptance evidence has a stable, revision-bound shape", async () => {
  const manifest = await readJson(manifestPath);
  const acceptance = await readJson(resolve(repoRoot, manifest.acceptancePath));
  const expectedChecks = ["structure", "layout", "render", "export"];
  const allowedStatuses = new Set(["pass", "pending", "fail"]);
  const allowedConclusions = new Set([
    "accept",
    "continue-refinement",
    "change-strategy",
  ]);

  assert.equal(acceptance.format, "loom.golden-case.acceptance");
  assert.equal(acceptance.caseId, manifest.caseId);
  assert.equal(acceptance.caseVersion, manifest.caseVersion);
  assert.equal(acceptance.artifactId, manifest.artifactId);
  assert.equal(acceptance.artifactRevision, manifest.artifactRevision);
  assert.deepEqual(Object.keys(acceptance.checks).sort(), [...expectedChecks].sort());
  assert.ok(allowedConclusions.has(acceptance.authorConclusion));
  assert.match(acceptance.recordedAt, /^\d{4}-\d{2}-\d{2}T/);

  for (const checkName of expectedChecks) {
    const check = acceptance.checks[checkName];
    assert.ok(allowedStatuses.has(check.status), `${checkName} has invalid status`);
    assert.ok(
      typeof check.evidence === "string" || check.evidence === null,
      `${checkName} evidence must be text or null`,
    );
  }
});
