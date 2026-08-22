/**
 * The small, renderer-independent contract shared by every Diagram reader.
 *
 * Keeping this check separate from a JSON Schema implementation gives CLI,
 * tests, and future runtimes one explicit rule for handling version drift:
 * unsupported envelopes fail before any semantic or layout work starts.
 */

export const DIAGRAM_FORMAT = "loom.diagram";
export const DIAGRAM_SCHEMA_VERSION = "0.1.0";

const REQUIRED_FIELDS = ["format", "schemaVersion", "id", "metadata"];
const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;

export function assertDiagramEnvelope(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Diagram envelope must be an object");
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in value)) {
      throw new Error(`Diagram envelope is missing required field: ${field}`);
    }
  }

  if (value.format !== DIAGRAM_FORMAT) {
    throw new Error(`Unsupported Diagram format: ${String(value.format)}`);
  }

  if (value.schemaVersion !== DIAGRAM_SCHEMA_VERSION) {
    throw new Error(`Unsupported Diagram schemaVersion: ${String(value.schemaVersion)}`);
  }

  if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) {
    throw new Error("Diagram envelope id must be a lowercase stable identifier");
  }

  if (
    value.metadata === null ||
    typeof value.metadata !== "object" ||
    Array.isArray(value.metadata)
  ) {
    throw new Error("Diagram envelope metadata must be an object");
  }

  for (const field of ["title", "createdAt", "updatedAt"]) {
    if (!(field in value.metadata)) {
      throw new Error(`Diagram metadata is missing required field: ${field}`);
    }
  }

  return value;
}
