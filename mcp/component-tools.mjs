import {
  assertComponentTemplateCatalog,
  queryComponentTemplates,
} from "../contracts/component-template-catalog.mjs";
import {
  assertToolCall,
  createToolError,
  createToolResult,
} from "../contracts/tool-envelope.mjs";

const COMPONENT_TOOLS = new Set(["component.query", "component.get"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertString(value, path) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
}

function safeDefinition(template, resolver) {
  const manifest = resolver?.getManifest(template.id) ?? null;
  return {
    id: template.id,
    name: template.name,
    kind: manifest?.kind ?? "fallback",
    semanticDescription: template.semanticDescription,
    acceptedNodeTypes: [...template.acceptedNodeTypes],
    searchTerms: [...template.searchTerms],
    parametersSchema: clone(manifest?.parametersSchema ?? { type: "object", properties: {} }),
    defaults: clone(manifest?.defaults ?? {}),
    capabilities: clone(manifest?.capabilities ?? null),
    dependencies: clone(manifest?.dependencies ?? { primitiveRefs: [], assetRefs: [] }),
    fallback: clone(manifest?.fallback ?? { componentRef: template.id, parameterMap: {} }),
  };
}

function resolveMapping(template, { nodeType, semanticQuery, resolver }) {
  if (!resolver) return { status: "unresolved", componentRef: template.id, implementationRef: null, reasons: ["Resolver is not connected."] };
  const resolution = resolver.resolveNode({
    id: "component-query",
    type: nodeType ?? template.acceptedNodeTypes[0],
    label: template.name,
    componentRef: template.id,
  }, { semanticQuery });
  const mapping = resolution.renderer;
  return {
    status: resolution.status,
    componentRef: mapping?.componentRef ?? template.id,
    implementationRef: mapping?.implementationRef ?? null,
    adapterId: mapping?.adapterId ?? null,
    reasons: [...(mapping?.reasons ?? resolution.warnings ?? [])],
    error: mapping?.error ?? resolution.error ?? null,
  };
}

function catalogMatches(catalog, { nodeType, semanticQuery }) {
  if (nodeType !== undefined && typeof nodeType !== "string") throw new Error("input.nodeType must be a string");
  if (semanticQuery !== undefined && typeof semanticQuery !== "string") throw new Error("input.semanticQuery must be a string");
  if (!nodeType && !semanticQuery) {
    return catalog.templates.map((template) => ({
      templateId: template.id,
      template,
      score: 0,
      reasons: [{ kind: "catalog-default", value: "all", label: "默认展示可用模板" }],
    }));
  }
  return queryComponentTemplates(catalog, { nodeType, semanticQuery });
}

/** Codex/Workspace component query service over one shared catalog + Resolver. */
export function createComponentToolService({ catalog, resolver = null } = {}) {
  assertComponentTemplateCatalog(catalog);

  async function execute(call) {
    assertToolCall(call);
    if (!COMPONENT_TOOLS.has(call.toolName)) {
      return createToolError({
        toolName: call.toolName,
        requestId: call.requestId,
        code: "invalid-tool-input",
        message: `Unsupported component tool: ${call.toolName}`,
        fieldPath: "toolName",
        suggestedAction: "Use component.query or component.get.",
      });
    }
    try {
      if (call.toolName === "component.get") return get(call);
      return query(call);
    } catch (error) {
      return createToolError({
        toolName: call.toolName,
        requestId: call.requestId,
        code: error.code ?? (error.message?.includes("does not resolve") ? "unsupported-template" : "invalid-tool-input"),
        message: error.message ?? String(error),
        objectIds: call.input.templateId && /^[a-z][a-z0-9._-]*$/.test(call.input.templateId) ? [call.input.templateId] : [],
        fieldPath: call.toolName === "component.get" ? "input.templateId" : "input",
        suggestedAction: "Choose a catalog template or adjust the semantic query.",
      });
    }
  }

  function get(call) {
    assertString(call.input.templateId, "input.templateId");
    const template = catalog.templates.find((candidate) => candidate.id === call.input.templateId);
    if (!template) throw new Error(`Component template does not resolve: ${call.input.templateId}`);
    return createToolResult({
      toolName: call.toolName,
      requestId: call.requestId,
      result: {
        template: safeDefinition(template, resolver),
        mapping: resolveMapping(template, { nodeType: template.acceptedNodeTypes[0], resolver }),
      },
      revision: null,
      effects: { kind: "read", paths: [], changed: false, reversible: true },
    });
  }

  function query(call) {
    const matches = catalogMatches(catalog, call.input);
    const values = matches.map((match) => ({
      ...safeDefinition(match.template, resolver),
      score: match.score,
      reasons: clone(match.reasons),
      mapping: resolveMapping(match.template, {
        nodeType: call.input.nodeType,
        semanticQuery: call.input.semanticQuery,
        resolver,
      }),
    }));
    return createToolResult({
      toolName: call.toolName,
      requestId: call.requestId,
      result: {
        query: {
          nodeType: call.input.nodeType ?? null,
          semanticQuery: call.input.semanticQuery ?? null,
        },
        matches: values,
        message: values.length === 0 ? "没有模板同时满足当前节点类型与语义查询。" : null,
      },
      revision: null,
      effects: { kind: "read", paths: [], changed: false, reversible: true },
    });
  }

  return { execute };
}

