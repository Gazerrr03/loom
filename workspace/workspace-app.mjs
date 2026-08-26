import { createIsometricTransform, createWorkspaceCanvas } from "./workspace-canvas.mjs";
import {
  evaluateComponentExportGate,
  importUserGlbReference,
  listComponentEntries,
  replaceNodeComponent,
} from "./component-panel.mjs";
import {
  captureWorkspacePng,
  createWorkspacePngPlan,
  saveWorkspaceWithAdapter,
} from "./workspace-storage.mjs";
import {
  assertExportSettings,
  resolveExportCamera,
  withExportCamera,
} from "../contracts/export-settings.mjs";
import {
  commitInspectorTransform,
  previewInspectorTransform,
} from "./transform-inspector.mjs";
import {
  createWorkspaceView,
  viewBasis,
} from "./workspace-view.mjs";
import { createRouteEditor } from "./route-editor.mjs";
import { createAnnotationEditor } from "./annotation-editor.mjs";
import { resolveAnnotationAnchor } from "../contracts/anchors.mjs";
import {
  canRedoHistory,
  canUndoHistory,
  commitHistoryTransaction,
  createHistoryStack,
  redoHistoryStack,
  replaceHistoryPresent,
  undoHistoryStack,
} from "./history-stack.mjs";

const NS = "http://www.w3.org/2000/svg";
const GOLDEN_CASE_URL = "../examples/flovvas-massing.diagram.json";
const COMPONENT_CATALOG_URL = "../examples/flovvas-template-catalog.json";
const STAGE_COLORS = ["#6687a4", "#7a9b91", "#ad8c69", "#8b7baa", "#b27668", "#738e87", "#c17a4e"];
const els = {
  app: document.getElementById("loom-workspace"),
  title: document.getElementById("file-title"),
  status: document.getElementById("workspace-status"),
  canvasMeta: document.getElementById("canvas-meta"),
  canvas: document.getElementById("workspace-canvas"),
  scene: document.getElementById("workspace-scene"),
  componentList: document.getElementById("component-list"),
  componentCount: document.getElementById("component-count"),
  componentSearch: document.getElementById("component-search"),
  libraryNotice: document.getElementById("library-notice"),
  inspector: document.getElementById("inspector-body"),
  fileInput: document.getElementById("file-input"),
  openButton: document.getElementById("open-button"),
  loadGoldenButton: document.getElementById("load-golden-button"),
  saveButton: document.getElementById("save-button"),
  undoButton: document.getElementById("undo-button"),
  redoButton: document.getElementById("redo-button"),
  exportButton: document.getElementById("export-button"),
  viewZoomOutButton: document.getElementById("view-zoom-out"),
  viewZoomInButton: document.getElementById("view-zoom-in"),
  viewOrbitLeftButton: document.getElementById("view-orbit-left"),
  viewOrbitRightButton: document.getElementById("view-orbit-right"),
  viewResetButton: document.getElementById("view-reset"),
  dragHint: document.querySelector(".canvas-foot > span"),
  glbImportButton: null,
  glbFileInput: null,
};

const state = {
  status: "idle",
  artifact: null,
  fileName: null,
  revision: null,
  selectedId: null,
  selectedEdgeId: null,
  selectedAnnotationId: null,
  query: "",
  dirty: false,
  error: null,
  previewArtifact: null,
  canvasController: null,
  activePointerId: null,
  dragging: false,
  moved: false,
  suppressClick: false,
  catalog: null,
  componentError: null,
  saving: false,
  exporting: false,
  lastExport: null,
  transformSequence: 0,
  componentSequence: 0,
  exportCameraSequence: 0,
  viewController: createWorkspaceView(),
  viewPointer: null,
  routeEditor: null,
  activeRoutePointerId: null,
  annotationEditor: null,
  suppressAnnotationCommit: false,
  history: null,
  savedFingerprint: null,
};

els.canvas.style.touchAction = "none";
els.canvas.style.userSelect = "none";
els.dragHint.textContent = "Click 选择 · 空白 Drag 平移 · Wheel 缩放";

const glbImportButton = document.createElement("button");
glbImportButton.id = "import-glb-button";
glbImportButton.type = "button";
glbImportButton.textContent = "导入 GLB / GLTF";
glbImportButton.title = "只保存文件引用和未确认授权状态";
glbImportButton.style.width = "100%";
glbImportButton.style.marginBottom = "10px";
const glbFileInput = document.createElement("input");
glbFileInput.id = "glb-file-input";
glbFileInput.type = "file";
glbFileInput.accept = ".glb,.gltf,model/gltf-binary,model/gltf+json";
glbFileInput.hidden = true;
els.componentSearch.insertAdjacentElement("afterend", glbImportButton);
els.componentSearch.insertAdjacentElement("afterend", glbFileInput);
els.glbImportButton = glbImportButton;
els.glbFileInput = glbFileInput;

function clone(value) {
  return structuredClone(value);
}

function svg(tag, attributes = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function stableRevision(artifact) {
  return artifact.revision ?? `local:${artifact.id}:${artifact.metadata?.updatedAt ?? "draft"}`;
}

function jsonFileName(fileName) {
  const leaf = String(fileName ?? "diagram.json").split(/[\\/]/).at(-1) || "diagram.json";
  return /\.json$/i.test(leaf) ? leaf : `${leaf}.json`;
}

function pngFileName(fileName) {
  return jsonFileName(fileName).replace(/\.json$/i, ".png");
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { outputRef: fileName };
}

async function downloadJson({ text, fileName }) {
  return downloadBlob(new Blob([text], { type: "application/json;charset=utf-8" }), fileName);
}

async function captureCurrentCanvas({ request, composition }) {
  const svgCopy = els.canvas.cloneNode(true);
  svgCopy.setAttribute("xmlns", NS);
  svgCopy.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  svgCopy.setAttribute("width", String(request.options.widthPx));
  svgCopy.setAttribute("height", String(request.options.heightPx));
  svgCopy.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Selection outlines and the authoring grid are editor-only guides, not PNG
  // layers. The exported artifact remains the same Diagram revision.
  svgCopy.querySelectorAll(".workspace-node[aria-selected=\"true\"] polyline").forEach((line) => line.remove());
  svgCopy.querySelectorAll(".workspace-route-handle").forEach((handle) => handle.remove());
  svgCopy.querySelectorAll(".workspace-annotation-selection").forEach((chrome) => chrome.remove());
  svgCopy.querySelectorAll(".workspace-annotation-hit").forEach((hit) => hit.remove());
  svgCopy.querySelectorAll("#workspace-scene > rect").forEach((rect) => {
    const fill = rect.getAttribute("fill") ?? "";
    if (fill.includes("workspace-grid") || fill === "#d8c2ac") rect.remove();
  });

  const svgBlob = new Blob([new XMLSerializer().serializeToString(svgCopy)], { type: "image/svg+xml" });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error("Reference Renderer SVG could not be rasterized")), { once: true });
      image.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = request.options.widthPx;
    canvas.height = request.options.heightPx;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG canvas context is unavailable");
    if (!request.options.transparentBackground) {
      context.fillStyle = "#faf8f2";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png");
    });
    const fileName = pngFileName(state.fileName);
    return {
      widthPx: canvas.width,
      heightPx: canvas.height,
      warnings: composition.warnings,
      ...downloadBlob(pngBlob, fileName),
    };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function assertArtifact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Diagram 必须是 JSON object");
  if (value.format !== "loom.diagram") throw new Error("Diagram format 不受支持");
  if (typeof value.schemaVersion !== "string" || value.schemaVersion !== "0.1.0") throw new Error("Diagram schemaVersion 不受支持");
  if (typeof value.id !== "string" || value.id.length === 0) throw new Error("Diagram id 缺失");
  if (!value.semantic || !Array.isArray(value.semantic.nodes) || !Array.isArray(value.semantic.edges) || !Array.isArray(value.semantic.groups)) throw new Error("Diagram semantic graph 不完整");
  if (!value.composition || !value.layout?.generated?.nodes || !value.layout?.generated?.routes || !value.layout?.generated?.groups) throw new Error("Diagram composition 或 layout 不完整");
  assertExportSettings(value.exportSettings);
  return value;
}

