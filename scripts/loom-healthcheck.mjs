import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCoreState } from "../core/diagram-core.mjs";
import { createRenderDocument } from "../contracts/render-document.mjs";
import { createToolCall } from "../contracts/tool-envelope.mjs";
import { createDiagramToolService } from "../mcp/diagram-tools.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

async function run() {
  const artifact = await readJson("examples/flovvas-massing.diagram.json");
  const registry = await readJson("examples/flovvas-template-registry.json");
  const catalog = await readJson("examples/flovvas-template-catalog.json");
  const manifests = await Promise.all(registry.templates.map(({ path }) => readJson(path)));
  const resolvedIds = new Set(manifests.map((component) => component.id));
  const components = [
    ...manifests,
    ...catalog.templates.filter((component) => !resolvedIds.has(component.id)),
  ];
  const core = createCoreState(artifact, { seed: "healthcheck" });
  const renderDocument = createRenderDocument(artifact, {
    revision: "healthcheck-render-document",
    components,
    assets: artifact.assets,
  });
  const mcp = createDiagramToolService({ rootDir: resolve(repoRoot, "examples") });
  const validation = await mcp.execute(createToolCall({
    toolName: "diagram.validate",
    requestId: "healthcheck-validate",
    input: { path: "flovvas-massing.diagram.json" },
  }));
  if (validation.status !== "ok") {
    throw new Error(validation.error?.message ?? "MCP validation failed");
  }

  return {
    runtime: {
      node: process.version,
      platform: process.platform,
    },
    artifact: {
      id: artifact.id,
      schemaVersion: artifact.schemaVersion,
      nodes: artifact.semantic.nodes.length,
      edges: artifact.semantic.edges.length,
      groups: artifact.semantic.groups.length,
      annotations: artifact.annotations.length,
      assets: artifact.assets.length,
    },
    core: {
      effectiveLayoutNodes: Object.keys(core.effectiveLayout.nodes).length,
      effectiveLayoutRoutes: Object.keys(core.effectiveLayout.routes).length,
      engine: core.artifact.layout.engine,
    },
    renderer: {
      documentRevision: renderDocument.revision,
      layers: ["scene", "routes", "phaseZones", "annotations"],
      editorChrome: false,
    },
    mcp: {
      toolName: validation.toolName,
      status: validation.status,
      revision: validation.revision,
      effects: validation.effects,
    },
  };
}

try {
  console.log(JSON.stringify(await run(), null, 2));
} catch (error) {
  console.error(`Loom healthcheck failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
