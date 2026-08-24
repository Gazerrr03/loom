# AI Native 3D Diagram Workspace MVP 实施计划文档

> 版本：v0.2
> 状态：已对齐产品决策，等待进入工程实施
> 更新日期：2026-08-21

## 1. 这次 MVP 要证明什么

MVP 不是一个通用 3D 建模器，也不是把传统流程图简单地立体化。

它要证明一条对设计作品集有价值的真实闭环：

> 用户向 Codex 描述一张逻辑分析图；Codex 创建可理解、可修改的 `diagram.json`；Workspace UI 把它渲染为具有空间层级与视觉隐喻的等轴 3D 构图；用户可直接拖动、修正、标注并导出作品集可用的 PNG。

首个 Golden Case 是 Flovvas Massing Flowchart：同一个 `card-slab` 视觉原语，从线性对话依次演化为 Branch、Card、Field、Archive、Context、Workbench，最终形成一张双 A4 横向跨页分析图。

## 2. 已冻结的产品边界

### 2.1 用户与任务

- 首位用户：产品作者本人。
- 使用场景：设计作品集中的逻辑、流程和系统演化分析图。
- 核心价值：让节点不仅是矩形卡片，还能用 3D 形态、空间位置、层级和构造关系承载语义。
- 成功结果：产出一张可进入作品集排版流程的图，而不是只产出一个技术演示场景。

### 2.2 两个协作表面

```text
Codex
负责自然语言创建、理解和语义修改

        ↓

diagram.json
唯一正式资产与两个表面的协作协议

        ↓

Workspace UI
负责模型选择、构图、拖动、标注和 PNG 导出
```

### 2.3 实现边界

- iCraft 是首选但可替换的 Renderer 路径，不是产品数据格式，也不在关键路径上形成单点依赖。
- `diagram.json` 是 MVP 唯一正式、可持续编辑的资产。
- PNG 是派生输出，不是可继续编辑的源文件。
- MVP 必须保存 Human Override，使自动布局不会覆盖用户手工构图。
- 首版不做多人协作、云同步、组件市场、AI 生成 3D 模型、复杂网格建模或移动端编辑。

## 3. Golden Journey

MVP 的端到端验收脚本固定为：

1. 用户要求 Codex 创建 Flovvas 产品语义演化图。
2. Codex 查询可用 Component Template，并创建语义节点、关系、阶段分区与标注。
3. 布局系统生成双 A4 横向跨页构图草稿。
4. Renderer 显示七个主阶段、三条替代路径、五个外部输入与一个复利回路。
5. 用户在 Workspace UI 中拖动节点、调整绕 Y 轴旋转与等比缩放、调整层级和路线控制点。
6. 用户修改一条标注，并执行撤销、重做。
7. 用户保存；关闭并重新打开后，手工修正保持不变。
8. 用户要求 Codex 将某个阶段的语义或关系改写；修改不破坏无关的 Human Override。
9. 用户导出一张完整跨页 PNG。

任何只完成“自动生成”但不能完成第 5–9 步的版本，都不算 MVP 闭环。

## 4. 实施策略：先做视觉纵切，再扩展系统

最大的不确定性不是文件读写或按钮，而是：

> 有限的参数化 3D 原语，是否足以稳定表达 Golden Case 的七种产品语义，并达到作品集需要的视觉质感。

因此先做一条贯穿数据、渲染、构图和导出的视觉纵切。只有纵切通过，才继续补齐完整 Workspace 与 Codex/MCP 表面。

## 5. Gate 计划

### Gate 0：冻结协作协议

目标：让 Core、Renderer、Workspace 和 Codex 可以并行工作时仍然在编辑同一种东西。

交付物：

- `contracts/diagram.schema.json`
- `contracts/component-template.schema.json`
- `contracts/renderer-contract.md`
- `examples/flovvas-massing.diagram.json`

验收：

- 示例文件通过 JSON Schema 校验。
- 所有 Node、Edge、Group、Annotation 引用均可解析。
- 生成布局与 Human Override 分层保存。
- 文件中不存在某个 Renderer 私有的 mesh、camera runtime 或材质实例状态。
- 同一份 Artifact 可以由不同 Renderer Adapter 消费。

停止条件：如果 Golden Case 无法用当前语义模型描述，不进入渲染开发，先修改契约。

Gate 0 的 Golden Case 证据记录使用
`examples/flovvas-massing.acceptance.json`。记录必须关联同一个 Artifact
revision，并分别保存 `structure`、`layout`、`render`、`export` 四类证据，
以及 `authorConclusion`（`accept`、`continue-refinement` 或
`change-strategy`）。视觉判断用于记录方向，不设置像素级相似度或自动
视觉回归阻塞。

### Gate 1：视觉纵切与 Renderer 决策

目标：用真实 Golden Case 证明 3D 表达成立，并决定首个可交付 Renderer。

工作范围：