function setStatus(status, message, error = null) {
  state.status = status;
  state.error = error;
  els.app.dataset.status = status;
  els.status.dataset.status = status;
  els.status.textContent = `${status} · ${message}`;
  els.libraryNotice.hidden = !error;
  if (error) els.libraryNotice.textContent = error.message;
  if (status === "ready") els.libraryNotice.hidden = true;
}

function effectiveLayout(artifact) {
  const generated = artifact.layout.generated;
  const overrides = artifact.layout.overrides ?? { nodes: {}, routes: {}, groups: {}, view: {} };
  const merge = (kind) => Object.fromEntries(Object.entries(generated[kind] ?? {}).map(([id, value]) => [id, { ...value, ...(overrides[kind]?.[id] ?? {}) }]));
  return {
    nodes: merge("nodes"),
    routes: merge("routes"),
    groups: merge("groups"),
    view: { ...(artifact.composition.defaultView ?? {}), ...(overrides.view ?? {}) },
  };
}

function currentViewTransform() {
  const view = state.viewController.getState();
  return createIsometricTransform({
    pan: view.pan,
    zoom: view.zoom,
    basis: viewBasis(view),
  });
}

function refreshArtifactControllers() {
  if (!state.artifact) {
    state.canvasController = null;
    state.routeEditor = null;
    return;
  }
  state.canvasController = createWorkspaceCanvas({ artifact: state.artifact, revision: state.revision });
  state.routeEditor = createRouteEditor({ artifact: state.artifact, revision: state.revision });
  state.annotationEditor = createAnnotationEditor({ artifact: state.artifact, revision: state.revision });
}

function artifactFingerprint(artifact) {
  return JSON.stringify(artifact);
}

function syncDirtyFromHistory() {
  state.dirty = state.savedFingerprint === null || artifactFingerprint(state.artifact) !== state.savedFingerprint;
}

function reconcileSelection() {
  if (state.selectedId && !state.artifact.semantic.nodes.some((node) => node.id === state.selectedId)) state.selectedId = null;
  if (state.selectedEdgeId && !state.artifact.semantic.edges.some((edge) => edge.id === state.selectedEdgeId)) state.selectedEdgeId = null;
  if (state.selectedAnnotationId && !state.artifact.annotations.some((annotation) => annotation.id === state.selectedAnnotationId)) state.selectedAnnotationId = null;
}

function commitArtifactHistory(artifact, { transactionId, kind = "workspace.edit", message = "已提交 Workspace 修改" } = {}) {
  if (!state.history) throw new Error("Workspace history is unavailable");
  const nextHistory = commitHistoryTransaction(state.history, artifact, { transactionId, kind });
  state.history = nextHistory;
  state.artifact = clone(nextHistory.present);
  state.previewArtifact = null;
  reconcileSelection();
  syncDirtyFromHistory();
  refreshArtifactControllers();
  setStatus(state.dirty ? "dirty" : "ready", message);
  return nextHistory;
}

function commitExportCamera(camera) {
  if (!state.artifact) throw new Error("Cannot set an export camera without a Diagram");
  const artifact = withExportCamera(state.artifact, camera);
  const transactionId = `workspace-export-camera-${++state.exportCameraSequence}`;
  commitArtifactHistory(artifact, {
    transactionId,
    kind: "workspace.export-camera",
    message: "已更新导出相机设置",
  });
  return resolveExportCamera(state.artifact);
}

function project(point) {
  const z = point.z ?? point.elevation ?? 0;
  return currentViewTransform().diagramToScreen(point, { z });
}

function rotateDiagramPoint(point, center, rotationYDeg = 0) {
  const radians = rotationYDeg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    ...point,
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function pointString(points) {
  return points.map((point) => {
    const projected = project(point);
    return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
  }).join(" ");
}

function faceTones(color) {
  return { top: color, front: "#876d5c", side: "#3f4d54", edge: "#27343b" };
}

function polygon(points, fill, stroke = "none", strokeWidth = 0) {
  const shape = svg("polygon", { points: points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "), fill, stroke, "stroke-width": strokeWidth });
  return shape;
}

function surfacePoints(rect, z = 0, projectPoint = project) {
  return [
    projectPoint({ x: rect.x, y: rect.y, z }),
    projectPoint({ x: rect.x + rect.width, y: rect.y, z }),
    projectPoint({ x: rect.x + rect.width, y: rect.y + rect.height, z }),
    projectPoint({ x: rect.x, y: rect.y + rect.height, z }),
  ];
}

function extrudedRect(parent, rect, baseZ, height, tones, projectPoint = project) {
  const base = surfacePoints(rect, baseZ, projectPoint);
  const top = surfacePoints(rect, baseZ + height, projectPoint);
  parent.append(
    polygon([top[3], top[2], base[2], base[3]], tones.front, tones.edge, .65),
    polygon([top[1], top[2], base[2], base[1]], tones.side, tones.edge, .65),
    polygon(top, tones.top, tones.edge, .8),
  );
}

function label(parent, point, value, fill = "#26343b") {
  const text = svg("text", { x: point.x, y: point.y, "text-anchor": "middle", fill, "font-size": 10, "font-weight": 700, "font-family": "Inter, sans-serif" });
  text.textContent = value;
  parent.append(text);
}

function renderNode(parent, node, layout, index) {
  const group = svg("g", { class: "workspace-node", "data-node-id": node.id, tabindex: "0", role: "button", "aria-label": `${node.label} ${node.id}` });
  const scale = layout.scale ?? 1;
  const rect = { x: layout.x, y: layout.y, width: layout.width * scale, height: layout.height * scale };
  const diagramCenter = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const projectNodePoint = (point) => project(rotateDiagramPoint(point, diagramCenter, layout.rotationYDeg ?? 0));
  const color = node.visualRole === "alternative" ? "#aaa49a" : node.visualRole === "external-input" ? "#c66a43" : STAGE_COLORS[index % STAGE_COLORS.length];
  const tones = faceTones(color);
  const height = node.visualRole === "main-stage" ? 7 + (layout.elevation ?? 0) * .12 : 3;
  if (node.label === "FIELD") {
    extrudedRect(group, { ...rect, x: rect.x + 2, y: rect.y + 2, width: rect.width - 4, height: rect.height - 4 }, layout.elevation ?? 0, height, tones, projectNodePoint);
    for (let row = 1; row < 3; row += 1) {
      const a = projectNodePoint({ x: rect.x + 4, y: rect.y + rect.height * row / 3, z: (layout.elevation ?? 0) + height + .2 });
      const b = projectNodePoint({ x: rect.x + rect.width - 4, y: rect.y + rect.height * row / 3, z: (layout.elevation ?? 0) + height + .2 });
      group.append(svg("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: tones.edge, "stroke-width": .55, opacity: .5 }));
    }
  } else if (node.label === "BRANCH") {
    extrudedRect(group, { ...rect, x: rect.x + 4, y: rect.y + rect.height * .35, width: rect.width - 8, height: rect.height * .28 }, layout.elevation ?? 0, height, tones, projectNodePoint);
    for (let branch = 0; branch < 3; branch += 1) extrudedRect(group, { x: rect.x + rect.width * (.2 + branch * .25), y: rect.y + rect.height * .12, width: 4, height: rect.height * .7 }, (layout.elevation ?? 0) + height, 4 + branch, tones, projectNodePoint);
  } else if (node.label === "LINE") {
    extrudedRect(group, { ...rect, x: rect.x + 3, y: rect.y + rect.height * .3, width: rect.width - 6, height: rect.height * .4 }, layout.elevation ?? 0, height, tones, projectNodePoint);
    const count = node.properties?.cardCount ?? 6;
    for (let card = 0; card < Math.min(count, 6); card += 1) extrudedRect(group, { x: rect.x + 6 + card * ((rect.width - 12) / 6), y: rect.y + rect.height * .35, width: (rect.width - 18) / 6, height: rect.height * .3 }, (layout.elevation ?? 0) + height, 2.2 + card % 2, tones, projectNodePoint);
  } else {
    extrudedRect(group, rect, layout.elevation ?? 0, height, tones, projectNodePoint);
  }
  const labelCenter = projectNodePoint({ x: diagramCenter.x, y: diagramCenter.y, z: (layout.elevation ?? 0) + height + 2 });
  label(group, { x: labelCenter.x, y: labelCenter.y + 4 }, node.label, node.visualRole === "alternative" ? "#5e5d58" : "#26343b");
  if (state.selectedId === node.id) {
    const outline = surfacePoints(rect, (layout.elevation ?? 0) + height + 1, projectNodePoint);
    group.append(svg("polyline", { points: [...outline, outline[0]].map((point) => `${point.x},${point.y}`).join(" "), fill: "none", stroke: "#c66a43", "stroke-width": 2, "stroke-dasharray": "5 4" }));
    group.setAttribute("aria-selected", "true");
  } else group.setAttribute("aria-selected", "false");
  group.addEventListener("click", (event) => { event.stopPropagation(); selectNode(node.id); });
  group.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectNode(node.id); } });
  parent.append(group);
}

function routeStroke(edge, selected = false) {
  if (selected) return "#c66a43";
  if (edge.visualRole === "alternative") return "#aaa49a";
  if (edge.visualRole === "compounding-loop") return "#7467a8";
  if (edge.visualRole === "external-input") return "#c66a43";
  return "#58748b";
}

function renderRoute(parent, edge, route) {
  const selected = state.selectedEdgeId === edge.id;
  const routePointsAttribute = pointString(route.points);
  const hitLine = svg("polyline", {
    class: "workspace-route-hit",
    "data-edge-id": edge.id,
    points: routePointsAttribute,
    fill: "none",
    stroke: "transparent",
    "stroke-width": 14,
    "pointer-events": "stroke",
    tabindex: "0",
    role: "button",
    "aria-label": `Route ${edge.id}`,
    "aria-selected": selected ? "true" : "false",
  });
  hitLine.addEventListener("click", (event) => { event.stopPropagation(); selectRoute(edge.id); });
  hitLine.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectRoute(edge.id);
    }
  });
  const line = svg("polyline", {
    class: "workspace-route",
    "data-edge-id": edge.id,
    points: routePointsAttribute,
    fill: "none",
    stroke: routeStroke(edge, selected),
    "stroke-width": selected ? 3 : edge.visualRole === "main-flow" ? 2 : 1.2,
    "stroke-dasharray": edge.visualRole === "alternative" ? "5 5" : "",
    "marker-end": "url(#workspace-arrow)",
    opacity: selected ? .98 : .82,
    "pointer-events": "none",
  });
  parent.append(hitLine, line);
}

