import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, basename } from "node:path";

import { assertComposition } from "../contracts/composition.mjs";
import { assertDiagramEnvelope } from "../contracts/diagram-envelope.mjs";
import { assertExportSettings } from "../contracts/export-settings.mjs";
import { assertLayout } from "../contracts/layout.mjs";
import { assertPresentationBoundary } from "../contracts/presentation.mjs";
import { assertSemanticGraph } from "../contracts/semantic-graph.mjs";

function clone(value) {
  return structuredClone(value);
}

function serializeDiagram(artifact) {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

function revisionFor(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function assertDiagramArtifact(artifact) {
  assertDiagramEnvelope(artifact);
  assertSemanticGraph(artifact.semantic);
  assertComposition(artifact.composition);
  assertExportSettings(artifact.exportSettings);
  assertLayout(artifact.layout);
  assertPresentationBoundary({
    semantic: artifact.semantic,
    annotations: artifact.annotations,
    presentation: artifact.presentation,
    assets: artifact.assets,
  });
  return artifact;
}

/** Create an independent, validated in-memory Diagram artifact. */
export function createDiagram(artifact) {
  const next = clone(artifact);
  assertDiagramArtifact(next);
  return next;
}

/** Load, parse, validate, and fingerprint a Diagram artifact from disk. */
export async function loadDiagram(filePath) {
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new Error("Diagram file could not be read");
  }

  let artifact;
  try {
    artifact = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Diagram JSON could not be parsed");
  }
  try {
    assertDiagramArtifact(artifact);
  } catch (error) {
    throw new Error("Diagram artifact failed contract validation", { cause: error });
  }

  return {
    artifact,
    revision: revisionFor(bytes),
    updatedAt: artifact.metadata.updatedAt,
  };
}

async function atomicWrite(filePath, bytes, beforeRename) {
  const directory = dirname(filePath);
  const temporaryPath = join(directory, `.${basename(filePath)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (beforeRename) await beforeRename({ temporaryPath });
    await rename(temporaryPath, filePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Validate and atomically save a Diagram. The optional beforeRename hook is
 * intentionally tiny and exists so tests can model an interrupted write.
 */
export async function saveDiagram(filePath, artifact, { now = new Date(), expectedRevision, beforeRename } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("save time must be a valid Date");
  }
  const next = clone(artifact);
  if (!next.metadata || typeof next.metadata !== "object") {
    throw new Error("Diagram metadata is required before save");
  }
  next.metadata.updatedAt = now.toISOString();
  assertDiagramArtifact(next);

  if (expectedRevision !== undefined) {
    try {
      const current = await readFile(filePath);
      if (revisionFor(current) !== expectedRevision) {
        throw new Error("Diagram revision changed before save");
      }
    } catch (error) {
      if (error.message === "Diagram revision changed before save") throw error;
      throw new Error("Diagram revision could not be checked");
    }
  }

  const bytes = Buffer.from(serializeDiagram(next), "utf8");
  await atomicWrite(filePath, bytes, beforeRename);
  const fileStats = await stat(filePath);
  return {
    artifact: next,
    filePath,
    revision: revisionFor(bytes),
    updatedAt: next.metadata.updatedAt,
    sizeBytes: fileStats.size,
  };
}
