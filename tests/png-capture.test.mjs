import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRenderDocument } from "../contracts/render-document.mjs";
import {
  assertPngCaptureRequest,
  assertPngExportReceipt,
  capturePngWithAdapter,
  createPngCaptureRequest,
  createPngExportReceipt,
} from "../contracts/png-capture.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

async function readDocument() {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const registry = await readJson("examples/flovvas-template-registry.json");
  const catalog = await readJson("examples/flovvas-template-catalog.json");
  const resolved = await Promise.all(registry.templates.map(({ path }) => readJson(path)));
  const resolvedIds = new Set(resolved.map((component) => component.id));
  return createRenderDocument(artifact, {
    revision: "sha256:golden-case-v1",
    components: [
      ...resolved,
      ...catalog.templates.filter((component) => !resolvedIds.has(component.id)),
    ],
  });
}

function options(overrides = {}) {
  return {
    widthPx: 2400,
    heightPx: 900,
    pixelRatio: 2,
    transparentBackground: false,
    includeSafeAreaGuides: false,
    ...overrides,
  };
}

test("capture request carries Effective Layout, view, revision and export layers", async () => {
  const document = await readDocument();
  const request = createPngCaptureRequest(document, options());
  assertPngCaptureRequest(request);
  assert.equal(request.artifactId, document.artifactId);
  assert.equal(request.revision, "sha256:golden-case-v1");
  assert.deepEqual(request.effectiveLayout, document.effectiveLayout);
  assert.deepEqual(request.layers, ["scene", "routes", "phaseZones", "annotations"]);
  assert.equal(request.options.includeEditorChrome, false);
  assert.equal(request.options.range, "spread");

  request.effectiveLayout.nodes["stage-line"].x = 999;
  assert.equal(document.effectiveLayout.nodes["stage-line"].x, 70);
});

test("page capture validates the requested page and rejects editor chrome or invalid dimensions", async () => {
  const document = await readDocument();
  const pageRequest = createPngCaptureRequest(document, options({ range: "page", pageId: "page-left", widthPx: 1200, heightPx: 1600 }));
  assert.equal(pageRequest.options.range, "page");
  assert.equal(pageRequest.options.pageId, "page-left");
  assert.throws(() => createPngCaptureRequest(document, options({ range: "page", pageId: "missing-page" })), /page does not resolve/);
  assert.throws(() => createPngCaptureRequest(document, options({ includeEditorChrome: true })), /never includes editor chrome/);
  assert.throws(() => createPngCaptureRequest(document, options({ widthPx: 0 })), /widthPx/);
});

test("adapter capture returns actual dimensions and the same Artifact revision", async () => {
  const document = await readDocument();
  let received;
  const receipt = await capturePngWithAdapter(document, {
    async capturePng(request) {
      received = request;
      request.effectiveLayout.nodes["stage-line"].x = 1234;
      return {
        revision: request.revision,
        widthPx: 2400,
        heightPx: 900,
        warnings: ["Reference Renderer fallback used for one template."],
        outputRef: "memory://png/golden-case",
      };
    },
  }, options());

  assertPngExportReceipt(receipt);
  assert.equal(receipt.revision, document.revision);
  assert.equal(receipt.widthPx, 2400);
  assert.equal(receipt.heightPx, 900);
  assert.equal(receipt.pixelRatio, 2);
  assert.equal(received.revision, document.revision);
  assert.equal(document.effectiveLayout.nodes["stage-line"].x, 70);
});

test("adapter failures and revision mismatches become structured export errors", async () => {
  const document = await readDocument();
  await assert.rejects(
    () => capturePngWithAdapter(document, { capturePng: async () => { throw new Error("GPU unavailable"); } }, options()),
    (error) => error.code === "export-failed" && error.objectIds.includes(document.artifactId) && error.fieldPath === "capturePng",
  );
  await assert.rejects(
    () => capturePngWithAdapter(document, { capturePng: async () => ({ revision: "sha256:other", widthPx: 1, heightPx: 1 }) }, options()),
    (error) => error.code === "export-failed" && /revision/.test(error.message),
  );
  await assert.rejects(
    () => capturePngWithAdapter(document, {}, options()),
    (error) => error.code === "export-failed" && /capturePng/.test(error.message),
  );
});

test("receipt validation keeps warnings and output reference outside the Artifact", async () => {
  const document = await readDocument();
  const request = createPngCaptureRequest(document, options());
  const receipt = createPngExportReceipt(request, { widthPx: 2400, heightPx: 900, warnings: [] });
  assertPngExportReceipt(receipt);
  assert.equal(receipt.outputRef, null);
  assert.throws(() => createPngExportReceipt(request, { widthPx: 1.5, heightPx: 900 }), /widthPx/);
  assert.throws(() => createPngExportReceipt(request, { widthPx: 2400, heightPx: 900, revision: "sha256:other" }), /revision/);
});