- 实现 `card-slab` 基础原语。
- 组合七个参数化 Scene Template：LINE、BRANCH、CARD、FIELD、ARCHIVE、CONTEXT、WORKBENCH。
- 支持正交等轴视图、基础光照、阴影、颜色 token、路线和标注。
- 生成双 A4 横向跨页草稿，保护 10–14 mm gutter safe zone。
- 导出可重复的完整跨页 PNG。
- 并行验证 iCraft 的程序化能力与授权边界。

视觉验收：

- 七个主阶段不看文字也能感知形态演化。
- 主叙事从左下向右上推进，阅读顺序明确。
- 同一 `card-slab` 原语在所有阶段保持家族相似性。
- 三条替代路径、五个外部输入和复利回路与主叙事有明确层级差异。
- 跨页中缝不切断关键标题、主节点或关键标注。
- PNG 可直接进入作品集排版试用，不依赖运行环境查看。

Renderer 决策：

- 如果 iCraft 有受支持的场景创建/编辑接口，并且产品用途获授权，可实现 iCraft Adapter。
- 如果任一条件不满足，参考 Renderer 成为 MVP 主路径；iCraft 保留为人工建模参考或后续 Adapter。
- Renderer 选择不能改变 `diagram.json`。

停止条件：若两轮定向视觉修正后仍无法区分七种语义状态，暂停编辑器扩建，重新判断参数化原语策略。

### Gate 2：Diagram Core 与组件解析

目标：让 Artifact 成为可信赖的单一事实源。

工作范围：

- 创建、校验、加载和原子保存 `diagram.json`。
- 文件生命周期采用 load → validate → serialize → 同目录临时文件写入并同步 → rename；写入失败不替换上一份合法文件。
- 保存返回由序列化字节计算的 `sha256` revision 与 `updatedAt`；load-save-reload 必须保留 semantic、composition、layout、annotations、presentation 和 asset 引用。
- 按对象 ID 提供稳定的增删改操作。
- 将 Generated Layout 与 Human Override 合并为 Effective Layout。
- Generated Layout 由稳定的 engine/version/seed 标识；给定同一 semantic graph、构图约束和 seed，输出完整的 nodes/routes/groups。冲突只返回约束报告，不覆盖 Human Override。
- Generated Layout 与 Human Override 采用字段级合并：覆盖 `x` 不冻结 `y`、`scale` 或其他未覆盖字段；参数对象按 key 合并，路线点集作为一个字段替换。
- Human Override 支持清除单字段、单对象或整层；清除操作不修改原始 artifact，便于 Workspace 生成一次可撤销命令。
- 查询 Component Definition，并解析 Renderer Mapping。
- 支持内置参数化组件、小型可再分发模型、用户 GLB/GLTF 与几何 fallback。
- 对缺失组件、缺失资产和不支持能力返回结构化错误。

验收：

- 保存失败不会破坏原文件。
- 未被用户手工修改的对象可继续接受重新布局。
- 被用户修改的字段只覆盖相应字段，不冻结整个场景。
- 资产缺失时图仍可通过 fallback 打开，且给出可定位提示。

### Gate 3：Workspace UI 编辑闭环

目标：用户能在一个可见界面中把自动草稿修成自己的构图。

P0 操作：

- 画布平移、缩放、轨道查看与一键重置等轴视图。
- Scene Node 平面移动、垂直轴旋转、等比缩放、前后层级调整。
- 路线控制点编辑。
- 自由标注和对象关联标注编辑。
- Component Template 搜索与替换。
- 撤销、重做、保存、重新打开与 PNG 导出。

交互原则：

- 操作感觉参考 iCraft，但不复制其内部数据模型。
- 拖动过程中只做预览；操作提交后写入 Human Override。
- 自动布局更新只影响没有被手动覆盖的字段。
- 任何破坏性替换都必须可撤销。

验收：

- 用户无需编辑 JSON 即可完成 Golden Journey 第 5–7 步。
- 关闭再打开后，节点、路线、标注与视图修正保持一致。
- 连续拖动不会不断膨胀历史记录；一次手势对应一次可撤销命令。

### Gate 4：Codex / MCP 语义协作闭环

目标：Codex 能修改“图在表达什么”，而不仅是操作低层坐标。

P0 能力：

- 创建、打开、读取摘要、校验和保存 Diagram。
- 查询 Component Template 与能力。
- 创建/修改/删除 Node、Edge、Group 和 Annotation。
- 请求重新布局，并声明要保留的 Human Override。
- 查询当前选择、结构、未解析组件与校验错误。
- 对批量修改提供 dry-run 摘要，再提交一个可撤销事务。

语义边界：

- Codex 默认操作语义与构图意图，例如“让 Branch 更像分岔探索”。
- Renderer 决定具体几何实现。
- 只有用户明确要求精确位置时，Codex 才直接修改 override 坐标。

验收：

- Codex 可从零创建 Golden Case Artifact。
- Codex 可修改一个阶段或关系，不改变无关节点的手工位置。
- 工具调用失败时返回对象 ID、失败原因和可恢复建议。
- Workspace 重新加载后可看到 Codex 修改，并可撤销或继续编辑。

### Gate 5：干净环境端到端验收

目标：排除“只在开发者电脑当前状态能跑”的假成功。

