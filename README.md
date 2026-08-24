# Loom

## AI-native 2.5D Diagram Workspace

Loom 把“我想表达的一组逻辑关系”变成一张可以继续编辑、重新组合、放进作品集的空间化 Diagram。

它运行在本地 Agent Runtime 旁边：用户用 Codex 描述图要表达什么，Loom 负责把语义组织成 `*.diagram.json`，再在 Workspace 中将它呈现为 2.5D 等轴构图。用户可以直接调整模型、层级、路线和标注，最后导出作品集可用的 PNG。

> Loom 不是一次性的 AI 出图工具，而是让 Agent 和人共同完成 Diagram 的工作台。

## 最终产品形态

用户不需要在空白 3D 场景里从零建模，也不需要手写坐标。完整体验是一条连续的工作流：

```text
在 Codex 中描述意图
        ↓
Agent 创建或修改语义 Diagram
        ↓
保存为可检查、可恢复的 diagram.json
        ↓
Workspace 生成 2.5D 等轴构图初稿
        ↓
用户直接拖动、旋转、缩放、分层、连线、标注
        ↓
再次保存 diagram.json，并导出作品集 PNG
```

### 用户最终看到的 Workspace

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Loom / flovvas-massing.diagram.json     Save   Undo   Redo   View   Export PNG │
├────────────────┬───────────────────────────────────────────┬─────────────────┤
│ COMPONENTS     │                                           │ INSPECTOR       │
│                │              Isometric Canvas              │                 │
│ Scene templates│      LINE → BRANCH → CARD → FIELD         │ Selected: CARD  │
│ Assets         │              ↗ routes / annotations        │ Component       │
│                │      ARCHIVE → CONTEXT → WORKBENCH         │ Position        │
│                │                                           │ Rotation / Scale│
│                │        [A4 page]   [gutter]   [A4 page]   │ Layer / Label   │
└────────────────┴───────────────────────────────────────────┴─────────────────┘
```

Workspace 是一个用于“做最终视觉判断”的编辑器：

- 中央画布呈现正交等轴的 2.5D 场景、路线、阶段分区和标注。
- 左侧用于搜索、预览和替换 Component Template 或 Asset。
- 右侧 Inspector 展示当前对象的语义和可编辑属性。
- 拖动时只预览，松手后提交一次可撤销的编辑命令。
- 重开文件后，用户做过的构图调整仍然存在。
- Workspace 不重复建设 Agent Chat；自然语言创建和语义修改留在 Codex。

### 一次真实使用

用户可以这样开始：

> 把 Flovvas 从线性 AI 对话演化到可复用 Context Workspace 画成一张双 A4 横向等轴分析图。保留主要阶段，让替代路径弱化，并把外部输入从上方接入。

Loom 随后完成：

1. Codex 识别 State、Operation、Input、Alternative 和 Phase Zone。
2. Component Library 返回可用的语义组件与 Scene Template。
3. Diagram Core 创建并校验节点、关系、分组和标注。
4. Layout 生成一份尊重页面边界和 gutter 的构图初稿。
5. Workspace 将初稿渲染成可以直接操作的空间场景。
6. 用户凭视觉判断修正模型、位置、旋转、缩放、层级、路线和文字。
7. 用户保存源文件并导出 PNG。
8. 用户再次让 Codex 修改“图表达什么”，而不是重新生成一张无关的新图；没有被修改的人工构图继续保留。

## Loom 要解决的问题

传统 2D 流程图擅长表达拓扑，却很难同时表达：

- **空间层级**：前后、上下、分层和体量本身就是关系的一部分；
- **视觉隐喻**：节点不再只能是统一的矩形卡片，而可以是承载语义的 3D 模型或小场景；
- **作品集质感**：阅读路径、留白、材质、强调色和构图共同构成一张分析图。

Loom 的首发用户是制作设计作品集的产品创建者。首个 Diagram Family 是逻辑类图表，优先表达流程、步骤、因果、依赖、分组和系统演化。

## Golden Case：从 LINE 到 WORKBENCH

MVP 用 Flovvas Massing Flowchart 验证产品是否成立。它不是普通时间线，也不是给矩形卡片加立体阴影，而是让同一个 `card-slab` 原语随着约束变化持续变形：

```text
LINE ──SPLIT──→ BRANCH ──EXTRACT──→ CARD ──CONNECT──→ FIELD
                                                         │
                                              STORE      ↓
