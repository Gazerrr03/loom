import { createIsometricTransform, createWorkspaceCanvas } from "./workspace-canvas.mjs";
import {
  evaluateComponentExportGate,
  importUserGlbReference,
  listComponentEntries,
  replaceNodeComponent,
} from "./component-panel.mjs";

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
};

els.canvas.style.touchAction = "none";
els.canvas.style.userSelect = "none";
els.dragHint.textContent = "Click 选择 · Drag 可预览，松手后提交一次修改";

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

function assertArtifact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Diagram 必须是 JSON object");
  if (value.format !== "loom.diagram") throw new Error("Diagram format 不受支持");
  if (typeof value.schemaVersion !== "string" || value.schemaVersion !== "0.1.0") throw new Error("Diagram schemaVersion 不受支持");
  if (typeof value.id !== "string" || value.id.length === 0) throw new Error("Diagram id 缺失");
  if (!value.semantic || !Array.isArray(value.semantic.nodes) || !Array.isArray(value.semantic.edges) || !Array.isArray(value.semantic.groups)) throw new Error("Diagram semantic graph 不完整");
  if (!value.composition || !value.layout?.generated?.nodes || !value.layout?.generated?.routes || !value.layout?.generated?.groups) throw new Error("Diagram composition 或 layout 不完整");
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

function project(point) {
  const z = point.z ?? point.elevation ?? 0;
  return { x: 82 + point.x * 1.42 + point.y * .56, y: 568 + point.y * .66 - point.x * .2 - z * 1.7 };
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

function surfacePoints(rect, z = 0) {
  return [
    project({ x: rect.x, y: rect.y, z }),
    project({ x: rect.x + rect.width, y: rect.y, z }),
    project({ x: rect.x + rect.width, y: rect.y + rect.height, z }),
    project({ x: rect.x, y: rect.y + rect.height, z }),
  ];
}

function extrudedRect(parent, rect, baseZ, height, tones) {
  const base = surfacePoints(rect, baseZ);
  const top = surfacePoints(rect, baseZ + height);
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
  const color = node.visualRole === "alternative" ? "#aaa49a" : node.visualRole === "external-input" ? "#c66a43" : STAGE_COLORS[index % STAGE_COLORS.length];
  const tones = faceTones(color);
  const height = node.visualRole === "main-stage" ? 7 + (layout.elevation ?? 0) * .12 : 3;
  if (node.label === "FIELD") {
    extrudedRect(group, { ...rect, x: rect.x + 2, y: rect.y + 2, width: rect.width - 4, height: rect.height - 4 }, layout.elevation ?? 0, height, tones);
    for (let row = 1; row < 3; row += 1) {
      const a = project({ x: rect.x + 4, y: rect.y + rect.height * row / 3, z: (layout.elevation ?? 0) + height + .2 });
      const b = project({ x: rect.x + rect.width - 4, y: rect.y + rect.height * row / 3, z: (layout.elevation ?? 0) + height + .2 });
      group.append(svg("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: tones.edge, "stroke-width": .55, opacity: .5 }));
    }
  } else if (node.label === "BRANCH") {
    extrudedRect(group, { ...rect, x: rect.x + 4, y: rect.y + rect.height * .35, width: rect.width - 8, height: rect.height * .28 }, layout.elevation ?? 0, height, tones);
    for (let branch = 0; branch < 3; branch += 1) extrudedRect(group, { x: rect.x + rect.width * (.2 + branch * .25), y: rect.y + rect.height * .12, width: 4, height: rect.height * .7 }, (layout.elevation ?? 0) + height, 4 + branch, tones);
  } else if (node.label === "LINE") {
    extrudedRect(group, { ...rect, x: rect.x + 3, y: rect.y + rect.height * .3, width: rect.width - 6, height: rect.height * .4 }, layout.elevation ?? 0, height, tones);
    const count = node.properties?.cardCount ?? 6;
    for (let card = 0; card < Math.min(count, 6); card += 1) extrudedRect(group, { x: rect.x + 6 + card * ((rect.width - 12) / 6), y: rect.y + rect.height * .35, width: (rect.width - 18) / 6, height: rect.height * .3 }, (layout.elevation ?? 0) + height, 2.2 + card % 2, tones);
  } else {
    extrudedRect(group, rect, layout.elevation ?? 0, height, tones);
  }
  const center = project({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, z: (layout.elevation ?? 0) + height + 2 });
  label(group, { x: center.x, y: center.y + 4 }, node.label, node.visualRole === "alternative" ? "#5e5d58" : "#26343b");
  if (state.selectedId === node.id) {
    const outline = surfacePoints(rect, (layout.elevation ?? 0) + height + 1);
    group.append(svg("polyline", { points: [...outline, outline[0]].map((point) => `${point.x},${point.y}`).join(" "), fill: "none", stroke: "#c66a43", "stroke-width": 2, "stroke-dasharray": "5 4" }));
    group.setAttribute("aria-selected", "true");
  } else group.setAttribute("aria-selected", "false");
  group.addEventListener("click", (event) => { event.stopPropagation(); selectNode(node.id); });
  group.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectNode(node.id); } });
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
    const line = svg("polyline", { points: pointString(route.points), fill: "none", stroke: edge.visualRole === "alternative" ? "#aaa49a" : edge.visualRole === "compounding-loop" ? "#7467a8" : edge.visualRole === "external-input" ? "#c66a43" : "#58748b", "stroke-width": edge.visualRole === "main-flow" ? 2 : 1.2, "stroke-dasharray": edge.visualRole === "alternative" ? "5 5" : "", "marker-end": "url(#workspace-arrow)", opacity: .82 });
    els.scene.append(line);
  }
  [...displayArtifact.semantic.nodes].sort((left, right) => (layout.nodes[left.id]?.zIndex ?? 0) - (layout.nodes[right.id]?.zIndex ?? 0)).forEach((node, index) => {
    if (layout.nodes[node.id]) renderNode(els.scene, node, layout.nodes[node.id], index);
  });
  const title = displayArtifact.annotations?.find((annotation) => annotation.visualRole === "title");
  if (title) {
    const anchor = title.anchor?.position ?? { x: 22, y: 24 };
    const projected = project(anchor);
    label(els.scene, { x: projected.x + 22, y: projected.y - 14 }, title.text, "#4d5a5d");
  }
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

