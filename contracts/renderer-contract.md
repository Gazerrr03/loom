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
  maxTextureSize?: number
}
```

Core 在 render 前比较 Diagram 需求与 Adapter 能力：

- 缺失关键能力：拒绝加载并返回结构化错误。
- 可使用明确 fallback：记录降级，再继续加载。
- 不允许“看起来加载成功但悄悄丢掉对象”。

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

## 7. 路线与标注层

MVP 允许路线与标注使用 2.5D overlay，而不是强制成为真实三维模型。

约束：

- 它们必须跟随 Scene Node 和视图变化。
- PNG 导出必须包含完整 overlay。
- route point 使用 Artifact composition 坐标，而不是屏幕像素。
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

## 10. iCraft Adapter 的进入条件

iCraft 只有同时满足以下条件才进入 MVP 交付路径：

- 有受支持、可重复的程序化场景创建或更新能力。
- 可实现拾取、变换预览和 PNG 导出所需能力，或能与 Workspace 安全组合。
- 产品用途、分发方式和资产使用获得明确授权。
- 同一份 `RenderDocument` 不需要塞入 iCraft 私有状态才能重新打开。

在条件被证实前，参考 Renderer 是默认主路径，iCraft 是并行 spike。

## 11. 契约验收

- 用 Golden Case fixture 加载并导出完整跨页 PNG。
- 替换 Adapter 时无需迁移 `diagram.json`。
- 缺失 Template 或资产时出现明确 fallback 或结构化失败。
- 拖动预览不会改变 Artifact；提交后只产生字段级 override。
- 相同 revision 的重复导出具有相同尺寸、视图和场景结构。