M8-01 的本地运行入口固定为仓库根目录的 `node scripts/loom-healthcheck.mjs`、`node --test` 和 `python3 -m http.server 18768`。健康检查只验证仓库内可重复的 Core、Renderer-independent RenderDocument 与 MCP lifecycle 边界；它不会把外部 Codex 登录或 iCraft 授权当作本地成功证据。

M8-04 的关闭清单位于 `issues/modules/00-mvp-parent.md`。当前仓库已经有可复核的 Gate 0–3 合同、Workspace 保存/PNG smoke 和 Gate 5 本地 healthcheck；真实 Codex 创建、三次往返、iCraft 授权 fixture 与作者 PNG 接受仍是明确的外部验收闸门。缺任一项时，M8 Parent 不得关闭。

验收：

- 从干净安装启动 Core、Workspace 和 MCP。
- 从模板创建新 Diagram，完成 Golden Journey。
- Schema 校验、单元测试、集成测试和构建通过。
- Golden Case 参考 PNG 与结构快照通过有意图的差异审查。
- 文档清楚说明资产授权、已知限制和 Renderer 选择。

## 6. 依赖关系

```text
Gate 0 Contracts
  ├── Gate 1 Visual Slice ── Renderer choice
  ├── Gate 2 Diagram Core
  │     └── Gate 3 Workspace UI
  └── Gate 4 MCP contracts

Gate 1 + Gate 2 + Gate 3 + Gate 4
  └── Gate 5 End-to-End Acceptance
```

Gate 1 与 Gate 2 可以在 Gate 0 后并行；Gate 4 可以先实现文件与查询能力，但其最终验收依赖 Workspace 能消费同一份 Artifact。

## 7. 原子 Issue 拆分原则

每个 Issue 必须满足：

- 只解决一个可验证的问题。
- 可由一个 Agent 在一次连续工作中理解和交付。
- 写清用户可见结果与验收，不预先锁死内部实现。
- 明确输入契约、输出契约和依赖 Issue。
- 视觉 Issue 必须附 Golden Case 对照；数据 Issue 必须附 fixture 或 schema 测试。

具体 Issue 草案见 `issues/MVP 原子 Issue 规划.md`。

## 8. 测试策略

### 契约测试

- 正例 fixture 必须通过 Schema。
- 缺失 ID、悬空引用、错误资产类型和非法 override 必须失败。
- Component Template 的参数默认值必须满足其参数 Schema。

### Core 测试

- Generated + Override 合并规则。
- 原子保存和恢复。
- 批量语义修改的事务边界。
- 资产 fallback 与结构化错误。

### Renderer 测试

- 同一输入产生稳定的场景结构。
- 七种 Template 的视觉快照。
- 路线、标注、safe area 和 PNG 尺寸。
- Adapter 缺失能力时能提前拒绝，而不是静默降级。

### Workspace 测试

- 每类手势只提交一次命令。
- 撤销/重做覆盖移动、旋转、缩放、路线与标注。
- 保存重开保持 Human Override。
- Golden Journey 浏览器级流程。

### MCP 测试

- Tool 输入/输出 Schema。
- 创建、修改、校验和失败恢复。
- 语义修改不污染无关 override。

## 9. MVP 成功指标

首版不追求规模指标，追求一个强证据：

- 作者能用 Loom 完成至少一张真实作品集分析图。
- 从自然语言草稿到第一次可编辑画面不需要手写 JSON。
- 关键构图可由 UI 完成，并能可靠保存与恢复。
- 同一 Diagram 可被 Codex 与 Workspace 往返修改至少三次而不损坏。
- 最终 PNG 被作者接受进入作品集排版，而不只是“技术上导出了图片”。

## 10. 明确不在 MVP 内

- 通用 CAD / DCC 网格建模。
- AI text-to-3D 资产生成。
- 多人实时协作、评论与权限。
- 云端项目管理、分享链接和版本托管。
- 社区模板市场与付费资产商店。
- 动画时间线、视频导出或交互式便携 Viewer。
- 自动生成所有类型的逻辑图。
- 与 iCraft 私有格式双向无损转换。

## 11. 当前剩余风险

1. 参数化模板的视觉上限：必须由 Gate 1 的真实作品集试用回答。
2. iCraft 能力与授权：属于验证项，不能用猜测写进关键路径。
3. 3D 场景中的路线可读性：可能需要单独的 2.5D overlay 层，而非全部放进三维空间。
4. 自动布局与手工构图冲突：必须坚持字段级 override，避免“一拖动就永久冻结整个节点”。
5. 组件库过早膨胀：首版只服务 Golden Case 与少量可复用逻辑图语义。

## 12. 开工顺序

1. 审查并冻结 Gate 0 四份契约与 fixture。
2. 执行 Gate 1 视觉纵切，同时完成 iCraft 两项 spike。
3. 根据视觉证据决定首个 Renderer，不等待不确定的外部路径。
4. 完成 Diagram Core 与 Workspace 手工编辑闭环。
5. 接入 Codex / MCP 语义修改。
6. 在干净环境跑完整 Golden Journey，并以作品集可用性作最终验收。