function applyComponentArtifact(artifact, message) {
  state.artifact = clone(artifact);
  state.previewArtifact = null;
  state.canvasController = createWorkspaceCanvas({ artifact: state.artifact, revision: state.revision });
  state.dirty = true;
  state.componentError = null;
  setStatus("dirty", message);
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
    applyComponentArtifact(replacement.artifact, entry.kind === "asset" ? "已绑定 GLB 引用 · 导出仍被授权门禁阻止" : `已将 ${state.selectedId} 替换为 ${entry.name}`);
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
    ?? (gate.status === "blocked" ? `GLB 授权未确认：${gate.blockedAssets.map((asset) => asset.assetId).join("、")} · PNG 导出阻止` : null);
  els.libraryNotice.hidden = !notice;
  if (notice) els.libraryNotice.textContent = notice;
}

function renderInspector() {
  if (!state.artifact || !state.selectedId) {
    els.inspector.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "inspector-empty";
    empty.textContent = state.artifact ? "选择一个 Scene Node 后，这里会显示它的语义身份、组件引用和构图状态。" : "打开 Diagram 后，这里会显示选中对象的语义上下文。";
    els.inspector.append(empty);
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
  els.inspector.append(card);
}

function renderMeta() {
  els.title.textContent = state.fileName ?? "未打开 Diagram";
  els.canvasMeta.textContent = state.artifact ? `${state.artifact.semantic.nodes.length} nodes · ${state.artifact.semantic.edges.length} routes · ${state.revision}` : "未加载 RenderDocument";
  // Save and PNG become actionable in the dedicated #111 exit issue.
  els.saveButton.disabled = true;
  els.exportButton.disabled = true;
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
  state.dirty = false;
  state.previewArtifact = null;
  state.canvasController = createWorkspaceCanvas({ artifact: state.artifact, revision: state.revision });
  state.activePointerId = null;
  state.dragging = false;
  state.moved = false;
  state.componentError = null;
  setStatus("ready", "Diagram 已加载");
  render();
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
    state.previewArtifact = null;
    state.canvasController = null;
    state.activePointerId = null;
    state.dragging = false;
    state.moved = false;
    setStatus("error", "读取失败", error instanceof Error ? error : new Error(String(error)));
    render();
  }
}

