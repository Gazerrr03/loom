/**
 * Cross-object rules for the renderer-independent semantic graph.
 *
 * JSON Schema can describe each object, but it cannot express that an edge
 * endpoint or group child must resolve to another object in the same file.
 * This small assertion is the shared boundary for Codex, layout, and render
 * code until a full schema validator is wired into the runtime.
 */

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const COLLECTIONS = ["nodes", "edges", "groups"];

function assertStableId(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error(`${path} must be a lowercase stable identifier`);
  }
}

function assertCollection(semantic, collection, ids) {
  const items = semantic[collection];
  if (!Array.isArray(items)) {
    throw new Error(`semantic.${collection} must be an array`);
  }

  for (const [index, item] of items.entries()) {
    const path = `semantic.${collection}[${index}]`;
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${path} must be an object`);
    }
    assertStableId(item.id, `${path}.id`);
    if (ids.has(item.id)) {
      throw new Error(`Duplicate semantic ID: ${item.id}`);
    }
    ids.set(item.id, collection);
    if (typeof item.type !== "string" || item.type.length === 0) {
      throw new Error(`${path}.type must be a non-empty string`);
    }
  }
}

export function assertSemanticGraph(semantic) {
  if (semantic === null || typeof semantic !== "object" || Array.isArray(semantic)) {
    throw new TypeError("semantic graph must be an object");
  }

  if (typeof semantic.diagramFamily !== "string" || semantic.diagramFamily.length === 0) {
    throw new Error("semantic.diagramFamily must be a non-empty string");
  }

  const ids = new Map();
  for (const collection of COLLECTIONS) {
    assertCollection(semantic, collection, ids);
  }

  const nodeIds = new Set(semantic.nodes.map((node) => node.id));
  for (const [index, edge] of semantic.edges.entries()) {
    for (const endpoint of ["source", "target"]) {
      assertStableId(edge[endpoint], `semantic.edges[${index}].${endpoint}`);
      if (!nodeIds.has(edge[endpoint])) {
        throw new Error(
          `Dangling edge endpoint: semantic.edges[${index}].${endpoint} -> ${edge[endpoint]}`,
        );
      }
    }
  }

  for (const [index, group] of semantic.groups.entries()) {
    if (!Array.isArray(group.children)) {
      throw new Error(`semantic.groups[${index}].children must be an array`);
    }
    for (const [childIndex, childId] of group.children.entries()) {
      assertStableId(childId, `semantic.groups[${index}].children[${childIndex}]`);
      if (!nodeIds.has(childId)) {
        throw new Error(
          `Dangling group child: semantic.groups[${index}].children[${childIndex}] -> ${childId}`,
        );
      }
    }
  }

  return semantic;
}
