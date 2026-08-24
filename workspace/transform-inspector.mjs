import {
  applyDomainCommand,
  beginPreview,
  commitPreview,
  updatePreview,
} from "../contracts/interaction-commit.mjs";

const OPERATIONS = Object.freeze({
  rotateY: { commandType: "layout.node.rotate-y", key: "rotationYDeg" },
  scale: { commandType: "layout.node.scale", key: "scale" },
  elevation: { commandType: "layout.node.elevation", key: "elevation" },
  zIndex: { commandType: "layout.node.z-index", key: "zIndex" },
});

function clone(value) {
  return structuredClone(value);
}

function operationDefinition(operation) {
  const definition = OPERATIONS[operation];
  if (!definition) throw new Error(`Unsupported Inspector transform operation: ${String(operation)}`);
  return definition;
}

/** Convert a number input into one contract-safe value before a command exists. */
export function parseInspectorTransformValue(operation, rawValue) {
  const definition = operationDefinition(operation);
  if (rawValue === "" || rawValue === null || rawValue === undefined) {
    throw new Error(`${definition.key} must be a number`);
  }
  const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (!Number.isFinite(value)) throw new Error(`${definition.key} must be a finite number`);
  if (operation === "scale" && value <= 0) throw new Error("scale must be greater than zero");
  if (operation === "zIndex" && !Number.isInteger(value)) throw new Error("zIndex must be an integer");
  return value;
}

function commandValue(operation, value) {
  const { key } = operationDefinition(operation);
  return { [key]: parseInspectorTransformValue(operation, value) };
}

/** Build one preview session for a selected node without changing the Artifact. */
export function beginInspectorTransform({ baseRevision, gestureId, nodeId, operation }) {
  const definition = operationDefinition(operation);
  return beginPreview({
    baseRevision,
    gestureId,
    nodeId,
    targetId: nodeId,
    commandType: definition.commandType,
  });
}

/** Apply one Inspector frame to an ephemeral Artifact copy. */
export function previewInspectorTransform(artifact, { baseRevision, gestureId, nodeId, operation, value }) {
  const preview = beginInspectorTransform({ baseRevision, gestureId, nodeId, operation });
  const frame = updatePreview(preview, commandValue(operation, value));
  const command = commitPreview(frame).command;
  return { command: clone(command), artifact: applyDomainCommand(artifact, command) };
}

/** Commit one Inspector edit as exactly one Domain Command and Artifact update. */
export function commitInspectorTransform(artifact, options) {
  return previewInspectorTransform(artifact, options);
}

export { OPERATIONS };
