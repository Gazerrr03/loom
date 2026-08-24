import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createComponentResolver } from "../core/component-resolver.mjs";
import { createComponentToolService } from "../mcp/component-tools.mjs";
import { assertToolResult, createToolCall } from "../contracts/tool-envelope.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

async function fixture() {
  const [catalog, registry] = await Promise.all([
    readJson("examples/flovvas-template-catalog.json"),
    readJson("examples/flovvas-template-registry.json"),
  ]);
  const manifests = await Promise.all(registry.templates.map((entry) => readJson(entry.path)));
  const resolver = createComponentResolver({
    catalog,
    registry,
    manifests,
    capabilities: {
      adapterId: "reference-webgl",
      adapterVersion: "0.1.0",
      projections: ["orthographic"],
      componentKinds: ["parametric-scene", "fallback"],
      interactions: ["pick", "move-plane"],
      exports: ["png"],
      assetFormats: ["glb", "gltf"],
      features: ["orthographic-camera", "instancing"],
    },
  });
  return { catalog, service: createComponentToolService({ catalog, resolver }) };
}

test("semantic and node-type query returns reasons, parameters, fallback and mapping", async () => {
  const { service } = await fixture();
  const result = await service.execute(createToolCall({
    toolName: "component.query",
    requestId: "component-query-001",
    input: { nodeType: "product-stage", semanticQuery: "分支" },
  }));
  assertToolResult(result);
  assert.equal(result.status, "ok");
  assert.equal(result.result.matches[0].id, "flovvas-branch");
  assert.ok(result.result.matches[0].reasons.some((reason) => reason.kind === "semantic-term"));
  assert.ok(result.result.matches[0].parametersSchema.properties);
  assert.equal(result.result.matches[0].fallback.componentRef, "generic-card-slab");
  assert.equal(result.result.matches[0].mapping.status, "mapped");
  assert.equal(Object.hasOwn(result.result.matches[0], "rendererMappings"), false);
  assertToolResult(result);
});

test("default query lists all catalog templates and get exposes the same safe definition", async () => {
  const { service } = await fixture();
  const all = await service.execute(createToolCall({ toolName: "component.query", requestId: "component-all", input: {} }));
  assert.equal(all.result.matches.length, 9);
  assert.equal(all.result.matches[0].reasons[0].kind, "catalog-default");
  const get = await service.execute(createToolCall({ toolName: "component.get", requestId: "component-get", input: { templateId: "flovvas-workbench" } }));
  assert.equal(get.result.template.id, "flovvas-workbench");
  assert.equal(get.result.template.defaults.modules, 5);
  assert.equal(get.result.mapping.status, "mapped");
  assert.equal(Object.hasOwn(get.result.template, "rendererMappings"), false);
  assertToolResult(get);
});

test("no match and unknown template return actionable read-only errors", async () => {
  const { service } = await fixture();
  const none = await service.execute(createToolCall({
    toolName: "component.query",
    requestId: "component-none",
    input: { nodeType: "not-a-real-node", semanticQuery: "不存在" },
  }));
  assert.equal(none.status, "ok");
  assert.deepEqual(none.result.matches, []);
  assert.match(none.result.message, /没有模板/);
  const unknown = await service.execute(createToolCall({
    toolName: "component.get",
    requestId: "component-unknown",
    input: { templateId: "missing-template" },
  }));
  assert.equal(unknown.status, "error");
  assert.equal(unknown.error.code, "unsupported-template");
  assert.deepEqual(unknown.error.objectIds, ["missing-template"]);
});

test("query errors do not expose Renderer-private fields or mutate the catalog", async () => {
  const { catalog, service } = await fixture();
  const before = JSON.stringify(catalog);
  const result = await service.execute(createToolCall({ toolName: "component.query", requestId: "component-invalid", input: { semanticQuery: 42 } }));
  assert.equal(result.status, "error");
  assert.equal(JSON.stringify(catalog), before);
  assert.doesNotMatch(JSON.stringify(result), /rendererMappings|scene|mesh|camera/);
});
