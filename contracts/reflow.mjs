import { assertGeneratedLayout } from "./generated-layout.mjs";
import { assertLayout, mergeEffectiveLayout } from "./layout.mjs";
import { assertSemanticGraph } from "./semantic-graph.mjs";

const COLLECTIONS = ["nodes", "routes", "groups"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function emptyOverrides() {
  return { nodes: {}, routes: {}, groups: {}, view: {} };
}

function assertGeneratedResult(artifact, generatedLayout) {
  if (!isRecord(generatedLayout) || !isRecord(generatedLayout.engine) || !isRecord(generatedLayout.generated)) {
    throw new TypeError("generatedLayout must contain engine and generated");
  }
  assertGeneratedLayout(artifact, generatedLayout);
}

/**
 * Keep field-level Human Override entries that still have a Generated Layout
 * target. Deleted semantic objects lose their stale overrides; existing
 * objects keep every explicit field, even when the generator changed siblings.
 */
export function retainApplicableOverrides(overrides, generated) {
  const source = isRecord(overrides) ? overrides : emptyOverrides();
  const next = { nodes: {}, routes: {}, groups: {}, view: clone(source.view ?? {}) };
  for (const collection of COLLECTIONS) {
    const sourceCollection = isRecord(source[collection]) ? source[collection] : {};
    for (const [id, value] of Object.entries(sourceCollection)) {
      if (Object.hasOwn(generated[collection], id)) next[collection][id] = clone(value);
    }
  }
  return next;
}

/**
 * Replace Generated Layout after a semantic edit without moving unrelated
 * manual decisions. The returned artifact is a new value and keeps the source
 * artifacts untouched, so Workspace can submit it as one undoable command.
 */
export function reconcileGeneratedLayout(previousArtifact, nextArtifact, generatedLayout) {
  if (!isRecord(previousArtifact) || !isRecord(nextArtifact)) throw new TypeError("artifacts must be objects");
  assertSemanticGraph(previousArtifact.semantic);
  assertSemanticGraph(nextArtifact.semantic);
  assertLayout(previousArtifact.layout);
  assertLayout(nextArtifact.layout);
  assertGeneratedResult(nextArtifact, generatedLayout);
  const next = clone(nextArtifact);
  next.layout = {
    engine: clone(generatedLayout.engine),
    generated: clone(generatedLayout.generated),
    overrides: retainApplicableOverrides(previousArtifact.layout.overrides, generatedLayout.generated),
  };
  return next;
}

export function effectiveLayoutAfterReflow(previousArtifact, nextArtifact, generatedLayout) {
  const next = reconcileGeneratedLayout(previousArtifact, nextArtifact, generatedLayout);
  return { artifact: next, effectiveLayout: mergeEffectiveLayout(next.layout, next.composition.defaultView) };
}
