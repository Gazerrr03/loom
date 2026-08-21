# Loom MVP 原子 Issue 规划

> 状态：本地 Issue-ready 草案，尚未发布到 GitHub
> 对应计划：`AI Native 3D Diagram Workspace MVP 实施计划文档.md` v0.2
> 拆分原则：一个 Issue 解决一个可验证问题，原则上可在一个连续 Agent 工作周期内完成。

## 1. Parent Issue

### `[MVP] 完成可编辑的 Flovvas 3D 等轴逻辑图闭环`

#### TL;DR

让作者可以通过 Codex 创建 Flovvas Golden Case，在 Workspace 中手工修正，并导出可进入作品集排版的 PNG。正式资产为 Renderer-independent 的 `diagram.json`。

#### 为什么值得做

传统二维流程图只能稳定表达卡片与连线，难以用空间层级、构造形态和 3D 视觉隐喻表现产品演化。MVP 必须证明：有限的参数化 Scene Template 加上语义数据和 Human Override，能产出一张真实作品集需要的图，而不只是一个可旋转的 3D demo。

#### Parent 验收

- [ ] Codex 可从自然语言创建 Golden Case。
- [ ] Workspace 可完成拖动、旋转、缩放、层级、路线、标注与撤销/重做。
- [ ] 保存重开后 Human Override 不丢失。
- [ ] Codex 修改语义时不覆盖无关的手工构图。
- [ ] 导出的双 A4 横向 PNG 被作者接受进入作品集排版。
- [ ] iCraft 不可用时主闭环仍可完成。

#### 建议标签

`epic`、`mvp`、`design-tool`

## 2. 依赖图

```text
001 ─┬─ 004 ─┬─ 005 ─ 006 ─ 008 ─ 009
002 ─┘       └─ 007 ──────────────┘
003 ──────────────────────────────┘

001 ─ 012 ─┬─ 013 ─ 016 ─ 017 ─ 018 ─┐
002 ─ 014 ─┤                           ├─ 021
          015 ────────────────────────┤
001 ─ 019 ─ 020 ─────────────────────┘

010 + 011 ── Renderer 决策，不阻塞参考 Renderer 主线
```

## Gate 0 — Contracts & Fixture

### 001 `[Contract] 冻结 Diagram Artifact Schema v0.1`

**TL;DR**：定义 Renderer-independent 的正式资产，让 Codex 与 Workspace 修改同一份可验证数据。

**当前问题**：项目只有产品文档，没有机器可校验的 Artifact 边界；语义、布局和渲染私有状态容易混在一起。

**期望结果**：提供 JSON Schema 2020-12 契约，覆盖 metadata、semantic、composition、generated layout、human overrides、annotations、presentation 与 assets。

**验收标准**：

- [ ] Schema 可被标准校验器加载。
- [ ] Generated Layout 与 Human Override 是独立字段。
- [ ] Human Override 支持字段级覆盖。
- [ ] 不含 Renderer 私有 mesh、camera runtime 或材质实例。
- [ ] 至少一组正例和一组反例测试通过。

**依赖**：无。
**建议标签**：`contract`、`mvp`、`priority:p0`

### 002 `[Contract] 冻结 Component Template Manifest v0.1`

**TL;DR**：让 Agent 能按语义找到组件，让 Renderer 能按映射实现组件，而不要求 Agent 理解 3D 内部代码。

**当前问题**：组件的语义、参数、能力、资产和 Renderer 实现还没有统一接口。

**期望结果**：定义模板的语义描述、搜索词、适用节点类型、参数 Schema、默认值、能力、依赖、Renderer Mapping 与 fallback。

**验收标准**：

- [ ] Manifest 通过 JSON Schema 校验。
- [ ] `card-slab` 示例能表达参数、能力与 fallback。
- [ ] 默认参数满足其参数 Schema。
- [ ] 同一模板可声明多种 Renderer Mapping。
- [ ] 找不到 mapping 时有显式 fallback。

**依赖**：无。
**建议标签**：`contract`、`component-library`、`priority:p0`

### 003 `[Contract] 冻结 Renderer Adapter Contract v0.1`

**TL;DR**：确保 iCraft 或参考 Renderer 可替换，不改变正式 Diagram 文件。

