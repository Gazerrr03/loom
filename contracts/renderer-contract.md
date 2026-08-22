# Loom Renderer Contract v0.1

> 状态：MVP 契约草案
> 目标：让 `diagram.json` 不依赖 iCraft、Three.js 或任何单一渲染运行时。

## 1. Renderer 负责什么

Renderer 把已经解析好的 Diagram 表达为可见、可选择、可预览和可导出的场景。

它负责：

- 将 Component Template 实例化为几何与材质。
- 按 Effective Layout 放置 Scene Node。
- 呈现路线、阶段分区、标注和主题 token。
- 提供拾取、交互预览、视图控制和 PNG 捕获。
- 明确声明自己支持的能力。

它不负责：

- 决定 Diagram 的产品语义。
- 把用户手工操作直接写入文件。
- 保存 Renderer 私有场景作为正式资产。
- 静默改变或删除不支持的语义对象。
- 替 Workspace 管理 undo/redo。

### Formal asset boundary

The persisted `diagram.json` contains semantic objects, composition, annotations,
presentation tokens, and source asset references (`id`, `kind`, `uri`, and
`license`). It never contains renderer-private scene graphs, GPU handles, mesh
instances, materials, caches, or other runtime objects. Adapters may construct
those values after loading and must discard them when the render session ends.

## 2. 输入：RenderDocument

Core 将 `diagram.json` 解析成只读的 `RenderDocument` 后交给 Adapter。它至少包含：

```ts
type RenderDocument = {
  artifactId: string
  revision: string
  semantic: {
    nodes: Node[]
    edges: Edge[]
    groups: Group[]
  }
  composition: Composition
  effectiveLayout: {
    nodes: Record<string, NodeLayout>
    routes: Record<string, RouteLayout>
    groups: Record<string, GroupLayout>
    view: View
  }
  annotations: Annotation[]
  presentation: ResolvedPresentation
  components: Record<string, ResolvedComponentTemplate>
  assets: Record<string, ResolvedAsset>
}
```

`effectiveLayout` 由 Core 按字段合并 Generated Layout 与 Human Override。Renderer 不应自行读取两层并猜测优先级。

`RenderDocument` 的顶层字段固定为 `artifactId`、`revision`、`semantic`、`composition`、`effectiveLayout`、`annotations`、`presentation`、`components` 和 `assets`。`components` 与 `assets` 是 Core 已解析的对象 map，分别以 `componentRef` 和资产 ID 为 key；Renderer 不负责查找或拼接它们。

RenderDocument 不携带 `layout.generated`、`layout.overrides` 或任何 Renderer 私有运行时对象。Core 以当前 Artifact 的 revision 创建一份独立的只读投影；Adapter 对投影的修改不得反向改变 `diagram.json`。

Renderer 从 `semantic.nodes` 与 `effectiveLayout.nodes` 产生稳定的 `SceneNode` 描述。每个 SceneNode 至少暴露 `nodeId`、`sourceComponentRef`、`componentRef`、`bounds`、`elevation`、`rotationYDeg`、`scale`、`zIndex` 和已解析参数；它不包含 mesh、材质、相机或其他运行时对象。缺失的 identity-only generic template 只能进入明确标记的 neutral fallback，不能静默生成空节点。

Route、Phase Zone 和 Annotation overlay 与 SceneNode 共享 Diagram coordinate space，并携带同一 RenderDocument 的视图；Renderer 必须对这些层使用同一 pan/zoom/orbit 变换。overlay 默认进入 PNG，编辑手柄、选择框和其他 editor chrome 默认排除。

### Coordinate layers

The Artifact is the source of truth for coordinates. MVP uses four explicit
layers:

