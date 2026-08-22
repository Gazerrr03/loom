/**
 * Identity-only Component Template catalog.
 *
 * M2-01 intentionally stops before parameters and renderer mappings. The
 * catalog gives Codex and Workspace one stable searchable identity; later
 * issues can attach the complete manifest without changing query semantics.
 */

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;

function normalize(value) {
  return String(value).trim().toLocaleLowerCase();
}

function assertIdentity(template, path) {
  if (template === null || typeof template !== "object" || Array.isArray(template)) {
    throw new Error(`${path} must be an object`);
  }
  if (typeof template.id !== "string" || !ID_PATTERN.test(template.id)) {
    throw new Error(`${path}.id must be a stable identifier`);
  }
  for (const field of ["name", "semanticDescription"]) {
    if (typeof template[field] !== "string" || template[field].length === 0) {
      throw new Error(`${path}.${field} must be a non-empty string`);
    }
  }
  if (!Array.isArray(template.acceptedNodeTypes) || template.acceptedNodeTypes.length === 0) {
    throw new Error(`${path}.acceptedNodeTypes must contain at least one type`);
  }
  if (template.acceptedNodeTypes.some((type) => typeof type !== "string" || type.length === 0)) {
    throw new Error(`${path}.acceptedNodeTypes must contain non-empty strings`);
  }
  if (!Array.isArray(template.searchTerms) || template.searchTerms.length === 0) {
    throw new Error(`${path}.searchTerms must contain at least one term`);
  }
  if (template.searchTerms.some((term) => typeof term !== "string" || term.length === 0)) {
    throw new Error(`${path}.searchTerms must contain non-empty strings`);
  }
}

export function assertComponentTemplateCatalog(catalog) {
  if (catalog === null || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new TypeError("component template catalog must be an object");
  }
  if (catalog.format !== "loom.component-catalog") throw new Error("Unsupported component catalog format");
  if (catalog.schemaVersion !== "0.1.0") throw new Error("Unsupported component catalog schemaVersion");
  if (!Array.isArray(catalog.templates) || catalog.templates.length === 0) {
    throw new Error("component catalog templates must be a non-empty array");
  }
  const ids = new Set();
  for (const [index, template] of catalog.templates.entries()) {
    const path = `templates[${index}]`;
    assertIdentity(template, path);
    if (ids.has(template.id)) throw new Error(`Duplicate component template ID: ${template.id}`);
    ids.add(template.id);
  }
  if (!Array.isArray(catalog.goldenTemplateIds)) throw new Error("goldenTemplateIds must be an array");
  const goldenIds = new Set();
  for (const [index, id] of catalog.goldenTemplateIds.entries()) {
    if (typeof id !== "string" || !ids.has(id)) {
      throw new Error(`goldenTemplateIds[${index}] does not resolve: ${String(id)}`);
    }
    if (goldenIds.has(id)) throw new Error(`Duplicate golden template ID: ${id}`);
    goldenIds.add(id);
  }
  return catalog;
}

function semanticMatch(template, query) {
  const normalized = normalize(query);
  if (!normalized) return null;
  const searchable = normalize([
    template.name,
    template.semanticDescription,
    ...template.searchTerms,
  ].join(" "));
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.every((token) => searchable.includes(token))) return null;
  return {
    kind: "semantic-term",
    value: query,
    label: `语义词命中“${query}”`,
  };
}

/** Return identity-only matches with explicit reasons and stable ordering. */
export function queryComponentTemplates(catalog, { nodeType, semanticQuery } = {}) {
  assertComponentTemplateCatalog(catalog);
  const matches = [];
  for (const template of catalog.templates) {
    const reasons = [];
    if (nodeType && template.acceptedNodeTypes.includes(nodeType)) {
      reasons.push({ kind: "node-type", value: nodeType, label: `节点类型“${nodeType}”适配` });
    }
    const semanticReason = semanticMatch(template, semanticQuery);
    if (semanticReason) reasons.push(semanticReason);
    if (reasons.length === 0) continue;
    const score = reasons.reduce((total, reason) => total + (reason.kind === "node-type" ? 2 : 1), 0);
    matches.push({
      templateId: template.id,
      template,
      reasons,
      score,
    });
  }
  return matches.sort((left, right) => right.score - left.score || left.templateId.localeCompare(right.templateId));
}

export function assertComponentRefsResolve(artifact, catalog) {
  assertComponentTemplateCatalog(catalog);
  const ids = new Set(catalog.templates.map((template) => template.id));
  for (const [index, node] of artifact.semantic.nodes.entries()) {
    if (!ids.has(node.componentRef)) {
      throw new Error(`semantic.nodes[${index}].componentRef does not resolve: ${node.componentRef}`);
    }
  }
  return artifact;
}