**当前问题**：如果 Workspace 直接依赖某个 3D 产品的运行时对象，未来更换 Renderer 会导致 Artifact 和编辑器一起重写。

**期望结果**：定义 RenderDocument、能力协商、加载/patch、拾取、预览、视图、PNG 导出、错误和交互提交边界。

**验收标准**：

- [ ] Adapter 能在加载前声明并检查能力。
- [ ] 拖动预览不修改 Artifact。
- [ ] PNG 同时包含 3D 场景和 2.5D overlay。
- [ ] 不支持的模板或资产返回结构化错误或显式 fallback。
- [ ] iCraft 进入条件被写清，不成为默认依赖。

**依赖**：001、002。
**建议标签**：`contract`、`renderer`、`priority:p0`

### 004 `[Fixture] 将 Flovvas Massing 编码为 Golden Diagram Artifact`

**TL;DR**：把产品语义 Golden Case 变成所有模块共享的可执行 fixture。

**当前问题**：视觉参考和语义文档很完整，但还不能作为 Core、Renderer、Workspace 与 MCP 的共同测试输入。

**期望结果**：fixture 包含 7 个主阶段、6 个语义操作、4 个 phase zone、3 条替代路径、5 个外部输入、1 个复利回路与跨页构图约束。

**验收标准**：

- [ ] 通过 Diagram Schema。
- [ ] 对象 ID 唯一，所有引用可解析。
- [ ] 画布为 594 × 210 mm，两页各 297 × 210 mm。
- [ ] 10–14 mm gutter safe zone 被显式表达。
- [ ] fixture 展示至少一个字段级 Human Override。

**依赖**：001、002。
**建议标签**：`fixture`、`golden-case`、`priority:p0`

## Gate 1 — Visual Slice

### 005 `[Renderer] 渲染 card-slab 原语与基础变换`

**TL;DR**：先证明同一个基础视觉单元能稳定成为所有阶段的“形态基因”。

**当前问题**：Golden Case 要求七个阶段共享同一原语，但当前没有可渲染的最小场景。

**期望结果**：参考 Renderer 能显示 card-slab，并按 Effective Layout 应用位置、elevation、Y 轴旋转、等比缩放与 zIndex。

**验收标准**：

- [ ] 正交等轴视图中可读。
- [ ] 五类布局字段均生效。
- [ ] 光照、阴影和主题 token 不写回 Artifact。
- [ ] 相同 RenderDocument 产生稳定场景结构。
- [ ] 缺失参数时使用模板默认值。

**依赖**：003、004。
**建议标签**：`renderer`、`visual-spike`、`priority:p0`

### 006 `[Renderer] 用参数化模板表达 Flovvas 七个主阶段`

**TL;DR**：验证 LINE → WORKBENCH 的形态演化能否不靠文字也被感知。

**当前问题**：这是 MVP 最大产品假设；如果七种状态只像七堆盒子，后续编辑器没有价值。

**期望结果**：用同一 card-slab 组合 LINE、BRANCH、CARD、FIELD、ARCHIVE、CONTEXT、WORKBENCH 七个 Template。

**验收标准**：

- [ ] 每个阶段能从轮廓、组织方式或空间层级上与相邻阶段区分。
- [ ] 七个阶段仍保持同一家族的视觉一致性。
- [ ] 参数能控制数量、分支、堆叠、网格、层与模块等关键差异。
- [ ] 作者完成一次不看标签的顺序辨认测试。
- [ ] 两轮定向修改仍失败时，记录 stop/go 结论。

**依赖**：005。
**建议标签**：`renderer`、`design`、`visual-spike`、`priority:p0`

### 007 `[Layout] 生成受约束的双 A4 横向跨页构图草稿`

**TL;DR**：自动布局要生成可修的作品集构图，而不是通用图算法的默认结果。

**当前问题**：Golden Case 有主对角线、四个阶段区和中缝安全区，普通流程图布局不能直接满足。

**期望结果**：依据 fixture 生成主叙事左下至右上、替代路径和输入降级处理的初稿。

**验收标准**：

- [ ] 主节点没有进入 gutter critical zone。
- [ ] 阅读顺序与语义 sequence 一致。
- [ ] 四个 phase zone 可见但不抢主节点层级。
- [ ] 替代路径和外部输入视觉权重低于 main flow。
- [ ] seed 相同则输出稳定。

