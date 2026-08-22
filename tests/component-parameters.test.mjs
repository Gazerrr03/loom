import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertParameterContract,
  parameterFingerprint,
  resolveParameters,
} from "../contracts/component-parameters.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readManifest() {
  return JSON.parse(await readFile(join(repoRoot, "examples/flovvas-workbench.component.json"), "utf8"));
}

test("Workbench defaults satisfy its parameter schema and resolve predictably", async () => {
  const manifest = await readManifest();
  assert.doesNotThrow(() => assertParameterContract(manifest));
  assert.deepEqual(resolveParameters(manifest), manifest.defaults);
  assert.deepEqual(resolveParameters(manifest, { modules: 7 }), {
    modules: 7,
    tiers: 2,
    openness: 0.65,
  });
});

test("range, type, and unknown parameter errors identify the parameter path", async () => {
  const manifest = await readManifest();
  for (const [input, pattern] of [
    [{ modules: 10 }, /parameters\.modules must be <= 9/],
    [{ openness: "wide" }, /parameters\.openness must be a finite number/],
    [{ unknown: true }, /parameters\.unknown is not an accepted parameter/],
  ]) {
    assert.throws(() => resolveParameters(manifest, input), pattern);
  }
});

test("the same resolved parameters have a stable order-independent fingerprint", async () => {
  const manifest = await readManifest();
  const first = parameterFingerprint(manifest, { openness: 0.8, modules: 6 });
  const second = parameterFingerprint(manifest, { modules: 6, openness: 0.8 });
  assert.match(first, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first, second);
});

test("an invalid default is rejected before any component instance is resolved", async () => {
  const manifest = await readManifest();
  manifest.defaults.modules = 99;
  assert.throws(() => assertParameterContract(manifest), /defaults\.modules must be <= 9/);
});