function selectNode(nodeId) {
  if (!state.artifact || !state.artifact.semantic.nodes.some((node) => node.id === nodeId)) return;
  state.canvasController?.selectNode(nodeId);
  state.selectedId = nodeId;
  renderCanvas();
  renderComponents();
  renderInspector();
}

function handleFile(file) {
  if (!file) return;
  setStatus("loading", "正在解析本地 Diagram");
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try { setArtifact(JSON.parse(String(reader.result)), file.name); }
    catch (error) {
      state.artifact = null;
      state.previewArtifact = null;
      state.canvasController = null;
      state.activePointerId = null;
      state.dragging = false;
      state.moved = false;
      setStatus("error", "文件无效", error instanceof Error ? error : new Error(String(error)));
      render();
    }
  });
  reader.addEventListener("error", () => {
    state.artifact = null;
    state.previewArtifact = null;
    state.canvasController = null;
    state.activePointerId = null;
    state.dragging = false;
    state.moved = false;
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
    applyComponentArtifact(result.artifact, `已导入 ${result.asset.id} · 只保存引用，授权未确认`);
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
  const transform = createIsometricTransform();
  return transform.screenToDiagram(viewBoxPoint(event), { z: layout.elevation ?? 0 });
}

function nodeIdFromEvent(event) {
  const target = event.target?.closest?.("[data-node-id]");
  return target?.dataset?.nodeId ?? null;
}

function handlePointerDown(event) {
  if (!state.artifact || !state.canvasController || event.button !== 0) return;
  const nodeId = nodeIdFromEvent(event);
  if (!nodeId) return;
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

function finishPointer(event, cancelled = false) {
  if (state.activePointerId !== event.pointerId || !state.canvasController) return;
  const active = state.canvasController.getState().active;
  let result;
  try {
    if (cancelled) result = state.canvasController.cancel();
    else result = state.canvasController.pointerUp({
      diagramPoint: state.moved && active ? diagramPointFromEvent(event, active.nodeId) : undefined,
    });
    if (result.command) {
      state.artifact = result.artifact;
      state.dirty = true;
      state.previewArtifact = null;
      setStatus("dirty", "已提交 1 个字段级 Human Override");
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

function handleKeyDown(event) {
  if (event.key !== "Escape" || state.activePointerId === null || !state.canvasController) return;
  const active = state.canvasController.getState().active;
  if (active) finishPointer({ pointerId: state.activePointerId, preventDefault: () => {} }, true);
  event.preventDefault();
}

els.openButton.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => handleFile(els.fileInput.files?.[0]));
els.loadGoldenButton.addEventListener("click", () => loadUrl(GOLDEN_CASE_URL, "flovvas-massing.diagram.json"));
els.componentSearch.addEventListener("input", (event) => { state.query = event.target.value; renderComponents(); });
els.glbImportButton.addEventListener("click", () => els.glbFileInput.click());
els.glbFileInput.addEventListener("change", () => handleGlbFile(els.glbFileInput.files?.[0]));
els.canvas.addEventListener("pointerdown", handlePointerDown);
els.canvas.addEventListener("pointermove", handlePointerMove);
els.canvas.addEventListener("pointerup", (event) => finishPointer(event));
els.canvas.addEventListener("pointercancel", (event) => finishPointer(event, true));
els.scene.addEventListener("click", () => {
  if (state.suppressClick) { state.suppressClick = false; return; }
  if (state.dragging) return;
  state.selectedId = null;
  renderCanvas();
  renderComponents();
  renderInspector();
});
window.addEventListener("keydown", handleKeyDown);

window.LoomWorkspace = Object.freeze({
  getState: () => clone(state),
  getCanvasState: () => state.canvasController?.getState() ?? null,
  loadArtifact: (artifact, fileName) => setArtifact(artifact, fileName),
  loadUrl,
  selectNode,
});

loadComponentCatalog();
loadUrl(GOLDEN_CASE_URL, "flovvas-massing.diagram.json");