**依赖**：001、004。
**建议标签**：`layout`、`golden-case`、`priority:p0`

### 008 `[Renderer] 呈现路线、阶段分区与编辑型标注 overlay`

**TL;DR**：把“场景模型”变成真正可读的分析图。

**当前问题**：仅有 3D 节点不能解释演化关系、分支、外部输入和作者判断。

**期望结果**：2.5D overlay 呈现 route、label、phase zone、annotation，并始终跟随场景与视图。

**验收标准**：

- [ ] main、alternative、input、loop 四种关系有明确层级差异。
- [ ] overlay 在 pan/zoom/orbit 后仍与目标对齐。
- [ ] 标注支持 node、edge、group 和 canvas anchor。
- [ ] 关键文字不被 3D 节点遮挡。
- [ ] 导出时包含 overlay，编辑手柄默认隐藏。

**依赖**：006、007。
**建议标签**：`renderer`、`annotation`、`priority:p0`

### 009 `[Export] 导出并验收第一张 Golden Case 跨页 PNG`

**TL;DR**：用真实作品集产物决定视觉纵切是否成立。

**当前问题**：技术渲染成功不能证明图适合用于作品集。

**期望结果**：稳定导出完整跨页 PNG，并按语义辨认、构图、可读性和视觉质感做作者验收。

**验收标准**：

- [ ] 输出尺寸、pixel ratio 与 revision 可追踪。
- [ ] 无选择框、手柄、safe area 或调试 UI 泄漏。
- [ ] 7 主阶段、3 替代、5 输入、1 loop 都可读。
- [ ] 中缝不破坏关键内容。
- [ ] 作者明确给出“进入作品集排版 / 继续视觉修正 / 停止并换策略”结论。

**依赖**：006、007、008。
**建议标签**：`export`、`acceptance`、`priority:p0`

### 010 `[Spike] 验证 iCraft 是否支持受支持的程序化场景创建与编辑`

**TL;DR**：以最小真实实验回答 iCraft 能否成为 Renderer Adapter，而不是依赖产品印象。

**当前问题**：现有公开能力是否能创建、更新、拾取、保存场景尚未证实。

**期望结果**：记录可用 API、最小 round-trip、缺失能力和可行 Adapter 边界。

**验收标准**：

- [ ] 使用官方文档或官方支持答复作为证据。
- [ ] 尝试一个 card-slab 的 create → update → reopen。
- [ ] 分别记录 scene creation、selection、transform、save/load、PNG export 能力。
- [ ] 得出 `go / partial / no-go`，不使用“应该可以”。

**依赖**：003。
**建议标签**：`spike`、`icraft`、`blocked:external`

### 011 `[Legal Spike] 确认 iCraft 产品用途与分发授权边界`

**TL;DR**：在写 Adapter 前确认 Loom 的产品用途不会违反 iCraft 或资产许可。

**当前问题**：技术可行不等于产品可用，尤其当 Loom 可能与原产品能力重叠。

**期望结果**：形成可引用的授权结论，覆盖开发、个人使用、产品分发、资产再分发和竞争性产品限制。

**验收标准**：

- [ ] 记录官方许可文本版本与日期。
- [ ] 无法从文本判断的条款向权利方询问。
- [ ] 结论分为允许、需要额外授权、禁止、未知。
- [ ] 未得到许可前不把 iCraft 写入主路径。

**依赖**：无。
**建议标签**：`legal`、`spike`、`icraft`、`blocked:external`

## Gate 2 — Core & Library

### 012 `[Core] 校验、加载并原子保存 Diagram Artifact`

**TL;DR**：让 `diagram.json` 成为不会因一次失败保存而损坏的正式资产。

**当前问题**：目前只有 fixture，没有可信赖的文件生命周期。

**期望结果**：Core 提供 create/load/validate/save，并在写入前后保持 schema 与引用完整性。

**验收标准**：

- [ ] 无效 Artifact 不进入编辑状态，错误能定位路径。
- [ ] 保存使用临时文件与替换策略，失败时原文件仍有效。
- [ ] 成功保存更新 revision/updatedAt。
- [ ] duplicate ID 与 dangling reference 被拒绝。
- [ ] Golden fixture 可无损 load/save round-trip。

