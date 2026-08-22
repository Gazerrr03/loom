import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertComponentRefsResolve,
  assertComponentTemplateCatalog,
  queryComponentTemplates,
} from "../contracts/component-template-catalog.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readCatalog() {
  return readJson(join(repoRoot, "examples/flovvas-template-catalog.json"));
}

test("the catalog fixes seven Golden Template identities and resolves fixture componentRefs", async () => {
  const catalog = await readCatalog();
  const artifact = await readJson(join(repoRoot, "examples/flovvas-massing.diagram.json"));

  assert.doesNotThrow(() => assertComponentTemplateCatalog(catalog));
  assert.equal(catalog.goldenTemplateIds.length, 7);
  assert.doesNotThrow(() => assertComponentRefsResolve(artifact, catalog));
  assert.ok(catalog.goldenTemplateIds.every((id) => artifact.semantic.nodes.some((node) => node.componentRef === id)));
});

test("node type and semantic words return the same identity with explicit match reasons", async () => {
  const catalog = await readCatalog();
  const line = queryComponentTemplates(catalog, { nodeType: "product-stage", semanticQuery: "linear conversation" })[0];
  assert.equal(line.templateId, "flovvas-line");
  assert.deepEqual(line.reasons.map((reason) => reason.kind), ["node-type", "semantic-term"]);
  assert.match(line.reasons[0].label, /节点类型/);

  const workbench = queryComponentTemplates(catalog, { semanticQuery: "compounding workspace" })[0];
  assert.equal(workbench.templateId, "flovvas-workbench");
  assert.equal(workbench.reasons[0].kind, "semantic-term");
});

test("identity fields stay strict and unknown componentRefs fail with a useful path", async () => {
  const catalog = await readCatalog();
  const invalid = structuredClone(catalog);
  invalid.templates[0].searchTerms = [];
  assert.throws(() => assertComponentTemplateCatalog(invalid), /searchTerms/);

  const artifact = await readJson(join(repoRoot, "examples/flovvas-massing.diagram.json"));
  artifact.semantic.nodes[0].componentRef = "missing-template";
  assert.throws(() => assertComponentRefsResolve(artifact, catalog), /semantic\.nodes\[0\]\.componentRef/);
});