function renderRouteHandles(parent, edge, route) {
  if (state.selectedEdgeId !== edge.id) return;
  route.points.forEach((point, index) => {
    const projected = project(point);
    const handle = svg("circle", {
      class: "workspace-route-handle",
      "data-route-edge-id": edge.id,
      "data-route-index": index,
      cx: projected.x,
      cy: projected.y,
      r: index === 0 || index === route.points.length - 1 ? 5 : 4,
      fill: "#fffdf9",
      stroke: "#c66a43",
      "stroke-width": 2,
      tabindex: "0",
      role: "button",
      "aria-label": `编辑 ${edge.id} 路线点 ${index + 1}`,
    });
    handle.addEventListener("click", (event) => { event.stopPropagation(); selectRoute(edge.id); });
    parent.append(handle);
  });
}

function annotationPoint(annotation, artifact) {
  try {
    return resolveAnnotationAnchor(annotation, artifact, effectiveLayout(artifact));
  } catch (error) {
    state.error = error instanceof Error ? error : new Error(String(error));
    return null;
  }
}

function renderAnnotation(parent, annotation, artifact) {
  const anchor = annotationPoint(annotation, artifact);
  if (!anchor) return;
  const projected = project(anchor);
  const selected = state.selectedAnnotationId === annotation.id;
  const isTitle = annotation.visualRole === "title";
  const offsetX = isTitle ? 22 : 8;
  const offsetY = isTitle ? -14 : -8;
  const group = svg("g", {
    class: "workspace-annotation",
    "data-annotation-id": annotation.id,
    tabindex: "0",
    role: "button",
    "aria-label": `Annotation ${annotation.id}`,
    "aria-selected": selected ? "true" : "false",
  });
  const hitWidth = Math.max(96, annotation.text.length * 7 + 18);
  group.append(svg("rect", {
    class: "workspace-annotation-hit",
    x: isTitle ? projected.x + offsetX : projected.x - hitWidth / 2,
    y: projected.y + offsetY - 13,
    width: hitWidth,
    height: 22,
    fill: "transparent",
    "pointer-events": "fill",
  }));
  if (selected) {
    group.append(svg("circle", { class: "workspace-annotation-selection", cx: projected.x, cy: projected.y, r: 7, fill: "none", stroke: "#c66a43", "stroke-width": 1.5, "stroke-dasharray": "3 3" }));
  }
  const text = svg("text", {
    x: projected.x + offsetX,
    y: projected.y + offsetY,
    "text-anchor": isTitle ? "start" : "middle",
    fill: isTitle ? "#4d5a5d" : "#58656a",
    "font-size": isTitle ? 12 : 9,
    "font-weight": isTitle ? 700 : 600,
    "font-family": isTitle ? "Georgia, serif" : "Inter, sans-serif",
  });
  text.textContent = annotation.text;
  group.append(text);
  group.addEventListener("click", (event) => { event.stopPropagation(); selectAnnotation(annotation.id); });
  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectAnnotation(annotation.id);
    }
  });
  parent.append(group);
}

function renderCanvas() {
  els.scene.replaceChildren();
  if (!state.artifact) {
    const empty = svg("text", { x: 550, y: 350, "text-anchor": "middle", fill: "#7c817f", "font-size": 16, "font-family": "Georgia, serif" });
    empty.textContent = "打开一个 Diagram 开始构图";
    els.scene.append(empty);
    return;
  }
  const displayArtifact = state.previewArtifact ?? state.artifact;
  const layout = effectiveLayout(displayArtifact);
  const canvas = svg("rect", { x: 0, y: 0, width: 1100, height: 700, fill: "#faf8f2" });
  const grid = svg("rect", { x: 0, y: 0, width: 1100, height: 700, fill: "url(#workspace-grid)", opacity: .72 });
  const gutter = svg("rect", { x: 510, y: 0, width: 22, height: 700, fill: "#d8c2ac", opacity: .13 });
  els.scene.append(canvas, grid, gutter);
  for (const group of displayArtifact.semantic.groups) {
    const bounds = layout.groups[group.id]?.bounds;
    if (!bounds) continue;
    const points = surfacePoints(bounds, 0).map((point) => `${point.x},${point.y}`).join(" ");
    const zone = svg("polygon", { points, fill: "none", stroke: "#bdb6aa", "stroke-width": 1, "stroke-dasharray": "5 5", opacity: .72 });
    els.scene.append(zone);
  }
  for (const edge of displayArtifact.semantic.edges) {
    const route = layout.routes[edge.id];
    if (!route?.points) continue;
    renderRoute(els.scene, edge, route);
  }
  [...displayArtifact.semantic.nodes].sort((left, right) => (layout.nodes[left.id]?.zIndex ?? 0) - (layout.nodes[right.id]?.zIndex ?? 0)).forEach((node, index) => {
    if (layout.nodes[node.id]) renderNode(els.scene, node, layout.nodes[node.id], index);
  });
  for (const edge of displayArtifact.semantic.edges) {
    const route = layout.routes[edge.id];
    if (route?.points) renderRouteHandles(els.scene, edge, route);
  }
  for (const annotation of displayArtifact.annotations ?? []) renderAnnotation(els.scene, annotation, displayArtifact);
}

function fallbackComponentEntries() {
  const query = state.query.trim().toLocaleLowerCase();
  const seen = new Set();
  return state.artifact.semantic.nodes.flatMap((node) => {
    const key = node.componentRef ?? node.id;
    if (seen.has(key)) return [];
    seen.add(key);
    const haystack = `${node.label} ${key} ${node.phase ?? ""}`.toLocaleLowerCase();
    if (query && !haystack.includes(query)) return [];
    return [{ kind: "reference", id: key, name: node.label, description: key, nodeId: node.id }];
  });
}

function selectedComponentNode() {
  return state.artifact?.semantic.nodes.find((node) => node.id === state.selectedId) ?? null;
}

function nextTransformGesture(operation) {
  state.transformSequence += 1;
  return `workspace-transform-${operation.toLocaleLowerCase()}-${state.transformSequence}`;
}

