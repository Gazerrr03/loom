import { access } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDiagramError } from "./diagram-error.mjs";

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const ASSET_KINDS = new Set(["primitive", "parametric-scene", "gltf-model", "image", "font"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sourceKind(uri) {
  if (uri.startsWith("loom://")) return "builtin";
  if (uri.startsWith("data:")) return "embedded-data";
  if (uri.startsWith("file://")) return "local-file-url";
  if (/^https?:\/\//i.test(uri)) return "remote";
  if (isAbsolute(uri)) return "local-absolute";
  return "local-relative";
}

function localPath(uri, baseDir) {
  if (uri.startsWith("file://")) return fileURLToPath(uri);
  return isAbsolute(uri) ? uri : resolve(baseDir, uri);
}

export function assertAssetReference(asset) {
  if (!isRecord(asset)) throw new TypeError("asset reference must be an object");
  if (typeof asset.id !== "string" || !ID_PATTERN.test(asset.id)) throw new Error("asset.id must be a stable identifier");
  if (!ASSET_KINDS.has(asset.kind)) throw new Error(`asset.kind is unsupported: ${String(asset.kind)}`);
  if (typeof asset.uri !== "string" || asset.uri.length === 0) throw new Error("asset.uri must be a non-empty source reference");
  if (asset.uri.startsWith("data:")) throw new Error("asset.uri must not embed binary data");
  if (typeof asset.license !== "string" || asset.license.length === 0) throw new Error("asset.license is required");
  if (asset.kind === "gltf-model" && !/\.(?:glb|gltf)(?:[?#].*)?$/i.test(asset.uri)) {
    throw new Error("gltf-model asset.uri must reference a .glb or .gltf file");
  }
  return asset;
}

/**
 * Check source availability without changing or deleting the semantic node
 * that references the asset. Local absolute paths are intentionally allowed
 * for MVP, but they are environment-bound and therefore not portable.
 */
export async function inspectAssetAvailability(asset, { baseDir = process.cwd() } = {}) {
  assertAssetReference(asset);
  const kind = sourceKind(asset.uri);
  if (kind === "builtin") return { assetId: asset.id, status: "available", sourceKind: kind };
  if (kind === "remote") {
    return {
      assetId: asset.id,
      status: "unverified",
      sourceKind: kind,
      warning: "Remote asset availability is not verified in the MVP runtime.",
    };
  }
  try {
    await access(localPath(asset.uri, baseDir));
    return { assetId: asset.id, status: "available", sourceKind: kind };
  } catch {
    return {
      assetId: asset.id,
      status: "missing",
      sourceKind: kind,
      warning: "Asset source is unavailable in the current environment.",
    };
  }
}

export async function inspectAssets(assets, options = {}) {
  if (!Array.isArray(assets)) throw new Error("assets must be an array");
  const seen = new Set();
  for (const asset of assets) {
    assertAssetReference(asset);
    if (seen.has(asset.id)) throw new Error(`Duplicate asset ID: ${asset.id}`);
    seen.add(asset.id);
  }
  return Promise.all(assets.map((asset) => inspectAssetAvailability(asset, options)));
}

/** Missing/unverified sources block PNG export but never remove semantic nodes. */
export function evaluatePngAssetGate(assets, availability) {
  if (!Array.isArray(assets) || !Array.isArray(availability)) throw new Error("assets and availability must be arrays");
  const byId = new Map(availability.map((entry) => [entry.assetId, entry]));
  const warnings = [];
  for (const asset of assets) {
    const entry = byId.get(asset.id);
    if (!entry || entry.status !== "available") {
      warnings.push({
        assetId: asset.id,
        code: "missing-asset",
        message: entry?.warning ?? "Asset availability was not confirmed.",
      });
    }
  }
  if (warnings.length === 0) return { status: "ready", warnings: [], error: null };
  return {
    status: "blocked",
    warnings,
    error: createDiagramError({
      code: "missing-asset",
      message: "PNG export is blocked because one or more assets are unavailable.",
      objectIds: warnings.map((warning) => warning.assetId),
      fieldPath: "assets",
      recoverable: true,
      suggestedAction: "Restore the asset sources before exporting PNG.",
    }),
  };
}

export { sourceKind };
