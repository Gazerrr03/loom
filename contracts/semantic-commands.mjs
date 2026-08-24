import { assertDiagramArtifact } from "../core/artifact-store.mjs";

const COMMAND_TYPES = new Set([
  "semantic.node.create",
  "semantic.node.update",
  "semantic.node.delete",
  "semantic.edge.connect",
  "semantic.edge.update",
  "semantic.edge.disconnect",
  "semantic.group.create",
  "semantic.group.update",
  "semantic.group.delete",
  "semantic.annotation.create",
  "semantic.annotation.update",
  "semantic.annotation.delete",
]);
const COMMAND_KEYS = new Set(["type", "targetId", "node", "edge", "group", "annotation", "patch", "transactionId", "baseRevision"]);
const PATCH_FIELDS = {
  node: new Set(["type", "label", "description", "componentRef", "visualRole", "status", "phase", "properties"]),
  edge: new Set(["source", "target", "type", "label", "visualRole", "properties"]),
  group: new Set(["type", "label", "children", "visualRole", "properties"]),
  annotation: new Set(["text", "visualRole", "anchor", "properties"]),
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertId(value, path) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]*$/.test(value)) throw new Error(`${path} must be a stable identifier`);
}

function assertCommandShape(command) {
  if (!isRecord(command)) throw new TypeError("semantic command must be an object");
  for (const key of Object.keys(command)) {
    if (!COMMAND_KEYS.has(key)) throw new Error(`semantic command contains unsupported field: ${key}`);
  }
  if (!COMMAND_TYPES.has(command.type)) throw new Error(`Unsupported semantic command type: ${String(command.type)}`);
  if (command.targetId !== undefined) assertId(command.targetId, "command.targetId");
  if (command.transactionId !== undefined) assertId(command.transactionId, "command.transactionId");
  if (command.baseRevision !== undefined && (typeof command.baseRevision !== "string" || command.baseRevision.length === 0)) {
    throw new Error("command.baseRevision must be a non-empty string");
  }
}

function findItem(artifact, collection, id) {
  return artifact.semantic[collection]?.find((item) => item.id === id)
    ?? (collection === "annotations" ? artifact.annotations.find((item) => item.id === id) : undefined)
    ?? null;
}

function allIds(artifact) {
  return new Set([
    ...artifact.semantic.nodes.map((item) => item.id),
    ...artifact.semantic.edges.map((item) => item.id),
    ...artifact.semantic.groups.map((item) => item.id),
    ...artifact.annotations.map((item) => item.id),
  ]);
}

function assertNewId(artifact, item, path) {
  if (!isRecord(item)) throw new Error(`${path} must be an object`);
  assertId(item.id, `${path}.id`);
  if (allIds(artifact).has(item.id)) throw new Error(`Duplicate semantic ID: ${item.id}`);
}

function assertPatch(patch, kind) {
  if (!isRecord(patch) || Object.keys(patch).length === 0) throw new Error(`${kind} patch must contain at least one field`);
  if (Object.hasOwn(patch, "id")) throw new Error(`${kind} patch cannot change id`);
  for (const field of Object.keys(patch)) {
    if (!PATCH_FIELDS[kind].has(field)) throw new Error(`${kind} patch field is unsupported: ${field}`);
  }
}

function requireTarget(artifact, kind, targetId) {
  assertId(targetId, `command.targetId`);
  const collection = kind === "annotation" ? "annotations" : `${kind}s`;
  const item = findItem(artifact, collection, targetId);
  if (!item) throw new Error(`${kind} command target does not resolve: ${targetId}`);
  return { collection, item };
}

function assertNoReferences(artifact, kind, targetId) {
  if (kind === "node") {
    const edge = artifact.semantic.edges.find((candidate) => candidate.source === targetId || candidate.target === targetId);
    if (edge) throw new Error(`Cannot delete node ${targetId}; edge ${edge.id} still references it`);
    const group = artifact.semantic.groups.find((candidate) => candidate.children.includes(targetId));
    if (group) throw new Error(`Cannot delete node ${targetId}; group ${group.id} still references it`);
  }
  const annotation = artifact.annotations.find((candidate) => candidate.anchor?.targetId === targetId && candidate.anchor.kind === kind);
  if (annotation) throw new Error(`Cannot delete ${kind} ${targetId}; annotation ${annotation.id} still references it`);
}

function removeLayoutEntry(artifact, collection, id) {
  const layoutCollection = collection === "annotations" ? null : collection === "edges" ? "routes" : collection;
  if (!layoutCollection) return;
  delete artifact.layout.generated[layoutCollection][id];
  delete artifact.layout.overrides[layoutCollection][id];
}

function applyCreate(next, kind, item) {
  assertNewId(next, item, `command.${kind}`);
  if (kind === "annotation") next.annotations.push(clone(item));
  else next.semantic[`${kind}s`].push(clone(item));
}

function applyUpdate(next, kind, targetId, patch) {
  const { item } = requireTarget(next, kind, targetId);
  assertPatch(patch, kind);
  Object.assign(item, clone(patch));
}

function applyDelete(next, kind, targetId) {
  const { collection } = requireTarget(next, kind, targetId);
  assertNoReferences(next, kind, targetId);
  const items = collection === "annotations" ? next.annotations : next.semantic[collection];
  const index = items.findIndex((item) => item.id === targetId);
  items.splice(index, 1);
  removeLayoutEntry(next, collection, targetId);
}

/** Apply one semantic command atomically to a Diagram Artifact. */
export function applySemanticCommand(artifact, command) {
  assertDiagramArtifact(artifact);
  assertCommandShape(command);
  const next = clone(artifact);
  const [, kind, operation] = command.type.split(".");
  if (operation === "create" || operation === "connect") {
    const item = command[kind];
    if (operation === "connect" && kind !== "edge") throw new Error("only edge commands support connect");
    applyCreate(next, kind, item);
  } else if (operation === "update") {
    applyUpdate(next, kind, command.targetId, command.patch);
  } else if (operation === "delete" || operation === "disconnect") {
    if (operation === "disconnect" && kind !== "edge") throw new Error("only edge commands support disconnect");
    applyDelete(next, kind, command.targetId);
  } else {
    throw new Error(`Unsupported semantic operation: ${operation}`);
  }
  assertDiagramArtifact(next);
  return next;
}

/** Apply a batch atomically; if one command fails, the input Artifact is untouched. */
export function applySemanticBatch(artifact, commands) {
  assertDiagramArtifact(artifact);
  if (!Array.isArray(commands)) throw new TypeError("semantic commands must be an array");
  let next = clone(artifact);
  const affectedIds = [];
  for (const command of commands) {
    next = applySemanticCommand(next, command);
    const id = command.targetId ?? command.node?.id ?? command.edge?.id ?? command.group?.id ?? command.annotation?.id;
    if (id && !affectedIds.includes(id)) affectedIds.push(id);
  }
  return {
    artifact: next,
    affectedIds,
    commandsApplied: commands.length,
    changed: commands.length > 0,
  };
}

export function createSemanticCommand({ type, ...payload }) {
  const command = { type, ...payload };
  assertCommandShape(command);
  return clone(command);
}

export function assertSemanticCommand(command) {
  assertCommandShape(command);
  return command;
}

export { COMMAND_TYPES };