**依赖**：001、004。
**建议标签**：`core`、`storage`、`priority:p0`

### 013 `[Core] 合并 Generated Layout 与字段级 Human Override`

**TL;DR**：重新布局时保留用户真正改过的字段，而不冻结整个场景。

**当前问题**：若自动布局覆盖手调结果，产品不可控；若一拖就冻结整个节点，自动布局又很快失效。

**期望结果**：Core 生成 Effective Layout，并支持设置、清除和检查单字段 override。

**验收标准**：

- [ ] override 字段优先，未 override 字段继续使用 generated 值。
- [ ] 可只覆盖 x 而保留新生成的 y/scale。
- [ ] 可按字段、对象或全图清除 override。
- [ ] dangling override 被校验器报告。
- [ ] 合并规则有表驱动测试。

**依赖**：012。
**建议标签**：`core`、`layout`、`priority:p0`

### 014 `[Library] 按语义查询并解析 Component Template`

**TL;DR**：Codex 和 Workspace 都能找到“适合表达某种含义”的组件。

**当前问题**：仅靠组件 ID 无法支持自然语言创建、模型选择或安全 fallback。

**期望结果**：按 accepted type、语义描述、search term 和 capability 查询模板，并为指定 Renderer 解析 mapping。

**验收标准**：

- [ ] Golden Case 七个模板都可由对应语义查询命中。
- [ ] 查询结果说明匹配原因与可调参数。
- [ ] Renderer mapping 缺失时返回显式 fallback 或错误。
- [ ] 不把 Renderer 私有实现细节暴露给 Codex。

**依赖**：002。
**建议标签**：`component-library`、`core`、`priority:p0`

### 015 `[Assets] 导入用户 GLB/GLTF 并提供几何 fallback`

**TL;DR**：在内置模板之外允许用户带入自己的 3D 模型，同时保证文件缺失时 Diagram 仍可打开。

**当前问题**：作品集表达最终可能需要定制模型，但 MVP 不能承担通用建模或不可控资产依赖。

**期望结果**：导入 GLB/GLTF、记录来源与授权元数据、校验引用，并在失败时使用声明的 fallback。

**验收标准**：

- [ ] 用户可选择本地 GLB/GLTF 并绑定到 Scene Node。
- [ ] 不复制或重新分发没有授权的第三方资产。
- [ ] 缺失或不支持的模型显示 fallback 与警告。
- [ ] 导入不会把绝对私有路径写入可分享 Artifact。

**依赖**：012、014。
**建议标签**：`assets`、`import`、`priority:p1`

## Gate 3 — Workspace UI

### 016 `[Workspace] 建立编辑器壳层与文件生命周期`

**TL;DR**：用户能在可见界面中创建、打开、保存和查看 Diagram 状态。

**当前问题**：没有 UI 就无法完成目标用户需要的视觉判断与手工构图。

**期望结果**：提供 canvas、component panel、inspector、状态/错误反馈和文件操作。

**验收标准**：

- [ ] 可打开 Golden fixture 并显示完整场景。
- [ ] 可创建、保存、另存和重新打开。
- [ ] 未保存修改、校验错误和 Renderer 降级清晰可见。
- [ ] Component Template 可搜索、预览并替换。

**依赖**：012、013、014 和可用 Renderer。
**建议标签**：`workspace`、`ui`、`priority:p0`

### 017 `[Workspace] 直接操控 Scene Node 并保存 Human Override`

**TL;DR**：让用户像使用 iCraft 一样直接修正构图，而不是编辑坐标表。

**当前问题**：自动布局只能提供草稿，作品集构图需要人的视觉判断。

**期望结果**：支持平面移动、Y 轴旋转、等比缩放、elevation、前后层级、视图 pan/zoom/orbit 与 reset isometric。

**验收标准**：

- [ ] 拖动期间流畅预览，松手后只提交一个命令。
- [ ] 操作只写相应 Human Override 字段。
- [ ] 保存重开后结果一致。
- [ ] reset isometric 不改变节点构图。
- [ ] 误操作可撤销。

**依赖**：013、016。
**建议标签**：`workspace`、`interaction`、`priority:p0`

