import { createDiagramError } from "./diagram-error.mjs";
import { negotiateRendererCapabilities } from "./renderer-capabilities.mjs";
import { assertRenderDocument } from "./render-document.mjs";
import {
  assertIcraftSceneCatalog,
  selectIcraftScene,
} from "./icraft-scene-catalog.mjs";

const DEFAULT_CAPABILITIES = Object.freeze({
  adapterId: "icraft-player",
  adapterVersion: "public-player-api",
  projections: ["orthographic", "perspective"],
  componentKinds: ["parametric-scene"],
  interactions: ["pick", "orbit-view"],
  exports: ["png"],
  assetFormats: ["iplayer"],
  features: ["scene-load", "remote-iplayer", "orthographic-camera", "png-export"],
});
const DEFAULT_LOAD_TIMEOUT_MS = 15_000;

function clone(value) {
  return structuredClone(value);
}

function errorResult(code, message, { objectIds = [], fieldPath = "renderer", suggestedAction, suggestedFallback = "reference-renderer", cause } = {}) {
  return {
    status: "error",
    error: createDiagramError({
      code,
      message,
      objectIds,
      fieldPath,
      recoverable: true,
      suggestedAction,
      suggestedFallback,
      cause,
    }),
  };
}

function fallbackResult(sceneId, sourceUri, error, warnings = []) {
  return {
    status: "fallback",
    adapterId: DEFAULT_CAPABILITIES.adapterId,
    sceneId,
    sourceUri,
    fallbackAdapterId: "reference-renderer",
    warnings,
    error,
  };
}

function assertHost(host) {
  if (host === null || (typeof host !== "object" && typeof host !== "function")) {
    throw new TypeError("iCraft Player host must be an object");
  }
}

function clearHost(host) {
  if (typeof host?.replaceChildren === "function") host.replaceChildren();
  else if (typeof host?.textContent === "string") host.textContent = "";
}

async function disposePlayer(player) {
  if (!player) return;
  if (typeof player.dispose === "function") await player.dispose();
  else if (typeof player.destroy === "function") await player.destroy();
}

/**
 * Create a thin adapter around the public iCraft Player constructor.
 *
 * The adapter owns only the transient Player instance. The catalog entry and
 * RenderDocument remain the sources of truth; no Player object is returned in
 * a receipt or written into a Diagram artifact.
 */
