/**
 * Shared error envelope for Core, Tools, and Renderer boundaries.
 *
 * Errors are diagnostic values, not persisted Diagram content. The contract
 * deliberately rejects absolute local paths so a useful failure cannot turn
 * into an accidental disclosure of the author's machine layout.
 */

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const FIELD_PATH_PATTERN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/;
const LOCAL_PATH_PATTERN = /(?:^|[\s('"=])(?:\/(?:Users|home|private|tmp|var|etc)\/|[A-Za-z]:[\\/]|\\\\)/i;
const ERROR_CODES = new Set([
  "invalid-envelope",
  "unsupported-version",
  "duplicate-id",
  "dangling-reference",
  "missing-asset",
  "unsupported-capability",
  "unsupported-template",
  "invalid-layout",
  "render-failed",
  "export-failed",
]);
const ERROR_FIELDS = new Set([
  "code",
  "message",
  "objectIds",
  "fieldPath",
  "recoverable",
  "suggestedAction",
  "suggestedFallback",
  "cause",
]);

function assertSafeText(value, path, { allowNull = false } = {}) {
  if (allowNull && value === null) return;
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string or null`);
  if (LOCAL_PATH_PATTERN.test(value)) throw new Error(`${path} must not contain a local path`);
}

function assertObjectIds(objectIds) {
  if (!Array.isArray(objectIds)) throw new Error("error.objectIds must be an array");
  const seen = new Set();
  for (const [index, objectId] of objectIds.entries()) {
    if (typeof objectId !== "string" || !ID_PATTERN.test(objectId)) {
      throw new Error(`error.objectIds[${index}] must be a stable identifier`);
    }
    if (seen.has(objectId)) throw new Error(`error.objectIds contains duplicate ID: ${objectId}`);
    seen.add(objectId);
  }
}

export function assertDiagramError(error) {
  if (error === null || typeof error !== "object" || Array.isArray(error)) {
    throw new TypeError("error must be an object");
  }
  for (const key of Object.keys(error)) {
    if (!ERROR_FIELDS.has(key)) throw new Error(`Unsupported error field: ${key}`);
  }
  if (!ERROR_CODES.has(error.code)) throw new Error(`Unsupported error code: ${String(error.code)}`);
  assertSafeText(error.message, "error.message");
  assertObjectIds(error.objectIds);
  if (error.fieldPath !== null && (typeof error.fieldPath !== "string" || !FIELD_PATH_PATTERN.test(error.fieldPath))) {
    throw new Error("error.fieldPath must be a safe field path or null");
  }
  if (typeof error.recoverable !== "boolean") throw new Error("error.recoverable must be boolean");
  assertSafeText(error.suggestedAction, "error.suggestedAction", { allowNull: true });
  if (error.suggestedFallback !== undefined) {
    assertSafeText(error.suggestedFallback, "error.suggestedFallback");
  }
  if (error.cause !== undefined) assertSafeText(error.cause, "error.cause", { allowNull: true });
  return error;
}

export function createDiagramError({
  code,
  message,
  objectIds = [],
  fieldPath = null,
  recoverable,
  suggestedAction = null,
  suggestedFallback,
  cause = null,
}) {
  const error = {
    code,
    message,
    objectIds,
    fieldPath,
    recoverable,
    suggestedAction,
    cause,
  };
  if (suggestedFallback !== undefined) error.suggestedFallback = suggestedFallback;
  return assertDiagramError(error);
}

export { ERROR_CODES };
