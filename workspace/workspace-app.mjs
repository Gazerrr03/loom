const NS = "http://www.w3.org/2000/svg";
const GOLDEN_CASE_URL = "../examples/flovvas-massing.diagram.json";
const STAGE_COLORS = ["#6687a4", "#7a9b91", "#ad8c69", "#8b7baa", "#b27668", "#738e87", "#c17a4e"];
const els = {
  app: document.getElementById("loom-workspace"),
  title: document.getElementById("file-title"),
  status: document.getElementById("workspace-status"),
  canvasMeta: document.getElementById("canvas-meta"),
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
};

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
  const layout = effectiveLayout(state.artifact);
  const canvas = svg("rect", { x: 0, y: 0, width: 1100, height: 700, fill: "#faf8f2" });
  const grid = svg("rect", { x: 0, y: 0, width: 1100, height: 700, fill: "url(#workspace-grid)", opacity: .72 });
  const gutter = svg("rect", { x: 510, y: 0, width: 22, height: 700, fill: "#d8c2ac", opacity: .13 });
  els.scene.append(canvas, grid, gutter);
  for (const group of state.artifact.semantic.groups) {
    const bounds = layout.groups[group.id]?.bounds;
    if (!bounds) continue;
    const points = surfacePoints(bounds, 0).map((point) => `${point.x},${point.y}`).join(" ");
    const zone = svg("polygon", { points, fill: "none", stroke: "#bdb6aa", "stroke-width": 1, "stroke-dasharray": "5 5", opacity: .72 });
    els.scene.append(zone);
  }
  for (const edge of state.artifact.semantic.edges) {
    const route = layout.routes[edge.id];
    if (!route?.points) continue;
    const line = svg("polyline", { points: pointString(route.points), fill: "none", stroke: edge.visualRole === "alternative" ? "#aaa49a" : edge.visualRole === "compounding-loop" ? "#7467a8" : edge.visualRole === "external-input" ? "#c66a43" : "#58748b", "stroke-width": edge.visualRole === "main-flow" ? 2 : 1.2, "stroke-dasharray": edge.visualRole === "alternative" ? "5 5" : "", "marker-end": "url(#workspace-arrow)", opacity: .82 });
    els.scene.append(line);
  }
  [...state.artifact.semantic.nodes].sort((left, right) => (layout.nodes[left.id]?.zIndex ?? 0) - (layout.nodes[right.id]?.zIndex ?? 0)).forEach((node, index) => {
    if (layout.nodes[node.id]) renderNode(els.scene, node, layout.nodes[node.id], index);
  });
  const title = state.artifact.annotations?.find((annotation) => annotation.visualRole === "title");
  if (title) {
    const anchor = title.anchor?.position ?? { x: 22, y: 24 };
    const projected = project(anchor);
    label(els.scene, { x: projected.x + 22, y: projected.y - 14 }, title.text, "#4d5a5d");
  }
}

function renderComponents() {
  if (!state.artifact) {
    els.componentList.replaceChildren();
    els.componentCount.textContent = "等待加载";
    return;
  }
  const query = state.query.trim().toLowerCase();
  const components = [];
  const seen = new Set();
  for (const node of state.artifact.semantic.nodes) {
    const key = node.componentRef ?? node.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const haystack = `${node.label} ${node.componentRef} ${node.phase ?? ""}`.toLowerCase();
    if (query && !haystack.includes(query)) continue;
    components.push({ key, node });
  }
  els.componentCount.textContent = `${components.length} 个可见引用`;
  els.componentList.replaceChildren();
  for (const { key, node } of components) {
    const button = document.createElement("button");
    button.className = "component";
    button.type = "button";
    button.setAttribute("aria-current", state.selectedId === node.id ? "true" : "false");
    const swatch = document.createElement("span");
    swatch.className = "component-swatch";
    const copy = document.createElement("span");
    const name = document.createElement("span");
    name.className = "component-name";
    name.textContent = node.label;
    const meta = document.createElement("span");
    meta.className = "component-meta";
    meta.textContent = `${key} · ${node.phase ?? "unphased"}`;
    copy.append(name, meta);
    button.append(swatch, copy);
    button.addEventListener("click", () => selectNode(node.id));
    els.componentList.append(button);
  }
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
  const node = state.artifact.semantic.nodes.find((candidate) => candidate.id === state.selectedId);
  if (!node) { state.selectedId = null; renderInspector(); return; }
  const layout = effectiveLayout(state.artifact).nodes[node.id] ?? {};
  els.inspector.replaceChildren();
  const card = document.createElement("div");
  card.className = "inspector-card";
  const eyebrow = document.createElement("p"); eyebrow.className = "inspector-label"; eyebrow.textContent = node.type ?? "scene node";
  const title = document.createElement("h3"); title.className = "inspector-title"; title.textContent = node.label;
  card.append(eyebrow, title);
  const fields = [["Stable ID", node.id], ["Component", node.componentRef], ["Phase", node.phase ?? "—"], ["Position", `${layout.x ?? "—"}, ${layout.y ?? "—"} · elevation ${layout.elevation ?? 0}`], ["Status", state.dirty ? "draft / dirty" : "ready / canonical"]];
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
  els.saveButton.disabled = !state.artifact || !state.dirty;
  els.exportButton.disabled = !state.artifact;
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
    setStatus("error", "读取失败", error instanceof Error ? error : new Error(String(error)));
    render();
  }
}

function selectNode(nodeId) {
  if (!state.artifact || !state.artifact.semantic.nodes.some((node) => node.id === nodeId)) return;
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
    catch (error) { state.artifact = null; setStatus("error", "文件无效", error instanceof Error ? error : new Error(String(error))); render(); }
  });
  reader.addEventListener("error", () => { state.artifact = null; setStatus("error", "文件读取失败", new Error("无法读取本地文件")); render(); });
  reader.readAsText(file);
}

els.openButton.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => handleFile(els.fileInput.files?.[0]));
els.loadGoldenButton.addEventListener("click", () => loadUrl(GOLDEN_CASE_URL, "flovvas-massing.diagram.json"));
els.componentSearch.addEventListener("input", (event) => { state.query = event.target.value; renderComponents(); });
els.scene.addEventListener("click", () => { state.selectedId = null; renderCanvas(); renderComponents(); renderInspector(); });

window.LoomWorkspace = Object.freeze({
  getState: () => clone(state),
  loadArtifact: (artifact, fileName) => setArtifact(artifact, fileName),
  loadUrl,
  selectNode,
});

loadUrl(GOLDEN_CASE_URL, "flovvas-massing.diagram.json");
