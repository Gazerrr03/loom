import {
  assertDiagramArtifact,
  createDiagram,
  loadDiagram,
  saveDiagram,
} from "./artifact-store.mjs";
import { applyDomainCommand } from "../contracts/interaction-commit.mjs";
import { generateLayout } from "../contracts/generated-layout.mjs";
import { mergeEffectiveLayout } from "../contracts/layout.mjs";
import { reconcileGeneratedLayout } from "../contracts/reflow.mjs";

function clone(value) {
  return structuredClone(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertCoreState(state) {
  if (!isRecord(state) || !isRecord(state.artifact)) {
    throw new TypeError("Core state must contain an artifact");
  }
  assertDiagramArtifact(state.artifact);
  if (!(state.revision === null || typeof state.revision === "string")) {
    throw new Error("Core state revision must be null or a string");
  }
  if (!isRecord(state.effectiveLayout)) {
    throw new Error("Core state effectiveLayout must be an object");
  }
  return state;
}

function resolveSeed(artifact, seed) {
  return seed ?? artifact.layout.engine.seed ?? "layout-v1";
}

function deriveArtifact(artifact, { seed, constraints } = {}) {
  const validated = createDiagram(artifact);
  const generated = generateLayout(validated, {
    seed: resolveSeed(validated, seed),
    constraints,
  });
  const next = reconcileGeneratedLayout(validated, validated, generated.layout);
  return {
    artifact: next,
    effectiveLayout: mergeEffectiveLayout(next.layout, next.composition.defaultView),
    constraintReport: clone(generated.constraintReport),
  };
}

function stateFromDerived(derived, revision = null) {
  return {
    artifact: derived.artifact,
    effectiveLayout: derived.effectiveLayout,
    constraintReport: derived.constraintReport,
    revision,
    updatedAt: derived.artifact.metadata.updatedAt,
  };
}

/**
 * Create the shared Core state for an in-memory Diagram.
 *
 * The returned state is renderer-independent. A null revision means that the
 * artifact has not been persisted by this Core session yet.
 */
export function createCoreState(artifact, options = {}) {
  return stateFromDerived(deriveArtifact(artifact, options), options.revision ?? null);
}

/** Load, validate, derive, and return one Core state from a Diagram file. */
export async function openCore(filePath, options = {}) {
  const loaded = await loadDiagram(filePath);
  return stateFromDerived(deriveArtifact(loaded.artifact, options), loaded.revision);
}

/**
 * Apply one Domain Command without mutating the supplied Core state.
 * Persisted states reject commands based on a stale revision before writing an
 * Override; unsaved states use the command's own validation only.
 */
export function applyCoreCommand(state, command, options = {}) {
  assertCoreState(state);
  if (state.revision !== null && command.baseRevision !== state.revision) {
    throw new Error("Core revision changed before command");
  }
  const artifact = applyDomainCommand(state.artifact, command);
  return createCoreState(artifact, {
    ...options,
    revision: state.revision,
    seed: options.seed ?? artifact.layout.engine.seed,
  });
}

/**
 * Reconcile a semantic edit against the previous state while retaining only
 * applicable field-level Human Override entries.
 */
export function reflowCore(previousState, nextArtifact, options = {}) {
  assertCoreState(previousState);
  const validated = createDiagram(nextArtifact);
  const generated = generateLayout(validated, {
    seed: resolveSeed(validated, options.seed),
    constraints: options.constraints,
  });
  const reflowed = reconcileGeneratedLayout(previousState.artifact, validated, generated.layout);
  return stateFromDerived({
    artifact: reflowed,
    effectiveLayout: mergeEffectiveLayout(reflowed.layout, reflowed.composition.defaultView),
    constraintReport: clone(generated.constraintReport),
  });
}

/**
 * Derive and atomically save one Core state. When a persisted state is passed,
 * its revision is used as the optimistic-write guard unless an explicit
 * expectedRevision is supplied.
 */
export async function saveCore(filePath, stateOrArtifact, options = {}) {
  const source = isRecord(stateOrArtifact) && isRecord(stateOrArtifact.artifact)
    ? stateOrArtifact
    : { artifact: stateOrArtifact, revision: null };
  if (source.revision !== null && typeof source.revision !== "string") {
    throw new Error("Core state revision must be null or a string");
  }

  const derived = deriveArtifact(source.artifact, options);
  const expectedRevision = options.expectedRevision ?? source.revision ?? undefined;
  const saved = await saveDiagram(filePath, derived.artifact, {
    now: options.now,
    expectedRevision,
    beforeRename: options.beforeRename,
  });
  return stateFromDerived({
    artifact: saved.artifact,
    effectiveLayout: mergeEffectiveLayout(saved.artifact.layout, saved.artifact.composition.defaultView),
    constraintReport: derived.constraintReport,
  }, saved.revision);
}

export { assertCoreState };
