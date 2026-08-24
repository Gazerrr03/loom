const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const AVAILABILITY = new Set(["available", "unverified", "missing", "unauthorized"]);
const AUTHORIZATION = new Set(["personal-use", "explicit", "unknown", "denied"]);
const URI_PATTERN = /^(https?|file):\/\/.+\.iplayer(?:[?#].*)?$/i;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${path} must be a non-empty string`);
}

function assertUniqueStrings(value, path) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${path} must be a non-empty array`);
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    assertNonEmptyString(item, `${path}[${index}]`);
    if (seen.has(item)) throw new Error(`${path} contains duplicate value: ${item}`);
    seen.add(item);
  }
}

function assertSource(source, path = "source") {
  if (!isRecord(source)) throw new TypeError(`${path} must be an object`);
  if (source.kind !== "iplayer") throw new Error(`${path}.kind must be iplayer`);
  if (typeof source.uri !== "string" || !URI_PATTERN.test(source.uri)) {
    throw new Error(`${path}.uri must be an http(s) or file .iplayer reference`);
  }
  assertNonEmptyString(source.version, `${path}.version`);
  assertNonEmptyString(source.license, `${path}.license`);
  if (typeof source.licenseUrl !== "string" || !/^https:\/\//.test(source.licenseUrl)) {
    throw new Error(`${path}.licenseUrl must be an https URL`);
  }
  if (!AUTHORIZATION.has(source.authorizationStatus)) {
    throw new Error(`${path}.authorizationStatus is unsupported: ${String(source.authorizationStatus)}`);
  }
  assertUniqueStrings(source.authorizationEvidence, `${path}.authorizationEvidence`);
  if (source.verifiedAt !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(source.verifiedAt)) {
    throw new Error(`${path}.verifiedAt must use YYYY-MM-DD`);
  }
}

function assertRendererMapping(mapping, path = "rendererMapping") {
  if (!isRecord(mapping)) throw new TypeError(`${path} must be an object`);
  if (mapping.adapterId !== "icraft-player") throw new Error(`${path}.adapterId must be icraft-player`);
  assertNonEmptyString(mapping.implementationRef, `${path}.implementationRef`);
  assertUniqueStrings(mapping.requiredCapabilities, `${path}.requiredCapabilities`);
}

export function assertIcraftSceneEntry(scene, path = "scene") {
  if (!isRecord(scene)) throw new TypeError(`${path} must be an object`);
  if (typeof scene.id !== "string" || !ID_PATTERN.test(scene.id)) throw new Error(`${path}.id must be a stable identifier`);
  assertNonEmptyString(scene.name, `${path}.name`);
  assertNonEmptyString(scene.semanticDescription, `${path}.semanticDescription`);
  assertUniqueStrings(scene.searchTerms, `${path}.searchTerms`);
  if (typeof scene.previewUri !== "string" || scene.previewUri.trim().length === 0) {
    throw new Error(`${path}.previewUri must be a non-empty string`);
  }
  if (!AVAILABILITY.has(scene.availability)) {
    throw new Error(`${path}.availability is unsupported: ${String(scene.availability)}`);
  }
  assertSource(scene.source, `${path}.source`);
  assertRendererMapping(scene.rendererMapping, `${path}.rendererMapping`);
  return scene;
}

export function assertIcraftSceneCatalog(catalog) {
  if (!isRecord(catalog)) throw new TypeError("iCraft scene catalog must be an object");
  if (catalog.format !== "loom.icraft-scene-catalog") throw new Error("catalog.format is unsupported");
  if (catalog.schemaVersion !== "0.1.0") throw new Error("catalog.schemaVersion is unsupported");
  if (!isRecord(catalog.renderer) || catalog.renderer.adapterId !== "icraft-player") {
    throw new Error("catalog.renderer.adapterId must be icraft-player");
  }
  assertNonEmptyString(catalog.renderer.adapterVersion, "catalog.renderer.adapterVersion");
  if (!Array.isArray(catalog.scenes) || catalog.scenes.length === 0) throw new Error("catalog.scenes must not be empty");
  const seen = new Set();
  catalog.scenes.forEach((scene, index) => {
    assertIcraftSceneEntry(scene, `catalog.scenes[${index}]`);
    if (seen.has(scene.id)) throw new Error(`Duplicate iCraft scene ID: ${scene.id}`);
    seen.add(scene.id);
  });
  return catalog;
}

function searchableText(scene) {
  return [scene.id, scene.name, scene.semanticDescription, ...scene.searchTerms].join(" ").toLocaleLowerCase();
}

export function searchIcraftScenes(catalog, query = "") {
  assertIcraftSceneCatalog(catalog);
  const needle = String(query).trim().toLocaleLowerCase();
  return catalog.scenes
    .filter((scene) => needle.length === 0 || searchableText(scene).includes(needle))
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function assessIcraftSceneSelection(scene) {
  assertIcraftSceneEntry(scene);
  const reasons = [];
  if (scene.availability === "missing") reasons.push("scene source is missing");
  if (scene.availability === "unauthorized") reasons.push("scene source is not authorized");
  if (scene.source.authorizationStatus === "unknown") reasons.push("authorization has not been confirmed");
  if (scene.source.authorizationStatus === "denied") reasons.push("authorization was denied");
  const blocked = reasons.length > 0;
  const warnings = scene.availability === "unverified" ? ["remote scene availability is not verified"] : [];
  return {
    status: blocked ? "blocked" : warnings.length > 0 ? "selectable-with-warning" : "selectable",
    reasons,
    warnings,
  };
}

export function toDiagramAssetReference(scene) {
  const assessment = assessIcraftSceneSelection(scene);
  if (assessment.status === "blocked") {
    throw new Error(`iCraft scene cannot be selected: ${assessment.reasons.join("; ")}`);
  }
  return {
    id: scene.id,
    kind: "parametric-scene",
    uri: scene.source.uri,
    mediaType: "application/vnd.icraft.iplayer",
    license: scene.source.license,
  };
}

export function selectIcraftScene(catalog, sceneId) {
  assertIcraftSceneCatalog(catalog);
  const scene = catalog.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new Error(`Unknown iCraft scene: ${sceneId}`);
  const assessment = assessIcraftSceneSelection(scene);
  return {
    scene,
    assessment,
    assetReference: assessment.status === "blocked" ? null : toDiagramAssetReference(scene),
  };
}

export { AVAILABILITY, AUTHORIZATION };