function nextComponentGesture(operation = "replace") {
  state.componentSequence += 1;
  return `workspace-component-${operation.toLocaleLowerCase()}-${state.componentSequence}`;
}

function transformOptions(operation, rawValue) {
  return {
    baseRevision: state.revision,
    gestureId: nextTransformGesture(operation),
    nodeId: state.selectedId,
    operation,
    value: rawValue,
  };
}

function previewInspectorField(operation, rawValue) {
  if (!state.artifact || !state.selectedId || state.activePointerId !== null) return;
  try {
    const result = previewInspectorTransform(state.artifact, transformOptions(operation, rawValue));
    state.previewArtifact = result.artifact;
    setStatus("ready", "变换预览中 · 提交字段后写入一次 Override");
    renderCanvas();
  } catch (error) {
    state.previewArtifact = null;
    setStatus("error", "变换预览失败", error instanceof Error ? error : new Error(String(error)));
    renderCanvas();
  }
}

function commitInspectorField(operation, rawValue) {
  if (!state.artifact || !state.selectedId || state.activePointerId !== null) return;
  try {
    const result = commitInspectorTransform(state.artifact, transformOptions(operation, rawValue));
    commitArtifactHistory(result.artifact, {
      transactionId: result.command.gestureId,
      kind: result.command.type,
      message: `已提交 ${result.command.type} · 1 个字段级 Human Override`,
    });
    render();
  } catch (error) {
    state.previewArtifact = null;
    setStatus("error", "变换提交失败", error instanceof Error ? error : new Error(String(error)));
    render();
  }
}

function applyComponentArtifact(artifact, message, { transactionId = nextComponentGesture(), kind = "semantic.node.update" } = {}) {
  commitArtifactHistory(artifact, { transactionId, kind, message });
  state.componentError = null;
  render();
}

function handleComponentEntry(entry) {
  if (entry.kind === "reference") {
    selectNode(entry.nodeId);
    return;
  }
  if (!state.artifact || !state.selectedId) {
    setStatus("ready", "先选择 Canvas 节点，再选择组件形态");
    state.componentError = "组件替换需要先在 Canvas 选择一个 Scene Node。";
    renderComponents();
    return;
  }
  try {
    const replacement = entry.kind === "asset"
      ? replaceNodeComponent(state.artifact, { nodeId: state.selectedId, assetId: entry.id })
      : replaceNodeComponent(state.artifact, { nodeId: state.selectedId, componentRef: entry.id });
    applyComponentArtifact(replacement.artifact, entry.kind === "asset" ? "已绑定 GLB 引用 · 导出仍被授权门禁阻止" : `已将 ${state.selectedId} 替换为 ${entry.name}`, {
      transactionId: nextComponentGesture(entry.kind === "asset" ? "asset" : "replace"),
      kind: replacement.command.type,
    });
  } catch (error) {
    state.componentError = error instanceof Error ? error.message : String(error);
    setStatus("error", "组件替换失败", error instanceof Error ? error : new Error(String(error)));
    renderComponents();
  }
}

function renderComponents() {
  if (!state.artifact) {
    els.componentList.replaceChildren();
    els.componentCount.textContent = "等待加载";
    return;
  }
  let entries;
  try {
    const node = selectedComponentNode();
    entries = state.catalog
      ? listComponentEntries({ catalog: state.catalog, artifact: state.artifact, nodeType: node?.type, query: state.query })
      : fallbackComponentEntries();
  } catch (error) {
    state.componentError = error instanceof Error ? error.message : String(error);
    entries = fallbackComponentEntries();
  }
  const assetCount = entries.filter((entry) => entry.kind === "asset").length;
  els.componentCount.textContent = `${entries.length} 个可用形态${assetCount ? ` · ${assetCount} 个 GLB 引用` : ""}`;
  els.componentList.replaceChildren();
  const selected = selectedComponentNode();
  for (const entry of entries) {
    const button = document.createElement("button");
    button.className = "component";
    button.type = "button";
    button.setAttribute("aria-current", selected?.componentRef === entry.id || selected?.properties?.assetRef === entry.id ? "true" : "false");
    button.setAttribute("aria-label", `${entry.name} · ${entry.kind === "asset" ? "GLB asset" : "template"}`);
    const swatch = document.createElement("span");
    swatch.className = "component-swatch";
    if (entry.kind === "asset") swatch.style.background = "linear-gradient(145deg, #b7a5c8 0 30%, #625274 31% 75%, #2d263c 76%)";
    const copy = document.createElement("span");
    const name = document.createElement("span");
    name.className = "component-name";
    name.textContent = entry.name;
    const meta = document.createElement("span");
    meta.className = "component-meta";
    meta.textContent = entry.kind === "asset"
      ? `GLB · ${entry.export === "blocked" ? "授权未确认 / 导出阻止" : entry.license}`
      : `模板 · ${entry.reasons?.[0]?.label ?? "可替换形态"}`;
    copy.append(name, meta);
    button.append(swatch, copy);
    button.addEventListener("click", () => handleComponentEntry(entry));
    els.componentList.append(button);
  }
  const gate = evaluateComponentExportGate(state.artifact);
  const notice = state.componentError
    ?? (state.error ? state.error.message : null)
    ?? (gate.status === "blocked" ? `GLB 授权未确认：${gate.blockedAssets.map((asset) => asset.assetId).join("、")} · PNG 导出阻止` : null);
  els.libraryNotice.hidden = !notice;
  if (notice) els.libraryNotice.textContent = notice;
}

