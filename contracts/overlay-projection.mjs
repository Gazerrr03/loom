import { assertRouteControlPoints, resolveAnnotationAnchor } from "./anchors.mjs";
import { mergeEffectiveLayout } from "./layout.mjs";
import { assertRenderDocument } from "./render-document.mjs";

const ROLE_STYLES = {
  "main-flow": { lineStyle: "solid", tone: "primary", priority: 3 },
  alternative: { lineStyle: "dashed", tone: "muted", priority: 1 },
  "external-input": { lineStyle: "dotted", tone: "accent", priority: 1 },
  "compounding-loop": { lineStyle: "loop", tone: "accent", priority: 2 },
};

function clone(value) {
  return structuredClone(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function roleStyle(role) {
  return clone(ROLE_STYLES[role] ?? { lineStyle: "solid", tone: "muted", priority: 0 });
}

function artifactView(document) {
  return {
    semantic: document.semantic,
    composition: document.composition,
    annotations: document.annotations,
    layout: {
      engine: { id: "render-document", version: "0.1.0", seed: document.revision },
      generated: document.effectiveLayout,
      overrides: { nodes: {}, routes: {}, groups: {}, view: {} },
    },
  };
}

function projectRoutes(document) {
  const artifact = artifactView(document);
  assertRouteControlPoints(artifact, document.effectiveLayout);
  return document.semantic.edges.map((edge) => ({
    routeId: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type,
    label: edge.label ?? null,
    visualRole: edge.visualRole ?? "default",
    points: clone(document.effectiveLayout.routes[edge.id].points),
    style: roleStyle(edge.visualRole),
    coordinateSpace: "diagram",
    includeInExport: true,
  }));
}

function projectPhaseZones(document) {
  return document.semantic.groups
    .filter((group) => group.type === "phase-zone" || group.visualRole === "phase-zone")
    .map((group) => {
      const layout = document.effectiveLayout.groups[group.id];
      if (!isRecord(layout?.bounds)) throw new Error(`Missing effective bounds for phase zone: ${group.id}`);
      return {
        zoneId: group.id,
        label: group.label ?? null,
        children: [...group.children],
        bounds: clone(layout.bounds),
        visualRole: group.visualRole ?? "phase-zone",
        style: { fillTone: "phase", borderStyle: "light", priority: 0 },
        coordinateSpace: "diagram",
        includeInExport: true,
      };
    });
}

function projectAnnotations(document) {
  const artifact = artifactView(document);
  return document.annotations.map((annotation) => ({
    annotationId: annotation.id,
    text: annotation.text,
    visualRole: annotation.visualRole,
    semanticAnchor: clone(annotation.anchor),
    position: resolveAnnotationAnchor(annotation, artifact, document.effectiveLayout),
    properties: clone(annotation.properties ?? {}),
    coordinateSpace: "diagram",
    includeInExport: true,
    includeEditorHandles: false,
  }));
}

/**
 * Project all non-mesh explanatory layers into the same Diagram coordinate
 * space as SceneNode. A Renderer applies the current RenderDocument view to
 * every returned layer, so pan/zoom/orbit cannot desynchronise overlays.
 */
export function projectOverlays(document) {
  assertRenderDocument(document);
  const result = {
    coordinateSpace: "diagram",
    view: clone(document.effectiveLayout.view),
    routes: projectRoutes(document),
    phaseZones: projectPhaseZones(document),
    annotations: projectAnnotations(document),
    includeEditorChrome: false,
  };
  return Object.freeze(result);
}

export function assertOverlayProjection(overlays) {
  if (!isRecord(overlays)) throw new TypeError("overlay projection must be an object");
  if (overlays.coordinateSpace !== "diagram") throw new Error("overlay projection must use Diagram coordinates");
  if (!isRecord(overlays.view)) throw new Error("overlay projection view must be an object");
  for (const collection of ["routes", "phaseZones", "annotations"]) {
    if (!Array.isArray(overlays[collection])) throw new Error(`overlay projection ${collection} must be an array`);
  }
  if (overlays.includeEditorChrome !== false) throw new Error("overlay projection must exclude editor chrome");
  return overlays;
}