| Layer | Meaning | Unit / ownership |
| --- | --- | --- |
| Diagram | Canonical canvas, node, route and annotation positions | `composition.unit`; persisted in `diagram.json` |
| Page | Diagram position relative to one page bounds | Same unit; derived, never persisted as a second truth |
| View | Camera-centred coordinates after zoom/orientation | Renderer input; derived from Diagram + `defaultView`/override |
| Screen | Pointer and pixel coordinates in the browser/export viewport | CSS/device pixels; never written into Artifact |

The canonical Diagram origin is the spread's top-left corner (x increases to
the right, y increases downward); `elevation` remains a separate depth value.
Pointer conversion must round-trip through these layers without changing the
stored unit or writing screen pixels into Human Override.

## 3. 能力协商

每个 Adapter 在加载 Diagram 前返回 `RendererCapabilities`：

```ts
type RendererCapabilities = {
  adapterId: string
  adapterVersion: string
  projections: Array<'orthographic' | 'perspective'>
  componentKinds: Array<'parametric-scene' | 'asset' | 'fallback'>
  interactions: Array<
    | 'pick'
    | 'move-plane'
    | 'rotate-y'
    | 'scale-uniform'
    | 'change-z-index'
    | 'edit-route'
    | 'orbit-view'
  >
  exports: Array<'png'>
  assetFormats: Array<'gltf' | 'glb' | 'image'>
  features: string[]
  maxTextureSize?: number
}
```

Core 在 render 前比较 Diagram 需求与 Adapter 能力：

- 缺失关键能力：拒绝加载并返回结构化错误。
- 可使用明确 fallback：记录降级，再继续加载。
- 不允许“看起来加载成功但悄悄丢掉对象”。

能力比较在 `load` 之前完成，结果分为 `ready`、`fallback` 和 `error`。`fallback` 只能来自调用方显式声明的 capability fallback，并必须产生 warning；未声明的缺口返回 `unsupported-capability`，错误消息包含 `adapterId`，并保留受影响对象 ID 与恢复建议。

## 4. 最小 Adapter 接口

```ts
interface RendererAdapter {
  getCapabilities(): Promise<RendererCapabilities>
  mount(host: HTMLElement): Promise<void>
  load(document: Readonly<RenderDocument>): Promise<RenderReceipt>
  patch(change: RenderPatch): Promise<RenderReceipt>
  setSelection(selection: Selection): Promise<void>
  preview(command: PreviewCommand): Promise<void>
  cancelPreview(): Promise<void>
  hitTest(point: ScreenPoint): Promise<HitResult | null>
  setView(view: View): Promise<void>
  capturePng(options: PngExportOptions): Promise<ExportReceipt>
  dispose(): Promise<void>
}
```

`patch` 是重建整个场景的性能优化，不是另一套数据模型。其输入仍然由新旧 `RenderDocument` 产生。

## 5. 交互提交边界

一次拖动分为两段：

1. Renderer `preview`：只改变当前可见画面，不改变 Artifact。
2. Workspace 提交 Domain Command：Core 将字段级修改写入 Human Override，再向 Renderer 发送正式 patch。

示例：

```ts
type MoveNodeCommand = {
  type: 'layout.node.move'
  nodeId: string
  x: number
  y: number
}
```

一次完整手势只产生一个可撤销命令。Renderer 产生的逐帧坐标不能逐条写进 undo 历史。

`contracts/interaction-commit.mjs` 固化了这条边界：`beginPreview` 创建只读会话，`updatePreview` 只返回新的内存帧，`cancelPreview` 丢弃帧；只有 `commitPreview` 在 pointer-up 时产生一个带 `gestureId` 与 `baseRevision` 的 Domain Command。Core 通过 `applyDomainCommand` 将命令映射为一次字段级 Human Override 更新，保留该对象已有的其他 Override 字段。

MVP 支持的最小命令集合为 `layout.node.move`、`layout.node.rotate-y`、`layout.node.scale`、`layout.node.z-index`、`layout.route.replace-points` 和 `layout.view.change`。命令包含 `targetId` 与最终值，不包含屏幕坐标、Renderer 私有对象或逐帧历史；提交后的新 Artifact 才能重新生成 RenderDocument。

