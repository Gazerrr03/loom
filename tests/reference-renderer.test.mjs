import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Reference Renderer is a self-contained Golden Case visual slice", async () => {
  const html = await readFile(join(repoRoot, "diagrams/flovvas-reference-renderer.html"), "utf8");
  assert.match(html, /fetch\("\.\.\/examples\/flovvas-massing\.diagram\.json"/);
  assert.match(html, /FALLBACK_GOLDEN_CASE/);
  assert.match(html, /id="reference-scene"/);
  assert.match(html, /下载 SVG 评审稿/);
  assert.match(html, /A4 GUTTER/);
  for (const label of ["LINE", "BRANCH", "CARD", "FIELD", "ARCHIVE", "CONTEXT", "WORKBENCH"]) {
    assert.match(html, new RegExp(`\\"${label}\\"`));
  }
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, "renderer script must be present");
  assert.doesNotThrow(() => new Function(script), "renderer script must parse without a bundler");
});

test("module map links the author-facing visual slice", async () => {
  const html = await readFile(join(repoRoot, "diagrams/loom-mvp-module-map.html"), "utf8");
  assert.match(html, /href="flovvas-reference-renderer\.html"/);
});

test("Golden Case routes use square-grid edges and the renderer exposes that grid", async () => {
  const diagram = JSON.parse(await readFile(join(repoRoot, "examples/flovvas-massing.diagram.json"), "utf8"));
  for (const [edgeId, route] of Object.entries(diagram.layout.generated.routes)) {
    assert.ok(route.points.length >= 2, `${edgeId} must have at least two route points`);
    for (let index = 1; index < route.points.length; index += 1) {
      const previous = route.points[index - 1];
      const current = route.points[index];
      assert.ok(previous.x === current.x || previous.y === current.y, `${edgeId} segment ${index} must follow one grid axis`);
    }
  }
  const html = await readFile(join(repoRoot, "diagrams/flovvas-reference-renderer.html"), "utf8");
  assert.match(html, /const GRID_STEP = 20/);
  assert.match(html, /class="plan-grid"/);
  assert.match(html, /stroke-linejoin="miter"/);
});