export function createIcraftPlayerAdapter({ catalog, playerFactory } = {}) {
  assertIcraftSceneCatalog(catalog);
  if (typeof playerFactory !== "function") throw new TypeError("playerFactory must be a function");

  let host = null;
  let player = null;
  let activeSceneId = null;
  let activeSourceUri = null;
  let state = "idle";

  async function unload() {
    const previousPlayer = player;
    player = null;
    activeSceneId = null;
    activeSourceUri = null;
    state = "idle";
    await disposePlayer(previousPlayer);
    clearHost(host);
    return { status: "unloaded", adapterId: DEFAULT_CAPABILITIES.adapterId };
  }

  async function dispose() {
    await unload();
    host = null;
    state = "idle";
    return { status: "disposed", adapterId: DEFAULT_CAPABILITIES.adapterId };
  }

  async function getCapabilities() {
    return clone(DEFAULT_CAPABILITIES);
  }

  async function mount(nextHost) {
    assertHost(nextHost);
    if (host && host !== nextHost) await unload();
    host = nextHost;
    state = "mounted";
    return { status: "mounted", adapterId: DEFAULT_CAPABILITIES.adapterId };
  }

  async function load(document, {
    sceneId,
    requirements = {},
    fallbackCapabilities = [],
    timeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
  } = {}) {
    assertRenderDocument(document);
    if (!host) {
      return errorResult("invalid-tool-input", "iCraft Player must be mounted before loading a scene.", {
        fieldPath: "renderer.host",
        suggestedAction: "Mount the Workspace host element before loading the selected scene.",
      });
    }
    if (typeof sceneId !== "string" || sceneId.length === 0) {
      return errorResult("invalid-tool-input", "An iCraft scene ID is required before loading.", {
        fieldPath: "renderer.sceneId",
        suggestedAction: "Select a catalog scene before loading the Renderer.",
      });
    }

    let selection;
    try {
      selection = selectIcraftScene(catalog, sceneId);
    } catch (cause) {
      return errorResult("invalid-tool-input", `Unknown iCraft scene selection: ${sceneId}.`, {
        objectIds: [sceneId],
        fieldPath: "renderer.sceneId",
        suggestedAction: "Choose a scene from the registered iCraft catalog.",
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
    if (selection.assessment.status === "blocked") {
      const error = createDiagramError({
        code: "missing-asset",
        message: `iCraft scene ${sceneId} cannot be loaded: ${selection.assessment.reasons.join("; ")}.`,
        objectIds: [sceneId],
        fieldPath: "assets",
        recoverable: true,
        suggestedAction: "Restore or authorize the scene source, or continue with the Reference Renderer fallback.",
        suggestedFallback: "reference-renderer",
      });
      return fallbackResult(sceneId, selection.scene.source.uri, error);
    }

    const capabilities = await getCapabilities();
    const negotiation = negotiateRendererCapabilities(
      {
        projection: "orthographic",
        componentKinds: ["parametric-scene"],
        assetFormats: ["iplayer"],
        ...requirements,
      },
      capabilities,
      { objectIds: [sceneId], fallbackCapabilities },
    );
    if (negotiation.status === "error") {
      return {
        ...negotiation,
        sceneId,
        sourceUri: selection.scene.source.uri,
        fallbackAdapterId: "reference-renderer",
      };
    }

    if (player || activeSceneId || state === "fallback") await unload();
    else state = "idle";
    state = "loading";
    const sourceUri = selection.scene.source.uri;
    const warnings = [...selection.assessment.warnings, ...negotiation.warnings.map((warning) => warning.message)];
    try {
      let settled = false;
      let readyInstance;
      let timeoutHandle;
      const ready = new Promise((resolve, reject) => {
        const onReady = (instance) => {
          if (settled) return;
          settled = true;
          readyInstance = instance;
          resolve(instance);
        };
        const onError = (cause) => {
          if (settled) return;
          settled = true;
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        };
        let result;
        try {
          result = playerFactory({ src: sourceUri, container: host, onReady, onError });
        } catch (error) {
          onError(error);
          return;
        }
        timeoutHandle = setTimeout(() => {
          onError(new Error(`iCraft Player load timed out after ${timeoutMs} ms.`));
        }, timeoutMs);
        Promise.resolve(result).then((instance) => {
          if (instance && !settled) onReady(instance);
          else if (instance && instance !== readyInstance) disposePlayer(instance);
        }, onError);
      });
      try {
        player = await ready;
      } finally {
        clearTimeout(timeoutHandle);
      }
      activeSceneId = sceneId;
      activeSourceUri = sourceUri;
      state = "ready";
      return {
        status: negotiation.status === "fallback" ? "fallback" : "ready",
        adapterId: DEFAULT_CAPABILITIES.adapterId,
        adapterVersion: DEFAULT_CAPABILITIES.adapterVersion,
        sceneId,
        sourceUri,
        revision: document.revision,
        warnings,
        error: null,
      };
    } catch (cause) {
      await unload();
      state = "fallback";
      const error = createDiagramError({
        code: "render-failed",
        message: `iCraft scene ${sceneId} failed to load.`,
        objectIds: [sceneId],
        fieldPath: "assets",
        recoverable: true,
        suggestedAction: "Check the scene URL and authorization, then retry or use the Reference Renderer fallback.",
        suggestedFallback: "reference-renderer",
        cause: cause instanceof Error ? cause.message : String(cause),
      });
      return fallbackResult(sceneId, sourceUri, error, warnings);
    }
  }

  return {
    getCapabilities,
    mount,
    load,
    unload,
    dispose,
    getState() {
      return {
        state,
        sceneId: activeSceneId,
        sourceUri: activeSourceUri,
        mounted: Boolean(host),
      };
    },
  };
}

export { DEFAULT_CAPABILITIES };