ARCHIVE ←──────────── LAYER ──────────── CONTEXT ──RECOMBINE──→ WORKBENCH
```

这条形态演化对应：

```text
Linear conversation
→ Parallel exploration
→ Operable thought units
→ Visible relationships
→ Persistent knowledge
→ Reusable context
→ Compounding workspace
```

最终画面是一张 `594 × 210 mm` 的双 A4 横向 Spread：

- 主路径从左下向右上推进；
- 中央 `10–14 mm` gutter 是不能放置关键内容的安全区；
- Alternative 位于主路径下方并自然终止；
- External Input 从上方进入；
- Compounding Loop 从最终 Workbench 返回新的任务；
- 大部分文字被移除后，读者仍能通过形态变化理解产品演化。

Golden Case 的完整语义和视觉规则见 [`flovvas-massing-flowchart-case.md`](flovvas-massing-flowchart-case.md)，对应的原生资产见 [`examples/flovvas-massing.diagram.json`](examples/flovvas-massing.diagram.json)。

## 两个协作表面，一份正式资产

Loom 将“表达意义”和“完成构图”分给两个更适合的表面：

| 表面 | 用户通过它完成什么 | 它不应该负责什么 |
| --- | --- | --- |
| Codex + MCP | 创建 Diagram、理解语义、增删改节点和关系、请求布局、修改构图意图 | 直接编辑 mesh、shader、相机运行状态或 Renderer 私有场景 |
| Workspace UI | 选择模型、调整构图、拖动节点、编辑路线和标注、撤销重做、保存、导出 PNG | 在界面内重复建设自然语言 Agent Chat |

两者通过一份与 Renderer 无关的 `*.diagram.json` 协作。它不是对话缓存，也不是 Renderer 导出的临时文件，而是用户真正拥有的 Diagram 源资产。

```text
Semantic Model
  + Page Composition
  + Generated Layout
  + Human Override
  + Presentation Intent
  + Asset References
        ↓
  diagram.json
        ↓
  Effective Layout + Resolved Components
        ↓
  Renderer Adapter
        ↓
  Workspace / PNG
```

### 为什么要保留 Human Override

自动布局只负责生成一个结构正确的初稿，最终构图仍然需要人的判断。用户移动一个节点后，系统不会把整个场景冻结，也不会在下一次 Agent 修改时悄悄覆盖它：只保存被用户修改的字段，未被覆盖的部分仍可重新布局。

可以把它理解为：

```text
Generated Layout  +  Human Override  =  Effective Layout
```

这使得同一份 Diagram 可以经历多轮“Agent 改语义 → 人改构图 → 再导出”，而不是每次都从头排版。

## Renderer 不是产品身份

Renderer 只负责把已经解析好的 Diagram 变成可见、可选择、可预览和可导出的场景。它不决定产品语义，也不直接写回正式资产。

```text
diagram.json
    ↓
Renderer Contract
    ├── Reference Renderer   ← MVP 的安全兜底
    └── iCraft Adapter       ← 满足能力与授权条件后接入