## 6. Scene Node 与 Component Template

Renderer 接收的是：

- 节点语义；
- `componentRef`；
- 已校验的参数；
- 有效布局；
- 主题 token。

Component Template Manifest 只描述语义、参数与 Renderer Mapping；具体几何配方由相应 Adapter 实现。Codex 无需理解 mesh、shader 或场景图内部结构。

找不到 mapping 时按顺序处理：

1. 使用 Template 声明的 fallback。
2. 使用产品级 `generic-card-slab` fallback。
3. 如果语义会被误导，则拒绝渲染该 Diagram 并给出错误，而不是画一个无提示的空盒子。

Mapping 解析结果必须保留原节点的 semantic type 与 label；切换 Adapter 只改变
`implementationRef` 或 fallback 结果，不改变 `node.type`、`node.id` 或
`componentRef` 的语义身份。

## 7. 路线与标注层

MVP 允许路线与标注使用 2.5D overlay，而不是强制成为真实三维模型。

约束：

- 它们必须跟随 Scene Node 和视图变化。
- PNG 导出必须包含完整 overlay。
- route point 使用 Artifact composition 坐标，而不是屏幕像素。
- route control point 以语义 edge 的 Diagram-space 点集保存；编辑一个点只替换该 route 的点集，不把当前 viewport 或屏幕像素写进 Artifact。
- node/group annotation 以目标 bounds 的中心加持久化 Diagram-space offset 定位；edge annotation 以 route 的弧长中点加 offset 定位；节点或路线变化后重新解析 anchor，不保存一次性的屏幕坐标。
- canvas annotation 直接保存 Diagram-space position。所有 anchor 在导出前都从 Effective Layout 重新解析，因此平移、缩放或换 Adapter 不会让标注悬空。
- 标注碰撞可以由 Renderer 提示，但自动修正必须回到 Layout 层提交。

这项取舍优先保证分析图可读性，也使未来 Renderer 更容易替换。

## 8. PNG 导出

`capturePng` 至少接收：

```ts
type PngExportOptions = {
  widthPx: number
  heightPx: number
  pixelRatio: number
  transparentBackground: boolean
  includeSafeAreaGuides: boolean
}
```

导出必须：

- 使用 Diagram 当前 Effective Layout 与视图。
- 包含 3D 场景、路线、阶段分区和标注。
- 默认隐藏选择框、变换手柄、safe area 辅助线和调试 UI。
- 返回实际尺寸、revision 与警告，便于证明导出对应哪次保存。

## 9. 错误协议

```ts
type RendererError = {
  code:
    | 'invalid-envelope'
    | 'unsupported-version'
    | 'duplicate-id'
    | 'dangling-reference'
    | 'unsupported-capability'
    | 'unsupported-template'
    | 'missing-asset'
    | 'invalid-tool-input'
    | 'revision-conflict'
    | 'invalid-layout'
    | 'render-failed'
    | 'export-failed'
  message: string
  objectIds: string[]
  fieldPath: string | null
  recoverable: boolean
  suggestedAction: string | null
  suggestedFallback?: string
  cause?: string | null
}
```

所有 Core、Tool 和 Renderer 错误使用相同的 `code`、`objectIds`、`fieldPath`、`recoverable` 和 `suggestedAction` 字段。对用户显示短句；诊断详情可以保留对象 ID、Adapter、revision 和经过清理的 cause。`message`、`fieldPath`、`suggestedAction` 和 `cause` 不得泄露凭证、无关本地路径或第三方授权信息，也不得把任何错误写进 Artifact。

## 10. MCP Tool Envelope

Codex 通过 MCP 调用的是 Diagram 意图，不是 Renderer 私有 API。所有 Tool 共用
`contracts/mcp-tools.schema.json` 的 v0.1 envelope：

