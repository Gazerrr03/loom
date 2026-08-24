import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createIcraftPlayerAdapter,
  DEFAULT_CAPABILITIES,
} from "../contracts/icraft-player-adapter.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readCatalog() {
  return JSON.parse(await readFile(join(repoRoot, "examples/icraft-scene-catalog.json"), "utf8"));
}

function renderDocument() {
  return {
    artifactId: "flovvas-massing-golden-case",
    revision: "sha256:before",
    semantic: { nodes: [], edges: [], groups: [] },
    composition: {},
    effectiveLayout: { nodes: {}, routes: {}, groups: {}, view: {} },
    annotations: [],
    presentation: {},
    components: {},
    assets: {},
  };
}

function host() {
  return {
    cleared: 0,
    replaceChildren() {
      this.cleared += 1;
    },
  };
}

test("iCraft adapter declares public Player capabilities before loading", async () => {
  const catalog = await readCatalog();
  const adapter = createIcraftPlayerAdapter({ catalog, playerFactory: () => ({}) });
  assert.deepEqual(await adapter.getCapabilities(), DEFAULT_CAPABILITIES);
  assert.deepEqual(adapter.getState(), { state: "idle", sceneId: null, sourceUri: null, mounted: false });
});

test("the browser smoke page uses the public Player bundle and the catalog scene URL without embedding scene data", async () => {
  const html = await readFile(join(repoRoot, "diagrams/icraft-player-load-smoke.html"), "utf8");
  assert.match(html, /@icraft\/player@2\.0\.2\/dist\/umd\/icraft-player\.min\.js/);
  assert.match(html, /https:\/\/icraft\.gantcloud\.com\/api\/static\/templates\/AWSCloud\.iplayer/);
  assert.match(html, /onReady/);
  assert.equal(html.includes("privateSceneTree"), false);
});

test("a selected scene loads into the host without mutating the RenderDocument", async () => {
  const catalog = await readCatalog();
  const renderHost = host();
  const player = { disposeCalled: false, dispose() { this.disposeCalled = true; } };
  let options;
  const adapter = createIcraftPlayerAdapter({
    catalog,
    playerFactory(nextOptions) {
      options = nextOptions;
      nextOptions.onReady(player);
      return player;
    },
  });
  await adapter.mount(renderHost);
  const document = renderDocument();
  const snapshot = structuredClone(document);
  const receipt = await adapter.load(document, { sceneId: "icraft-aws-cloud" });

  assert.equal(receipt.status, "ready");
  assert.equal(receipt.sceneId, "icraft-aws-cloud");
  assert.equal(receipt.revision, document.revision);
  assert.equal(options.src, "https://icraft.gantcloud.com/api/static/templates/AWSCloud.iplayer");
  assert.equal(options.container, renderHost);
  assert.deepEqual(document, snapshot);
  assert.deepEqual(adapter.getState(), {
    state: "ready",
    sceneId: "icraft-aws-cloud",
    sourceUri: options.src,
    mounted: true,
  });

  await adapter.unload();
  assert.equal(player.disposeCalled, true);
  assert.equal(renderHost.cleared, 1);
  assert.deepEqual(adapter.getState(), { state: "idle", sceneId: null, sourceUri: null, mounted: true });

  await adapter.dispose();
  assert.deepEqual(adapter.getState(), { state: "idle", sceneId: null, sourceUri: null, mounted: false });
});

test("missing or unauthorized sources return an explicit Reference Renderer fallback", async () => {
  const catalog = await readCatalog();
  const blockedCatalog = {
    ...catalog,
    scenes: [{ ...catalog.scenes[0], availability: "missing" }],
  };
  let factoryCalls = 0;
  const adapter = createIcraftPlayerAdapter({
    catalog: blockedCatalog,
    playerFactory: () => { factoryCalls += 1; return {}; },
  });
  await adapter.mount(host());
  const result = await adapter.load(renderDocument(), { sceneId: "icraft-aws-cloud" });

  assert.equal(result.status, "fallback");
  assert.equal(result.fallbackAdapterId, "reference-renderer");
  assert.equal(result.error.code, "missing-asset");
  assert.deepEqual(result.error.objectIds, ["icraft-aws-cloud"]);
  assert.equal(factoryCalls, 0);
});

test("an unknown scene selection returns a structured input error before Player construction", async () => {
  const catalog = await readCatalog();
  let factoryCalls = 0;
  const adapter = createIcraftPlayerAdapter({
    catalog,
    playerFactory: () => { factoryCalls += 1; return {}; },
  });
  await adapter.mount(host());
  const result = await adapter.load(renderDocument(), { sceneId: "icraft-does-not-exist" });

  assert.equal(result.status, "error");
  assert.equal(result.error.code, "invalid-tool-input");
  assert.deepEqual(result.error.objectIds, ["icraft-does-not-exist"]);
  assert.equal(factoryCalls, 0);
});

test("capability gaps fail before Player construction and runtime load failures become fallback", async () => {
  const catalog = await readCatalog();
  let factoryCalls = 0;
  const adapter = createIcraftPlayerAdapter({
    catalog,
    playerFactory: () => {
      factoryCalls += 1;
      return Promise.reject(new Error("network unavailable"));
    },
  });
  await adapter.mount(host());
  const unsupported = await adapter.load(renderDocument(), {
    sceneId: "icraft-aws-cloud",
    requirements: { features: ["private-scene-write"] },
  });
  assert.equal(unsupported.status, "error");
  assert.equal(unsupported.error.code, "unsupported-capability");
  assert.equal(factoryCalls, 0);

  const failed = await adapter.load(renderDocument(), { sceneId: "icraft-aws-cloud" });
  assert.equal(failed.status, "fallback");
  assert.equal(failed.error.code, "render-failed");
  assert.equal(failed.error.suggestedFallback, "reference-renderer");
  assert.match(failed.error.cause, /network unavailable/);
});

test("a loading Player cannot leave the adapter pending forever", async () => {
  const catalog = await readCatalog();
  const renderHost = host();
  const adapter = createIcraftPlayerAdapter({
    catalog,
    playerFactory: () => new Promise(() => {}),
  });
  await adapter.mount(renderHost);

  const result = await adapter.load(renderDocument(), { sceneId: "icraft-aws-cloud", timeoutMs: 5 });

  assert.equal(result.status, "fallback");
  assert.equal(result.error.code, "render-failed");
  assert.match(result.error.cause, /timed out after 5 ms/);
  assert.equal(adapter.getState().state, "fallback");
});

test("reloading disposes the old Player and never leaves the previous scene session active", async () => {
  const catalog = await readCatalog();
  const sessions = [];
  const adapter = createIcraftPlayerAdapter({
    catalog,
    playerFactory(nextOptions) {
      const session = { disposed: false, dispose() { this.disposed = true; } };
      sessions.push(session);
      nextOptions.onReady(session);
      return session;
    },
  });
  await adapter.mount(host());
  const document = renderDocument();
  await adapter.load(document, { sceneId: "icraft-aws-cloud" });
  await adapter.load(document, { sceneId: "icraft-aws-cloud" });
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].disposed, true);
  assert.equal(sessions[1].disposed, false);
  assert.equal(adapter.getState().sceneId, "icraft-aws-cloud");
});