function renderInspector() {
  if (!state.artifact || (!state.selectedId && !state.selectedEdgeId && !state.selectedAnnotationId)) {
    els.inspector.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "inspector-empty";
    empty.textContent = state.artifact ? "选择一个 Scene Node、Route 或 Annotation 后，这里会显示它的语义身份和构图状态。" : "打开 Diagram 后，这里会显示选中对象的语义上下文。";
    els.inspector.append(empty);
    return;
  }
  if (state.selectedAnnotationId) {
    const annotation = selectedAnnotation();
    if (!annotation) { state.selectedAnnotationId = null; renderInspector(); return; }
    els.inspector.replaceChildren();
    const card = document.createElement("div");
    card.className = "inspector-card";
    const eyebrow = document.createElement("p"); eyebrow.className = "inspector-label"; eyebrow.textContent = "annotation";
    const title = document.createElement("h3"); title.className = "inspector-title"; title.textContent = annotation.id;
    card.append(eyebrow, title);

    const textField = document.createElement("div"); textField.className = "field";
    const textLabel = document.createElement("label"); textLabel.textContent = "Text";
    const textInput = document.createElement("textarea"); textInput.rows = 3; textInput.value = annotation.text; textInput.setAttribute("aria-label", "标注文本");
    textInput.addEventListener("input", () => previewAnnotationPatch({ text: textInput.value }));
    textInput.addEventListener("change", () => commitAnnotationField({ text: textInput.value }));
    textField.append(textLabel, textInput);

    const roleField = document.createElement("div"); roleField.className = "field";
    const roleLabel = document.createElement("label"); roleLabel.textContent = "Visual role";
    const roleInput = document.createElement("input"); roleInput.value = annotation.visualRole; roleInput.setAttribute("aria-label", "标注视觉角色");
    roleInput.addEventListener("input", () => previewAnnotationPatch({ visualRole: roleInput.value }));
    roleInput.addEventListener("change", () => commitAnnotationField({ visualRole: roleInput.value }));
    roleField.append(roleLabel, roleInput);

    const anchorField = document.createElement("div"); anchorField.className = "field";
    const anchorLabel = document.createElement("label"); anchorLabel.textContent = "Anchor";
    const kindSelect = document.createElement("select"); kindSelect.setAttribute("aria-label", "标注锚点类型");
    for (const kind of ["canvas", "node", "edge", "group"]) {
      const option = document.createElement("option"); option.value = kind; option.textContent = kind; kindSelect.append(option);
    }
    kindSelect.value = annotation.anchor.kind;
    const targetWrap = document.createElement("div"); targetWrap.className = "field";
    const targetLabel = document.createElement("label"); targetLabel.textContent = "Target";
    const targetSelect = document.createElement("select"); targetSelect.setAttribute("aria-label", "标注目标");
    targetWrap.append(targetLabel, targetSelect);
    const xInput = document.createElement("input"); xInput.type = "number"; xInput.step = "1"; xInput.setAttribute("aria-label", "锚点 X");
    const yInput = document.createElement("input"); yInput.type = "number"; yInput.step = "1"; yInput.setAttribute("aria-label", "锚点 Y");
    const xLabel = document.createElement("label"); const yLabel = document.createElement("label");
    const xWrap = document.createElement("div"); xWrap.className = "field"; xWrap.append(xLabel, xInput);
    const yWrap = document.createElement("div"); yWrap.className = "field"; yWrap.append(yLabel, yInput);
    const anchorGrid = document.createElement("div"); anchorGrid.className = "transform-grid";
    anchorGrid.append(xWrap, yWrap);

    function targetEntries(kind) {
      if (kind === "node") return state.artifact.semantic.nodes;
      if (kind === "edge") return state.artifact.semantic.edges;
      if (kind === "group") return state.artifact.semantic.groups;
      return [];
    }
    function refreshAnchorFields() {
      const kind = kindSelect.value;
      const entries = targetEntries(kind);
      targetSelect.replaceChildren();
      for (const entry of entries) {
        const option = document.createElement("option"); option.value = entry.id; option.textContent = entry.id; targetSelect.append(option);
      }
      targetWrap.hidden = kind === "canvas";
      targetSelect.value = kind === annotation.anchor.kind ? annotation.anchor.targetId ?? entries[0]?.id ?? "" : entries[0]?.id ?? "";
      const point = kind === "canvas" ? annotation.anchor.position : annotation.anchor.offset ?? { x: 0, y: 0 };
      xLabel.textContent = kind === "canvas" ? "Position X" : "Offset X";
      yLabel.textContent = kind === "canvas" ? "Position Y" : "Offset Y";
      xInput.value = String(point?.x ?? 0);
      yInput.value = String(point?.y ?? 0);
    }
    function readAnchor() {
      const kind = kindSelect.value;
      const point = { x: Number(xInput.value), y: Number(yInput.value) };
      return kind === "canvas" ? { kind, position: point } : { kind, targetId: targetSelect.value, offset: point };
    }
    function previewAnchor() { previewAnnotationPatch({ anchor: readAnchor() }); }
    function commitAnchor() { commitAnnotationPatch({ anchor: readAnchor() }); }
    refreshAnchorFields();
    kindSelect.addEventListener("change", () => { refreshAnchorFields(); previewAnchor(); commitAnnotationField({ anchor: readAnchor() }); });
    targetSelect.addEventListener("input", previewAnchor);
    targetSelect.addEventListener("change", () => commitAnnotationField({ anchor: readAnchor() }));
    for (const input of [xInput, yInput]) {
      input.addEventListener("input", previewAnchor);
      input.addEventListener("change", () => commitAnnotationField({ anchor: readAnchor() }));
    }
    anchorField.append(anchorLabel, kindSelect, targetWrap, anchorGrid);

    const propertiesField = document.createElement("div"); propertiesField.className = "field";
    const propertiesLabel = document.createElement("label"); propertiesLabel.textContent = "Properties JSON";
    const propertiesInput = document.createElement("textarea"); propertiesInput.rows = 3; propertiesInput.value = JSON.stringify(annotation.properties ?? {}, null, 2); propertiesInput.setAttribute("aria-label", "标注 properties JSON");
    function readProperties() {
      const parsed = JSON.parse(propertiesInput.value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("properties 必须是 JSON object");
      return parsed;
    }
    propertiesInput.addEventListener("input", () => { try { previewAnnotationPatch({ properties: readProperties() }); } catch (error) { setStatus("error", "properties JSON 无效", error instanceof Error ? error : new Error(String(error))); } });
    propertiesInput.addEventListener("change", () => { try { commitAnnotationField({ properties: readProperties() }); } catch (error) { setStatus("error", "properties JSON 无效", error instanceof Error ? error : new Error(String(error))); } });
    propertiesField.append(propertiesLabel, propertiesInput);
    const help = document.createElement("p"); help.className = "inspector-help"; help.textContent = state.previewArtifact ? "标注预览中 · 提交字段后写入一次 annotation.update" : "编辑文本、visualRole 或 anchor，离开字段时一次提交。";
    card.append(textField, roleField, anchorField, propertiesField, help);
    els.inspector.append(card);
    return;
  }
  if (state.selectedEdgeId) {
    const edge = state.artifact.semantic.edges.find((candidate) => candidate.id === state.selectedEdgeId);
    const points = effectiveLayout(state.previewArtifact ?? state.artifact).routes[state.selectedEdgeId]?.points ?? [];
    if (!edge) { state.selectedEdgeId = null; renderInspector(); return; }
    els.inspector.replaceChildren();
    const card = document.createElement("div");
    card.className = "inspector-card";
    const eyebrow = document.createElement("p"); eyebrow.className = "inspector-label"; eyebrow.textContent = "route";
    const title = document.createElement("h3"); title.className = "inspector-title"; title.textContent = edge.id;
    const hint = document.createElement("p"); hint.className = "inspector-help"; hint.textContent = state.previewArtifact ? "控制点预览中 · 松手提交一次路线 Override" : "拖动画布上的控制点，路线会在松手时一次提交。";
    const field = document.createElement("div"); field.className = "field";
    const caption = document.createElement("label"); caption.textContent = "Control points";
    const code = document.createElement("code"); code.textContent = points.map((point) => `${point.x}, ${point.y}`).join(" → ");
    field.append(caption, code);
    card.append(eyebrow, title, hint, field);
    els.inspector.append(card);
    return;
  }
  const displayArtifact = state.previewArtifact ?? state.artifact;
  const node = displayArtifact.semantic.nodes.find((candidate) => candidate.id === state.selectedId);
  if (!node) { state.selectedId = null; renderInspector(); return; }
  const layout = effectiveLayout(displayArtifact).nodes[node.id] ?? {};
  els.inspector.replaceChildren();
  const card = document.createElement("div");
  card.className = "inspector-card";
  const eyebrow = document.createElement("p"); eyebrow.className = "inspector-label"; eyebrow.textContent = node.type ?? "scene node";
  const title = document.createElement("h3"); title.className = "inspector-title"; title.textContent = node.label;
  card.append(eyebrow, title);
  const fields = [["Stable ID", node.id], ["Component", node.componentRef], ["Phase", node.phase ?? "—"], ["Position", `${layout.x ?? "—"}, ${layout.y ?? "—"} · elevation ${layout.elevation ?? 0}`], ["Status", state.previewArtifact ? "preview / not committed" : state.dirty ? "draft / dirty" : "ready / canonical"]];
  for (const [name, value] of fields) {
    const wrapper = document.createElement("div"); wrapper.className = "field";
    const caption = document.createElement("label"); caption.textContent = name;
    const code = document.createElement("code"); code.textContent = String(value);
    wrapper.append(caption, code); card.append(wrapper);
  }
  const transformHelp = document.createElement("p");
  transformHelp.className = "inspector-help";
  transformHelp.textContent = "编辑后先在画布预览，离开字段时提交一次变换命令。";
  card.append(transformHelp);
  const transformGrid = document.createElement("div");
  transformGrid.className = "transform-grid";
  const transformFields = [
    ["绕 Y 轴旋转", "rotateY", layout.rotationYDeg ?? 0, "1"],
    ["等比缩放", "scale", layout.scale ?? 1, "0.05"],
    ["Elevation", "elevation", layout.elevation ?? 0, "1"],
    ["前后层级", "zIndex", layout.zIndex ?? 0, "1"],
  ];
  for (const [name, operation, value, step] of transformFields) {
    const wrapper = document.createElement("div");
    wrapper.className = "field transform-field";
    const caption = document.createElement("label");
    caption.textContent = name;
    caption.htmlFor = `transform-${operation}`;
    const input = document.createElement("input");
    input.id = `transform-${operation}`;
    input.type = "number";
    input.step = step;
    input.value = String(value);
    input.dataset.transformOperation = operation;
    input.setAttribute("aria-label", name);
    input.addEventListener("input", () => previewInspectorField(operation, input.value));
    input.addEventListener("change", () => commitInspectorField(operation, input.value));
    wrapper.append(caption, input);
    transformGrid.append(wrapper);
  }
  card.append(transformGrid);
  els.inspector.append(card);
}

function renderMeta() {
  els.title.textContent = state.fileName ?? "未打开 Diagram";
  els.canvasMeta.textContent = state.artifact ? `${state.artifact.semantic.nodes.length} nodes · ${state.artifact.semantic.edges.length} routes · ${state.revision}` : "未加载 RenderDocument";
  const view = state.viewController.getState();
  if (state.artifact) {
    els.canvasMeta.textContent = [
      state.artifact.semantic.nodes.length + " nodes",
      state.artifact.semantic.edges.length + " routes",
      state.revision,
      "view " + view.zoom.toFixed(2) + "×",
    ].join(" · ");
  }
  const gate = state.artifact ? evaluateComponentExportGate(state.artifact) : { status: "blocked" };
  els.saveButton.disabled = !state.artifact || !state.dirty || state.saving;
  els.undoButton.disabled = !state.history || !canUndoHistory(state.history);
  els.redoButton.disabled = !state.history || !canRedoHistory(state.history);
  els.exportButton.disabled = !state.artifact || gate.status === "blocked" || state.exporting;
}

function render() {
  renderMeta();
  renderComponents();
  renderCanvas();
  renderInspector();
}

function setArtifact(artifact, fileName = "diagram.json") {
  assertArtifact(artifact);
  state.artifact = clone(artifact);
  state.fileName = fileName;
  state.revision = stableRevision(artifact);
  state.selectedId = null;
  state.selectedEdgeId = null;
  state.selectedAnnotationId = null;
  state.dirty = false;
  state.previewArtifact = null;
  state.history = createHistoryStack(state.artifact);
  state.savedFingerprint = artifactFingerprint(state.artifact);
  refreshArtifactControllers();
  state.activePointerId = null;
  state.activeRoutePointerId = null;
  state.dragging = false;
  state.moved = false;
  state.viewController.setDefaultView(state.artifact.composition.defaultView);
  state.viewPointer = null;
  state.componentError = null;
  state.lastExport = null;
  setStatus("ready", "Diagram 已加载");
  render();
}

async function handleSave() {
  if (!state.artifact || !state.dirty || state.saving) return;
  state.saving = true;
  setStatus("saving", "正在保存 diagram.json");
  renderMeta();
  try {
    const receipt = await saveWorkspaceWithAdapter(state.artifact, {
      fileName: state.fileName,
      currentRevision: state.revision,
      adapter: { save: downloadJson },
    });
    state.artifact = clone(receipt.artifact);
    state.fileName = receipt.fileName;
    state.revision = receipt.revision;
    state.history = replaceHistoryPresent(state.history, receipt.artifact);
    state.dirty = false;
    state.savedFingerprint = artifactFingerprint(receipt.artifact);
    state.previewArtifact = null;
    refreshArtifactControllers();
    setStatus("ready", `已保存 · ${receipt.revision}`);
  } catch (error) {
    state.dirty = true;
    setStatus("error", "保存失败，当前修改仍可恢复", error instanceof Error ? error : new Error(String(error)));
  } finally {
    state.saving = false;
    render();
  }
}

function applyHistoryNavigation(nextHistory, action) {
  state.history = nextHistory;
  state.artifact = clone(nextHistory.present);
  state.previewArtifact = null;
  reconcileSelection();
  syncDirtyFromHistory();
  refreshArtifactControllers();
  const event = nextHistory.lastEvent;
  const suffix = event?.transactionId ? ` · ${event.transactionId}` : "";
  setStatus(state.dirty ? "dirty" : "ready", `${action}${suffix}`);
  render();
}

function cancelActivePreview() {
  if (state.canvasController?.getState().active) state.canvasController.cancel();
  if (state.routeEditor?.getState().active) state.routeEditor.cancel();
  if (state.annotationEditor?.getState().active) state.annotationEditor.cancel();
  state.previewArtifact = null;
  state.activePointerId = null;
  state.activeRoutePointerId = null;
  state.dragging = false;
  state.moved = false;
}

function handleUndo() {
  if (!state.history) return;
  cancelActivePreview();
  const next = undoHistoryStack(state.history);
  if (next.lastEvent.type === "undo-empty") {
    setStatus(state.dirty ? "dirty" : "ready", "没有可撤销的 Workspace 修改");
    renderMeta();
    return;
  }
  applyHistoryNavigation(next, "已 Undo");
}

function handleRedo() {
  if (!state.history) return;
  cancelActivePreview();
  const next = redoHistoryStack(state.history);
  if (next.lastEvent.type === "redo-empty") {
    setStatus(state.dirty ? "dirty" : "ready", "没有可重做的 Workspace 修改");
    renderMeta();
    return;
  }
  applyHistoryNavigation(next, "已 Redo");
}

async function handleExport() {
  if (!state.artifact || state.exporting) return;
  const gate = evaluateComponentExportGate(state.artifact);
  if (gate.status === "blocked") {
    const blockedIds = gate.blockedAssets.map((asset) => asset.assetId).join("、");
    setStatus("error", "PNG 导出已阻止", new Error(`GLB 授权未确认：${blockedIds}`));
    render();
    return;
  }
  state.exporting = true;
  setStatus("exporting", "正在生成双 A4 PNG");
  renderMeta();
  try {
    const plan = await createWorkspacePngPlan(state.artifact, {
      // A dirty draft receives its own content fingerprint; a saved artifact
      // keeps the revision returned by the JSON save receipt.
      revision: state.dirty ? undefined : state.revision,
      catalog: state.catalog?.templates ?? [],
    });
    const receipt = await captureWorkspacePng(plan, { capturePng: captureCurrentCanvas });
    state.lastExport = receipt;
    setStatus("ready", `PNG 已导出 · ${receipt.widthPx} × ${receipt.heightPx} · ${receipt.revision}`);
  } catch (error) {
    setStatus("error", "PNG 导出失败", error instanceof Error ? error : new Error(String(error)));
  } finally {
    state.exporting = false;
    render();
  }
}

async function loadUrl(url, fileName = url.split("/").at(-1)) {
  setStatus("loading", "正在读取 Diagram");
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`无法读取 Diagram（HTTP ${response.status}）`);
    setArtifact(await response.json(), fileName);
  } catch (error) {
    state.artifact = null;
    state.fileName = null;
    state.revision = null;
    state.selectedId = null;
    state.selectedEdgeId = null;
    state.selectedAnnotationId = null;
    state.previewArtifact = null;
    state.history = null;
    state.savedFingerprint = null;
    state.canvasController = null;
    state.routeEditor = null;
    state.annotationEditor = null;
    state.activePointerId = null;
    state.activeRoutePointerId = null;
    state.dragging = false;
    state.moved = false;
    state.viewController.setDefaultView();
    state.viewPointer = null;
    setStatus("error", "读取失败", error instanceof Error ? error : new Error(String(error)));
    render();
  }
}