```json
{
  "format": "loom.mcp.tool-call",
  "schemaVersion": "0.1.0",
  "toolName": "diagram.save",
  "requestId": "req-001",
  "input": {},
  "expectedRevision": "sha256:before",
  "dryRun": false
}
```

Tool result 必须返回相同的 `toolName` / `requestId`、`status`、可选的结果对象、
当前 `revision`、共享 `RendererError` 结构和副作用声明：

```json
{
  "format": "loom.mcp.tool-result",
  "schemaVersion": "0.1.0",
  "toolName": "diagram.save",
  "requestId": "req-001",
  "status": "ok",
  "result": {},
  "error": null,
  "revision": "sha256:after",
  "effects": {
    "kind": "write",
    "paths": ["diagrams/example.diagram.json"],
    "changed": true,
    "reversible": true
  }
}
```

`effects.paths` 只允许安全的相对逻辑路径；Tool result 不得携带 mesh、scene、
GPU、camera、material 或其他 Renderer runtime 对象。`dryRun` 可以返回预计的
write effect，但不得谎报已经发生了文件变更。

## 11. iCraft Adapter 的进入条件

iCraft 只有同时满足以下条件才进入 MVP 交付路径：

- 有受支持、可重复的程序化场景创建或更新能力。
- 可实现拾取、变换预览和 PNG 导出所需能力，或能与 Workspace 安全组合。
- 产品用途、分发方式和资产使用获得明确授权。
- 同一份 `RenderDocument` 不需要塞入 iCraft 私有状态才能重新打开。

在条件被证实前，参考 Renderer 是默认主路径，iCraft 是并行 spike。

### M4-07 证据记录（2026-08-22）

官方材料核对结果如下：

| 边界 | 公开材料能证明什么 | 结论 |
|---|---|---|
| create | Mermaid 可在 iCraft Editor 内转换为 3D 场景；Player API 没有公开 create scene / create element / create edge 方法 | `no-go`：不能从 Loom Diagram 自动生成 `.iplayer` |
| update | Player 可读元素、控制视图/动画、设置可见/禁用态；没有公开通用几何、参数或保存更新 API | `no-go`：不能把 iCraft 当作 Core 的写入入口 |
| reopen | Player 构造参数接收 `.iplayer`，并提供 `openFileByUrl` | `partial`：能打开既有场景，但不补齐 create/update |
| export | Player API 提供 `exportImage()` | `partial`：已有场景可以尝试导出，尺寸/背景/跨页语义仍需实际验证 |
| authorization | 官方 LICENSE 是专有 Commercial License，限制修改、衍生、逆向、再分发和竞争产品使用；公开页面对个人/商业方案仍需供应方确认 | `unknown → no-go for public distribution` |

官方来源：

- Mermaid 3D：https://icraft.gantcloud.com/blog/mermaid
- Player API：https://icraft.gantcloud.com/player-javascript/api
- Player 介绍：https://icraft.gantcloud.com/player-javascript/intro
- Player React README：https://github.com/gantFDT/icraft/blob/main/player-react.README.zh-CN.md
- LICENSE：https://github.com/gantFDT/icraft/blob/main/LICENSE
- 定价与企业集成：https://icraft.gantcloud.com/pricing

因此，MVP 当前的 Renderer 决策是：Reference Renderer 保持默认主路径；iCraft 只保留为受控的展示/导出候选，不能阻塞 Core、Workspace 或正式 JSON 资产。只有在获得书面授权并出现可重复的 create/update/save 证据后，Adapter 才能从 `partial/no-go` 重新评估为 `go`。

## 12. 契约验收

- 用 Golden Case fixture 加载并导出完整跨页 PNG。
- 替换 Adapter 时无需迁移 `diagram.json`。
- 缺失 Template 或资产时出现明确 fallback 或结构化失败。
- 拖动预览不会改变 Artifact；提交后只产生字段级 override。
- 相同 revision 的重复导出具有相同尺寸、视图和场景结构。