### 018 `[Workspace] 编辑路线与标注，并提供统一 undo/redo`

**TL;DR**：完成分析图中关系和作者解释的手工修正闭环。

**当前问题**：节点位置正确仍不代表路线与文字可读；这些是作品集质感的一部分。

**期望结果**：编辑 route control points、创建/关联/修改标注，并把节点和 overlay 操作纳入同一历史。

**验收标准**：

- [ ] 可移动、增加和删除路线控制点。
- [ ] 可创建 canvas 与对象关联标注。
- [ ] 标注可改文字、anchor 与 offset。
- [ ] undo/redo 顺序覆盖节点、路线和标注操作。
- [ ] PNG 导出使用当前提交状态。

**依赖**：017。
**建议标签**：`workspace`、`annotation`、`undo-redo`、`priority:p0`

## Gate 4 — Codex / MCP

### 019 `[MCP] 暴露 Diagram 生命周期、校验与布局工具`

**TL;DR**：Codex 能安全地创建、读取、校验、保存和请求布局，不需要直接拼接文件字符串。

**当前问题**：直接让 Agent 修改原始 JSON 容易产生悬空引用、局部覆盖和不可恢复的保存错误。

**期望结果**：提供 create/open/summarize/validate/save/layout 工具，并以 JSON Schema 定义输入输出。

**验收标准**：

- [ ] 每个 Tool 的根 input schema 为 object。
- [ ] 错误返回对象 ID、字段路径、是否可恢复和建议动作。
- [ ] layout 调用可声明保留现有 Human Override。
- [ ] save 复用 Core 的原子保存。
- [ ] Tool 不暴露 Renderer 私有对象。

**依赖**：012、013。
**建议标签**：`mcp`、`codex`、`priority:p0`

### 020 `[MCP] 暴露语义修改与 Component 查询工具`

**TL;DR**：Codex 用产品语义改图，而不是退化为远程鼠标或坐标生成器。

**当前问题**：只有文件工具无法完成“把 Branch 变成更明确的并行探索”这类意图。

**期望结果**：提供 component search、node/edge/group/annotation mutation、dry-run 和 transactional apply。

**验收标准**：

- [ ] 可按语义查询七个 Golden Template。
- [ ] 可创建、修改、删除对象并保持引用完整。
- [ ] 批量修改先返回 dry-run 摘要。
- [ ] 一次 apply 是一个可撤销事务。
- [ ] 默认不改无关 Human Override。

**依赖**：014、019。
**建议标签**：`mcp`、`semantic-editing`、`priority:p0`

## Gate 5 — Acceptance

### 021 `[Acceptance] 在干净环境完成 Codex ↔ Workspace Golden Journey`

**TL;DR**：证明 MVP 是一个可重复使用的产品闭环，不是由开发环境偶然拼起来的 demo。

**当前问题**：单模块测试不能证明两个协作表面能围绕同一 Artifact 往返工作。

**期望结果**：在干净安装中由 Codex 创建、Workspace 修正、Codex 再修改、Workspace 导出，并审查最终作品集产物。

**验收标准**：

- [ ] 从零创建，不复制预先完成的 Golden fixture 作为结果。
- [ ] UI 完成节点、路线、标注与 undo/redo 操作。
- [ ] Codex 后续语义修改保留无关 override。
- [ ] 保存重开与三次往返后 Schema 和引用仍有效。
- [ ] PNG 通过 Issue 009 的视觉标准。
- [ ] 构建、测试和文档在干净环境通过。

**依赖**：009、015、018、020。
**建议标签**：`acceptance`、`e2e`、`mvp`、`priority:p0`

## 3. 发布到 GitHub 前仍需补的仓库信息

本目录当前不是 Git 仓库，因此以上内容只作为本地 issue-ready 草案，没有创建远端 Issue。发布前需要：

- 确定目标 GitHub 仓库与默认开发分支。
- 对齐现有 Issue 模板和 label 命名；上面的 label 只是建议。
- 为 Parent Issue 与 21 个子 Issue 建立真实关联。
- 根据团队一次 Agent 交付的规模，再检查 006、016、021 是否需要二次拆分。

产品范围、Gate、验收与依赖已经可以进入工程排期；缺少的只是仓库治理信息，而不是新的产品决策。