function selectNode(nodeId) {
  if (!state.artifact || !state.artifact.semantic.nodes.some((node) => node.id === nodeId)) return;
  state.canvasController?.selectNode(nodeId);
  state.selectedId = nodeId;
  state.selectedEdgeId = null;
  state.selectedAnnotationId = null;
  renderCanvas();
  renderComponents();
  renderInspector();
}

function selectRoute(edgeId) {
  if (!state.artifact || !state.artifact.semantic.edges.some((edge) => edge.id === edgeId)) return;
  state.selectedEdgeId = edgeId;
  state.selectedId = null;
  state.selectedAnnotationId = null;
  renderCanvas();
  renderComponents();
  renderInspector();
}

function selectedAnnotation() {
  const displayArtifact = state.previewArtifact ?? state.artifact;
  return displayArtifact?.annotations?.find((annotation) => annotation.id === state.selectedAnnotationId) ?? null;
}

function beginAnnotationEdit() {
  if (!state.annotationEditor || !state.selectedAnnotationId) return false;
  if (!state.annotationEditor.getState().active) {
    const result = state.annotationEditor.begin({ annotationId: state.selectedAnnotationId });
    if (!result.accepted) return false;
  }
  return true;
}

function previewAnnotationPatch(patch) {
  if (!state.artifact || !state.selectedAnnotationId || !beginAnnotationEdit()) return;
  try {
    const result = state.annotationEditor.preview({ patch });
    state.previewArtifact = result.artifact;
    setStatus("ready", "标注预览中 · 提交字段后写入一次 Override");
    renderCanvas();
  } catch (error) {
    setStatus("error", "标注预览失败", error instanceof Error ? error : new Error(String(error)));
  }
}

