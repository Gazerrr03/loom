import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const indexHtml = await readFile(resolve(root, "workspace/index.html"), "utf8");
const appModule = await readFile(resolve(root, "workspace/workspace-app.mjs"), "utf8");
const transformModule = await readFile(resolve(root, "workspace/transform-inspector.mjs"), "utf8");
const viewModule = await readFile(resolve(root, "workspace/workspace-view.mjs"), "utf8");
const routeModule = await readFile(resolve(root, "workspace/route-editor.mjs"), "utf8");
const annotationModule = await readFile(resolve(root, "workspace/annotation-editor.mjs"), "utf8");

test("Workspace 壳层声明三个可见协作表面", () => {
  assert.match(indexHtml, /id="component-list"/);
  assert.match(indexHtml, /id="workspace-canvas"/);
  assert.match(indexHtml, /id="inspector-body"/);
  assert.match(indexHtml, /id="workspace-status"/);
  assert.match(indexHtml, /<script type="module" src="\.\/workspace-app\.mjs"><\/script>/);
});

test("Workspace 壳层提供 Diagram 打开与 Golden Case 载入入口", () => {
  assert.match(indexHtml, /id="open-button"/);
  assert.match(indexHtml, /id="load-golden-button"/);
  assert.match(indexHtml, /id="file-input"/);
  assert.match(indexHtml, /accept="\.json,\.diagram\.json,application\/json"/);
  assert.match(appModule, /loadUrl\(GOLDEN_CASE_URL/);
  assert.match(appModule, /handleFile\(file\)/);
});

test("Workspace 只在本地内存中展示 canonical Diagram，并暴露可测试入口", () => {
  assert.match(appModule, /format !== "loom\.diagram"/);
  assert.match(appModule, /schemaVersion !== "0\.1\.0"/);
  assert.match(appModule, /window\.LoomWorkspace/);
  assert.match(appModule, /loadArtifact: \(artifact, fileName\) => setArtifact/);
  assert.doesNotMatch(appModule, /from\s+["']node:/);
  assert.doesNotMatch(appModule, /innerHTML\s*=/);
});

test("Workspace Inspector exposes the four node transform controls through a browser-safe bridge", () => {
  for (const operation of ["rotateY", "scale", "elevation", "zIndex"]) {
    assert.match(appModule, new RegExp(`\\"${operation}\\"`));
  }
  assert.match(appModule, /previewInspectorTransform/);
  assert.match(appModule, /commitInspectorTransform/);
  assert.match(transformModule, /applyDomainCommand/);
  assert.doesNotMatch(transformModule, /from\s+["']node:/);
});

test("Workspace Canvas exposes view-only navigation without coupling it to Artifact edits", () => {
  for (const control of ["view-zoom-out", "view-zoom-in", "view-orbit-left", "view-orbit-right", "view-reset"]) {
    assert.match(indexHtml, new RegExp(`id="${control}"`));
  }
  assert.match(appModule, /handleWheel/);
  assert.match(appModule, /startViewPointer/);
  assert.match(appModule, /getViewState/);
  assert.match(viewModule, /createWorkspaceView/);
  assert.match(viewModule, /viewBasis/);
  assert.doesNotMatch(viewModule, /from\s+["']node:/);
});

test("Workspace Canvas exposes route selection and one-shot control-point commit", () => {
  assert.match(appModule, /data-route-edge-id/);
  assert.match(appModule, /routeHandleFromEvent/);
  assert.match(appModule, /getRouteState/);
  assert.match(appModule, /createRouteEditor/);
  assert.match(indexHtml, /workspace-route-handle/);
  assert.match(routeModule, /createRouteEditor/);
  assert.match(routeModule, /applyDomainCommand/);
  assert.doesNotMatch(routeModule, /from\s+["']node:/);
});

test("Workspace Canvas exposes annotation selection and Inspector update boundary", () => {
  assert.match(appModule, /data-annotation-id/);
  assert.match(appModule, /selectAnnotation/);
  assert.match(appModule, /getAnnotationState/);
  assert.match(appModule, /annotation\.update/);
  assert.match(appModule, /标注文本/);
  assert.match(annotationModule, /createAnnotationEditor/);
  assert.match(annotationModule, /resolveAnnotationAnchor/);
  assert.match(annotationModule, /assertPresentationBoundary/);
  assert.doesNotMatch(annotationModule, /from\s+["']node:/);
});
