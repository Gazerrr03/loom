import { applyCoreCommand } from "../core/diagram-core.mjs";
import {
  beginPreview,
  commitPreview,
  updatePreview,
} from "../contracts/interaction-commit.mjs";

const OPERATIONS = {
  move: { commandType: "layout.node.move", valueKey: ["x", "y"] },
  rotateY: { commandType: "layout.node.rotate-y", valueKey: ["rotationYDeg"] },
  scale: { commandType: "layout.node.scale", valueKey: ["scale"] },
  elevation: { commandType: "layout.node.elevation", valueKey: ["elevation"] },
  zIndex: { commandType: "layout.node.z-index", valueKey: ["zIndex"] },
};

function clone(value) {
  return structuredClone(value);
}

function operationDefinition(operation) {
  const definition = OPERATIONS[operation];
  if (!definition) throw new Error(`Unsupported node transform operation: ${String(operation)}`);
  return definition;
}

function normalizeValue(operation, value) {
  const definition = operationDefinition(operation);
  if (operation === "move") {
    if (typeof value === "number" || !value || typeof value !== "object") {
      throw new Error("move transform requires { x, y }");
    }
    return { x: value.x, y: value.y };
  }
  if (typeof value === "number") return { [definition.valueKey[0]]: value };
  if (!value || typeof value !== "object") {
    throw new Error(`${operation} transform requires a number or keyed value`);
  }
  return Object.fromEntries(definition.valueKey.map((key) => [key, value[key]]));
}

/** Begin one direct node transform without writing the Artifact. */
export function beginNodeTransform({ baseRevision, gestureId, nodeId, operation }) {
  const definition = operationDefinition(operation);
  return beginPreview({
    baseRevision,
    gestureId,
    targetId: nodeId,
    commandType: definition.commandType,
  });
}

/** Return a new preview frame from a pointer/Inspector update. */
export function updateNodeTransform(preview, operation, value) {
  const expected = operationDefinition(operation).commandType;
  if (preview.commandType !== expected) throw new Error("transform operation does not match preview session");
  return updatePreview(preview, normalizeValue(operation, value));
}

/** Convert the final pointer-up frame into exactly one Domain Command. */
export function commitNodeTransform(preview) {
  return commitPreview(preview);
}

/** Apply the committed transform through Core's field-level Human Override boundary. */
export function applyNodeTransform(coreState, command, options = {}) {
  return applyCoreCommand(coreState, clone(command), options);
}

/** Convenience for non-pointer Inspector edits: one value, one command. */
export function createNodeTransformCommand({ baseRevision, gestureId, nodeId, operation, value }) {
  const preview = beginNodeTransform({ baseRevision, gestureId, nodeId, operation });
  const frame = updateNodeTransform(preview, operation, value);
  return commitNodeTransform(frame);
}

export function assertNodeTransformOperation(operation) {
  operationDefinition(operation);
  return operation;
}

export { OPERATIONS };