function commitAnnotationPatch(patch) {
  if (!state.artifact || !state.selectedAnnotationId || !beginAnnotationEdit()) return;
  try {
    const result = state.annotationEditor.commit({ patch });
    if (!result.command) return;
    commitArtifactHistory(result.artifact, {
      transactionId: result.command.gestureId,
      kind: result.command.type,
      message: "已提交 1 个 annotation.update Human Override",
    });
    render();
  } catch (error) {
    state.previewArtifact = null;
    setStatus("error", "标注提交失败", error instanceof Error ? error : new Error(String(error)));
    render();
  }
}

function commitAnnotationField(patch) {
  if (state.suppressAnnotationCommit) return;
  commitAnnotationPatch(patch);
}

function selectAnnotation(annotationId) {
  if (!state.artifact?.annotations?.some((annotation) => annotation.id === annotationId)) return;
  if (state.annotationEditor?.getState().active) state.annotationEditor.cancel();
  state.previewArtifact = null;
  state.selectedAnnotationId = annotationId;
  state.selectedId = null;
  state.selectedEdgeId = null;
  renderCanvas();
  renderComponents();
  renderInspector();
}

function handleFile(file) {
  if (!file) {
    const status = state.artifact ? (state.dirty ? "dirty" : "ready") : "idle";
    setStatus(status, "已取消打开 · 当前 Diagram 未改变");
    renderMeta();
    return;
  }
  setStatus("loading", "正在解析本地 Diagram");
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try { setArtifact(JSON.parse(String(reader.result)), file.name); }
    catch (error) {
      setStatus("error", "文件无效", error instanceof Error ? error : new Error(String(error)));
      render();
    }
  });
  reader.addEventListener("error", () => {
    setStatus("error", "文件读取失败", new Error("无法读取本地文件"));
    render();
  });
  reader.readAsText(file);
}

async function loadComponentCatalog() {
  try {
    const response = await fetch(COMPONENT_CATALOG_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`无法读取组件 Catalog（HTTP ${response.status}）`);
    state.catalog = await response.json();
    state.componentError = null;
    renderComponents();
  } catch (error) {
    state.catalog = null;
    state.componentError = error instanceof Error ? error.message : String(error);
    renderComponents();
  }
}

function handleGlbFile(file) {
  if (!file || !state.artifact) return;
  try {
    const result = importUserGlbReference(state.artifact, {
      fileName: file.name,
      uri: file.webkitRelativePath || file.name,
    });
    applyComponentArtifact(result.artifact, `已导入 ${result.asset.id} · 只保存引用，授权未确认`, {
      transactionId: nextComponentGesture("import"),
      kind: "component.asset.import",
    });
  } catch (error) {
    state.componentError = error instanceof Error ? error.message : String(error);
    setStatus("error", "GLB 导入失败", error instanceof Error ? error : new Error(String(error)));
    renderComponents();
  } finally {
    els.glbFileInput.value = "";
  }
}

function viewBoxPoint(event) {
  const bounds = els.canvas.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) throw new Error("Canvas viewport is not measurable");
  return {
    x: (event.clientX - bounds.left) * 1100 / bounds.width,
    y: (event.clientY - bounds.top) * 700 / bounds.height,
  };
}

function diagramPointFromEvent(event, nodeId) {
  const layout = effectiveLayout(state.artifact).nodes[nodeId] ?? {};
  const transform = currentViewTransform();
  return transform.screenToDiagram(viewBoxPoint(event), { z: layout.elevation ?? 0 });
}

function nodeIdFromEvent(event) {
  const target = event.target?.closest?.("[data-node-id]");
  return target?.dataset?.nodeId ?? null;
}

function annotationIdFromEvent(event) {
  const target = event.target?.closest?.("[data-annotation-id]");
  return target?.dataset?.annotationId ?? null;
}

function routeHandleFromEvent(event) {
  const target = event.target?.closest?.("[data-route-edge-id][data-route-index]");
  if (!target) return null;
  return {
    edgeId: target.dataset.routeEdgeId,
    pointIndex: Number(target.dataset.routeIndex),
  };
}

function routePointFromEvent(event) {
  return currentViewTransform().screenToDiagram(viewBoxPoint(event), { z: 0 });
}

function startRoutePointer(event, handle) {
  if (!state.routeEditor) return false;
  const result = state.routeEditor.pointerDown({
    edgeId: handle.edgeId,
    pointIndex: handle.pointIndex,
    pointerId: event.pointerId,
  });
  if (!result.accepted) return false;
  state.selectedEdgeId = handle.edgeId;
  state.selectedId = null;
  state.activeRoutePointerId = event.pointerId;
  state.dragging = false;
  state.moved = false;
  els.canvas.setPointerCapture?.(event.pointerId);
  setStatus("ready", "路线控制点预览中 · 松手提交一次修改");
  event.preventDefault();
  return true;
}

function startViewPointer(event) {
  const point = viewBoxPoint(event);
  state.viewPointer = {
    pointerId: event.pointerId,
    startPoint: point,
    startPan: state.viewController.getState().pan,
    moved: false,
  };
  els.canvas.setPointerCapture?.(event.pointerId);
  setStatus("ready", "拖动空白区域平移视图");
  event.preventDefault();
}

function handlePointerDown(event) {
  if (!state.artifact || !state.canvasController || event.button !== 0) return;
  const routeHandle = routeHandleFromEvent(event);
  if (routeHandle && startRoutePointer(event, routeHandle)) return;
  if (annotationIdFromEvent(event) || event.target?.closest?.(".workspace-route-hit")) {
    event.preventDefault();
    return;
  }
  const nodeId = nodeIdFromEvent(event);
  if (!nodeId) {
    try { startViewPointer(event); }
    catch (error) { setStatus("error", "视图平移未开始", error instanceof Error ? error : new Error(String(error))); }
    return;
  }
  try {
    const result = state.canvasController.pointerDown({
      nodeId,
      pointerId: event.pointerId,
      diagramPoint: diagramPointFromEvent(event, nodeId),
    });
    if (!result.accepted) return;
    state.selectedId = nodeId;
    state.activePointerId = event.pointerId;
    state.dragging = false;
    state.moved = false;
    els.canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  } catch (error) {
    setStatus("error", "拖动未开始", error instanceof Error ? error : new Error(String(error)));
  }
}

function handlePointerMove(event) {
  if (state.activeRoutePointerId === event.pointerId && state.routeEditor) {
    try {
      const result = state.routeEditor.pointerMove({ diagramPoint: routePointFromEvent(event) });
      if (!result.accepted) return;
      state.previewArtifact = state.routeEditor.getDisplayArtifact();
      state.dragging = true;
      state.moved = true;
      setStatus("ready", "路线控制点预览中 · 松手提交一次修改");
      renderCanvas();
      renderInspector();
      event.preventDefault();
    } catch (error) {
      setStatus("error", "路线预览失败", error instanceof Error ? error : new Error(String(error)));
    }
    return;
  }
  if (state.viewPointer?.pointerId === event.pointerId) {
    try {
      const point = viewBoxPoint(event);
      const start = state.viewPointer.startPoint;
      const startPan = state.viewPointer.startPan;
      state.viewController.setPan({
        x: startPan.x + point.x - start.x,
        y: startPan.y + point.y - start.y,
      });
      state.viewPointer.moved = true;
      setStatus("ready", "视图平移中 · 松手完成");
      renderMeta();
      renderCanvas();
      event.preventDefault();
    } catch (error) {
      setStatus("error", "视图平移失败", error instanceof Error ? error : new Error(String(error)));
    }
    return;
  }
  if (state.activePointerId !== event.pointerId || !state.canvasController) return;
  const active = state.canvasController.getState().active;
  if (!active) return;
  try {
    const result = state.canvasController.pointerMove({ diagramPoint: diagramPointFromEvent(event, active.nodeId) });
    if (!result.accepted) return;
    state.previewArtifact = state.canvasController.getDisplayArtifact();
    state.dragging = true;
    state.moved = true;
    setStatus("ready", "预览中 · 松手提交一次修改");
    renderCanvas();
    renderInspector();
    event.preventDefault();
  } catch (error) {
    setStatus("error", "拖动预览失败", error instanceof Error ? error : new Error(String(error)));
  }
}