```

iCraft 是首选的外部能力路径，但不是 Loom 的数据格式，也不是 MVP 的硬依赖。若 iCraft 的程序化创建能力或产品授权无法确认，Reference Renderer 仍应完成核心闭环。不得通过逆向 `.iplayer` 或依赖未授权的私有接口来伪造集成。

Renderer 的输入、能力协商、交互提交边界和错误协议见 [`contracts/renderer-contract.md`](contracts/renderer-contract.md)。

## MVP 的完成定义

Loom MVP 不是“所有模块都有代码”，而是必须完成下面两个可重复的真实闭环：

### 创建闭环

```text
真实 Codex 请求
→ 结构完整的 diagram.json
→ 自动布局初稿
→ Workspace 直接构图
→ 保存 Human Override
→ 双 A4 PNG
```

### 修改闭环

```text
已有 diagram.json
→ Codex 修改语义或关系
→ 保留无关的 Human Override
→ Workspace 显示更新
→ 再次保存并导出
```

最低质量门：

- 关闭并重新打开后，节点、关系、路线、标注和构图保持一致；
- 不支持的组件或 Renderer 能力给出可行动的错误，不静默丢对象；
- 替换 Renderer 时不需要改写 Diagram 的语义数据；
- 一次完整拖动只产生一个 Undo/Redo 操作；
- PNG 包含场景、路线、阶段分区和标注，并可进入作品集排版；
- 端到端验收从真实 Codex MCP 调用开始，而不是用手写 fixture 冒充。

## MVP 明确不做

- 云同步、多人协作、账号、权限和分享链接；
- 通用 CAD / DCC 网格建模、顶点面编辑和高级材质编辑；
- AI text-to-3D 资产生成；
- 组件市场和完整自定义组件管理器；
- 动画时间线、视频导出和交互式便携 Viewer；
- 与 iCraft 私有 `.iplayer` 格式的逆向或双向无损转换；
- 同时为软件架构、建筑体块等多个垂直领域建设完整组件库。

这些不是产品永远不会做，而是首版不让它们稀释“从语义到可用作品集图”的核心证据。

## 当前仓库是什么

这个仓库目前是 Loom 的产品、契约、Golden Case 和 MVP 交付包，用来把最终产品形态冻结成可实现、可验收的边界；它还不是已经可以启动的 Workspace 应用。

已落地：

- 产品核心方向、用户任务和最终交互闭环；
- `diagram.json` 的 Schema、Component Template Schema 和 Renderer Contract；
- Flovvas Golden Case 的语义 fixture；
- M0–M8 模块 Issue 与下一层原子 Issue 的拆分；
- 产品模块运作图。

尚未落地：

- 可运行的 Workspace UI；
- Diagram Core、Layout、Renderer 和 PNG Export 的实现；
- Codex / MCP Server 的真实连接；
- 从干净环境跑通的端到端 Golden Journey。

当前下一步是先用 Golden Case 做视觉纵切，确认参数化 `card-slab` 原语能否达到作品集质量，再扩展 Core、Workspace 和 MCP。iCraft 的验证与授权是并行 Gate，不应阻塞 Reference Renderer 的主路径。

## 仓库导航

| 路径 | 用途 |
| --- | --- |
| [`AI Native 3D Diagram Workspace 产品核心设计文档.md`](AI%20Native%203D%20Diagram%20Workspace%20产品核心设计文档.md) | 产品定义、数据边界、Workspace、MCP 和 MVP 非目标 |
| [`AI Native 3D Diagram Workspace MVP 需求池.md`](AI%20Native%203D%20Diagram%20Workspace%20MVP%20需求池.md) | 已确认决策、技术验证项、风险和 MVP 范围 |
| [`flovvas-massing-flowchart-case.md`](flovvas-massing-flowchart-case.md) | Golden Case 的叙事、页面构图、视觉语法和验收标准 |
| [`contracts/diagram.schema.json`](contracts/diagram.schema.json) | 正式 Diagram Artifact 的 JSON Schema 2020-12 契约 |
| [`contracts/component-template.schema.json`](contracts/component-template.schema.json) | Component Definition / Template 的参数与 Renderer Mapping 契约 |
| [`contracts/renderer-contract.md`](contracts/renderer-contract.md) | 可替换 Renderer Adapter 的输入、能力和交互边界 |
| [`examples/flovvas-massing.diagram.json`](examples/flovvas-massing.diagram.json) | Flovvas Massing Golden Case 的原生 Diagram fixture |
| [`examples/flovvas-workbench.component.json`](examples/flovvas-workbench.component.json) | Component Template 的结构示例 |
| [`diagrams/loom-mvp-module-map.html`](diagrams/loom-mvp-module-map.html) | 可交互查看 M0–M8 如何围绕 `diagram.json` 运作 |
| [`issues/modules/README.md`](issues/modules/README.md) | M0–M8 模块 Issue 正文索引 |
| [`issues/MVP 原子 Issue 规划.md`](issues/MVP%20原子%20Issue%20规划.md) | 模块以下的原子 Issue 拆分原则与草案 |
| [`issues/atomic/README.md`](issues/atomic/README.md) | 原子 Issue 目录与统一抽象边界 |

如果只想理解产品，先读本文和 Golden Case；如果要开始实现，再读契约和实施计划。