function finishViewPointer(event, cancelled = false) {
  if (state.viewPointer?.pointerId !== event.pointerId) return false;
  const viewPointer = state.viewPointer;
  if (cancelled) state.viewController.setPan(viewPointer.startPan);
  state.suppressClick = viewPointer.moved;
  state.viewPointer = null;
  els.canvas.releasePointerCapture?.(event.pointerId);
  setStatus("ready", cancelled ? "已取消视图平移" : viewPointer.moved ? "视图已更新 · Diagram 未修改" : "未移动 · 视图未改变");
  renderMeta();
  renderCanvas();
  event.preventDefault();
  return true;
}

function finishPointer(event, cancelled = false) {
  if (finishViewPointer(event, cancelled)) return;
  if (state.activeRoutePointerId === event.pointerId && state.routeEditor) {
    let result;
    try {
      result = cancelled
        ? state.routeEditor.cancel()
        : state.routeEditor.pointerUp({ diagramPoint: state.moved ? routePointFromEvent(event) : undefined });
      if (result.command) {
        commitArtifactHistory(result.artifact, {
          transactionId: result.command.gestureId,
          kind: result.command.type,
          message: "已提交 1 个路线字段级 Human Override",
        });
      } else {
        state.previewArtifact = null;
        setStatus("ready", cancelled ? "已取消路线预览" : "未移动 · 未提交路线修改");
      }
    } catch (error) {
      state.previewArtifact = null;
      setStatus("error", "路线提交失败", error instanceof Error ? error : new Error(String(error)));
    }
    state.suppressClick = state.moved;
    state.activeRoutePointerId = null;
    state.dragging = false;
    state.moved = false;
    els.canvas.releasePointerCapture?.(event.pointerId);
    render();
    event.preventDefault();
    return;
  }
  if (state.activePointerId !== event.pointerId || !state.canvasController) return;
  const active = state.canvasController.getState().active;
  let result;
  try {
    if (cancelled) result = state.canvasController.cancel();
    else result = state.canvasController.pointerUp({
      diagramPoint: state.moved && active ? diagramPointFromEvent(event, active.nodeId) : undefined,
    });
    if (result.command) {
      commitArtifactHistory(result.artifact, {
        transactionId: result.command.gestureId,
        kind: result.command.type,
        message: "已提交 1 个字段级 Human Override",
      });
    } else {
      state.previewArtifact = null;
      setStatus("ready", cancelled ? "已取消拖动预览" : "未移动 · 未提交修改");
    }
  } catch (error) {
    state.previewArtifact = null;
    setStatus("error", "拖动提交失败", error instanceof Error ? error : new Error(String(error)));
  }
  state.suppressClick = state.moved;
  state.activePointerId = null;
  state.dragging = false;
  state.moved = false;
  els.canvas.releasePointerCapture?.(event.pointerId);
  render();
  event.preventDefault();
}

function handleWheel(event) {
  if (!state.artifact) return;
  try {
    const factor = Math.exp(-event.deltaY * 0.001);
    state.viewController.zoomBy(factor);
    setStatus("ready", "视图缩放中 · Diagram 未修改");
    renderMeta();
    renderCanvas();
    event.preventDefault();
  } catch (error) {
    setStatus("error", "视图缩放失败", error instanceof Error ? error : new Error(String(error)));
  }
}

function handleViewAction(action) {
  if (action === "zoom-out") state.viewController.zoomBy(0.85);
  else if (action === "zoom-in") state.viewController.zoomBy(1.15);
  else if (action === "orbit-left") state.viewController.orbitBy({ azimuthDeg: -10 });
  else if (action === "orbit-right") state.viewController.orbitBy({ azimuthDeg: 10 });
  else if (action === "reset") state.viewController.reset();
  else return;
  setStatus("ready", action === "reset" ? "已重置等轴视图 · Diagram 未修改" : "视图已更新 · Diagram 未修改");
  renderMeta();
  renderCanvas();
}

function handleKeyDown(event) {
  if (event.key !== "Escape") return;
  if (state.viewPointer) {
    finishViewPointer({ pointerId: state.viewPointer.pointerId, preventDefault: () => {} }, true);
    event.preventDefault();
    return;
  }
  if (state.annotationEditor?.getState().active) {
    state.suppressAnnotationCommit = true;
    state.annotationEditor.cancel();
    state.previewArtifact = null;
    setStatus("ready", "已取消标注预览");
    render();
    setTimeout(() => { state.suppressAnnotationCommit = false; }, 0);
    event.preventDefault();
    return;
  }
  if (state.activeRoutePointerId !== null && state.routeEditor) {
    finishPointer({ pointerId: state.activeRoutePointerId, preventDefault: () => {} }, true);
    event.preventDefault();
    return;
  }
  if (state.activePointerId === null || !state.canvasController) return;
  const active = state.canvasController.getState().active;
  if (active) finishPointer({ pointerId: state.activePointerId, preventDefault: () => {} }, true);
  event.preventDefault();
}

els.openButton.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => handleFile(els.fileInput.files?.[0]));
els.fileInput.addEventListener("cancel", () => handleFile(null));
els.loadGoldenButton.addEventListener("click", () => loadUrl(GOLDEN_CASE_URL, "flovvas-massing.diagram.json"));
els.saveButton.addEventListener("click", handleSave);
els.undoButton.addEventListener("click", handleUndo);
els.redoButton.addEventListener("click", handleRedo);
els.exportButton.addEventListener("click", handleExport);
els.componentSearch.addEventListener("input", (event) => { state.query = event.target.value; renderComponents(); });
els.glbImportButton.addEventListener("click", () => els.glbFileInput.click());
els.glbFileInput.addEventListener("change", () => handleGlbFile(els.glbFileInput.files?.[0]));
els.canvas.addEventListener("pointerdown", handlePointerDown);
els.canvas.addEventListener("pointermove", handlePointerMove);
els.canvas.addEventListener("pointerup", (event) => finishPointer(event));
els.canvas.addEventListener("pointercancel", (event) => finishPointer(event, true));
els.canvas.addEventListener("wheel", handleWheel, { passive: false });
for (const [element, action] of [
  [els.viewZoomOutButton, "zoom-out"],
  [els.viewZoomInButton, "zoom-in"],
  [els.viewOrbitLeftButton, "orbit-left"],
  [els.viewOrbitRightButton, "orbit-right"],
  [els.viewResetButton, "reset"],
]) {
  element?.addEventListener("click", () => handleViewAction(action));
}
els.scene.addEventListener("click", () => {
  if (state.suppressClick) { state.suppressClick = false; return; }
  if (state.dragging) return;
  state.selectedId = null;
  state.selectedEdgeId = null;
  state.selectedAnnotationId = null;
  renderCanvas();
  renderComponents();
  renderInspector();
});
window.addEventListener("keydown", handleKeyDown);

window.LoomWorkspace = Object.freeze({
  getState: () => clone({
    status: state.status,
    artifact: state.artifact,
    fileName: state.fileName,
    revision: state.revision,
    selectedId: state.selectedId,
    selectedEdgeId: state.selectedEdgeId,
    selectedAnnotationId: state.selectedAnnotationId,
    query: state.query,
    dirty: state.dirty,
    error: state.error ? { name: state.error.name, message: state.error.message, code: state.error.code ?? null } : null,
    previewArtifact: state.previewArtifact,
    componentError: state.componentError,
    saving: state.saving,
    exporting: state.exporting,
    lastExport: state.lastExport,
  }),
  getCanvasState: () => state.canvasController?.getState() ?? null,
  getRouteState: () => state.routeEditor?.getState() ?? null,
  getAnnotationState: () => state.annotationEditor?.getState() ?? null,
  getHistoryState: () => state.history ? clone(state.history) : null,
  getViewState: () => state.viewController.getState(),
  getCameraState: () => state.viewController.getCamera(),
  getExportCamera: () => state.artifact ? resolveExportCamera(state.artifact) : null,
  setExportCamera: (camera) => commitExportCamera(camera),
  setExportCameraFromView: () => commitExportCamera(state.viewController.getCamera()),
  loadArtifact: (artifact, fileName) => setArtifact(artifact, fileName),
  loadUrl,
  selectNode,
});

loadComponentCatalog();
loadUrl(GOLDEN_CASE_URL, "flovvas-massing.diagram.json");
