# AI Native 3D Diagram Workspace 产品核心设计文档

版本：v0.2
状态：MVP 产品方向已冻结，工程契约进入 v0.1
首个产品代号：Loom

---

## 1. 一句话定义

Loom 是一个运行在本地 Agent Runtime 旁边的 AI-native 2.5D 等轴 Diagram Workspace。

用户在 Codex 中描述要表达的逻辑关系，Agent 创建或修改一份正式的 `*.diagram.json`；用户随后在 Workspace UI 中选择模型、调整构图、编辑标注，并导出作品集可用的 PNG。

```text
Codex
自然语言创建、理解、语义修改
        ↓
*.diagram.json
        ↓
Workspace UI
模型选择、构图、拖动、标注、PNG 导出
```

Loom 不是：

- 一个把 Mermaid 矩形加上立体阴影的工具；
- 一个完整的 3D 建模器；
- 一个只能控制 iCraft 的 MCP 插件；
- 一个把 Agent 对话结果临时显示出来的 Viewer。

---

## 2. 首发用户与问题

### 2.1 首发用户

MVP 首先服务产品创建者本人，用于制作设计作品集中的逻辑分析图。

首版不试图同时服务所有设计师、产品经理、软件架构师和建筑师。更广泛的人群是后续验证方向，不是 MVP 的前提。

### 2.2 用户任务

用户希望把下面这些关系表达成一张具有作品集质感的图：

- 流程与步骤；
- 因果与依赖；
- 分支与替代方案；
- 阶段与分组；
- 反馈循环；
- 同一个对象如何经过连续变形形成新状态。

### 2.3 当前替代方案为什么不够

传统 2D 流程图工具主要提供矩形卡片与连线。它们可以表达拓扑，却难以同时满足：

- **空间层级**：用前后、上下、分层与体量表达关系；
- **视觉隐喻**：让节点成为承载语义的 3D 模型或小场景；
- **作品集质感**：通过等轴投影、构图、留白、标注、材质与强调色形成分析图，而不是通用办公图表。

### 2.4 MVP 要验证的产品假设

> Agent 生成语义初稿，用户负责视觉判断与最终排版，两者通过一份正式 Diagram 文件协作，可以比“全手工 3D”更快，也比“自动生成 2D 流程图”更有表达力。

---

## 3. 首个 Golden Case

MVP 使用 `flovvas-massing-flowchart-case.md` 作为语义 Golden Case，使用用户提供的等轴导览分析图作为视觉 Golden Reference。

### 3.1 核心叙事

```text
LINE
→ BRANCH
→ CARD
→ FIELD
→ ARCHIVE
→ CONTEXT
→ WORKBENCH
```

它表达：

```text
Linear conversation
→ Parallel exploration
→ Operable thought units
→ Visible relationships
→ Persistent knowledge
→ Reusable context
→ Compounding workspace
```

### 3.2 核心视觉机制

同一个 `card-slab` 原语连续经历：

```text
SPLIT
→ EXTRACT
→ CONNECT
→ STORE
→ LAYER
→ RECOMBINE
```

这意味着视觉不是给七个状态分配七个无关图标，而是让形态变化本身承担叙事。

### 3.3 画布与阅读规则

- 两个 A4 横版拼成 `594 × 210 mm` Spread；
- 主路径从左下向右上；
- 中央 Gutter 是安全区，关键内容不能跨越；
- Alternative 位于主路径下方并自然终止；
- External Input 从上方进入；
- Compounding Loop 从最终状态返回新任务；
- 左页讲“重新设计思考容器”，右页讲“让 Context 持续复利”。

---

## 4. 核心产品原则

### 4.1 Diagram 是一等文件资产

Diagram 不是 Agent 对话、Runtime 内存或 Renderer 缓存。

MVP 的正式资产是：

```text
*.diagram.json
```

PNG 是从 Diagram 派生的作品集输出，不承担继续编辑或恢复源数据。

### 4.2 语义、布局与渲染分层

可以把它理解成舞台剧：

- Semantic Model 是剧本，说明有哪些角色以及发生什么关系；
- Layout Model 是走位，说明角色站在哪里；
- Human Override 是导演最后手动调整的走位；
- Renderer 是舞台和灯光，把同一份剧本呈现出来。

换舞台不应该改写剧本。

### 4.3 Layout 属于资产，GPU 状态不属于资产

为了稳定复现作品集构图，Diagram 必须保存：

- 画布尺寸与页面边界；
- Node、Route 与 Annotation 的位置；
- 人工移动、旋转、缩放和层级调整；
- 默认等轴视图的可复现参数；
- 语义颜色角色与人工样式覆盖。

Diagram 不保存：

- GPU buffer；
- Shader 编译状态；
- Mesh 实例缓存；
- Renderer 内部对象 ID；
- iCraft 私有 Scene State。

### 4.4 Agent 管语义，用户管最终视觉判断

Agent 擅长：

- 从自然语言识别 State、Operation、Input 和 Alternative；
- 创建、连接、分组与修改语义对象；
- 查询 Component Library；
- 生成自动布局初稿；
- 检查结构错误。

用户负责：

- 模型是否符合隐喻；
- 构图是否有阅读节奏；
- 哪些内容需要强调或弱化；
- 标注是否准确；
- PNG 是否达到作品集质量。

### 4.5 Renderer 可替换

iCraft 是首选路径，但不是产品身份。

```text
Diagram Artifact
        ↓
Renderer Contract
        ↓
┌──────────────────┬──────────────────────┐
│ iCraft Adapter   │ Reference Renderer   │
└──────────────────┴──────────────────────┘
```

如果 iCraft 缺少合法、稳定的程序化生成接口，MVP 使用本地 Reference Renderer。不得逆向 `.iplayer` 或依赖未授权内部能力。

---

## 5. Canonical Diagram Asset

Canonical Representation 由六层组成：

```text
Diagram Artifact
├── Metadata
├── Semantic Model
├── Page Composition
├── Layout
│   ├── Generated Layout
│   └── Human Override
├── Annotation & Presentation Intent
└── Asset References
```

### 5.1 Metadata

描述文件身份与版本：

- format；
- schemaVersion；
- diagram ID；
- title；
- createdAt / updatedAt；
- optional author。

### 5.2 Semantic Model

包含：

- Node；
- Edge；
- Group / Phase Zone；
- Diagram Family；
- Visual Role，但不包含具体材质实现。

Golden Case 中：

- State、Alternative、External Input 是开放 Node Type；
- Design Operation 是 Edge Type / Label；
- Phase 是轻量 Group / Zone；
- Status 决定语义角色，而不是靠颜色反推含义。

### 5.3 Page Composition

保存页面级设计约束：

- unit；
- canvas width / height；
- pages；
- margin；
- safe areas / gutter；
- reading direction；
- default view。

### 5.4 Generated Layout

由 Layout Engine 生成初稿：

- Node position / size；
- Route points；
- Annotation position；
- Zone bounds。

语义新增或重排时，Layout Engine 可以替换 Generated Layout；它不直接改写 Human Override。只有仍然存在的对象保留对应的字段级覆盖，已删除对象的孤立覆盖会被清理。

### 5.5 Human Override

用户在 Workspace UI 中修改：

- 平面位置；
- 绕垂直轴旋转；
- 等比缩放；
- 前后层级或离散高度；
- Route 控制点；
- Annotation 位置；
- Style token override。

Human Override 不覆盖 Generated Layout。读取时系统计算 Effective Layout：

```text
Generated Layout
+ Human Override
= Effective Layout
```

局部重排的判断规则：

- 新增 Node、Edge 或 Group 只获得新的 Generated Layout 条目，不移动无关对象已有的手工字段；
- 已有对象的自动位置可以变化，但显式覆盖的字段继续优先；未覆盖字段继续采用新的 Generated 值；
- 删除语义对象时清掉它对应的 Override，避免未来复用同一 ID 时继承过期走位；
- 清除某个 Override 后，该字段立即回到当前 Generated Layout，且清除操作可撤销。

### 5.6 Asset References

Diagram 可以引用：

- 内置程序化 Primitive；
- Parametric Scene Template；
- 可再分发 GLB / GLTF；
- 用户本地导入的 GLB / GLTF；
- 基础几何 Fallback。

大型二进制不直接内嵌进 JSON。Asset Reference 记录稳定 ID、URI、媒体类型、校验信息和许可信息。

---

## 6. 开放 Type 与 Component Library

### 6.1 Type 是开放 Identifier

Node Type 不使用固定枚举。

示例：

```text
state.linear-stream
state.context-workbench
input.external-document
alternative.static-knowledge-base
```

Type 只是 Identifier。Agent 如何理解它，由 Component Definition 说明。

### 6.2 Component Definition 回答“它是什么”

包含：

- semantic description；
- search terms；
- capabilities；
- allowed relations；
- visual role；
- 可用 Component Template。

### 6.3 Component Template 回答“它怎样成为一个场景”

MVP 支持两类 Template：

1. **Parametric Scene Template**：通过基础 Primitive 的重复、堆叠、分支、分布、分层和组合生成场景；
2. **Asset Template**：引用一个 GLB / GLTF 或 Renderer 提供的合法资产。

Component Template 是 Manifest，不要求 Agent 理解 Renderer 内部代码。它公开：

- 接受哪些 Semantic Type；
- 用户和 Agent 可以传哪些参数；
- 需要哪些 Primitive / Asset；
- 支持哪些变形能力；
- 不同 Renderer 的实现映射；
- 缺少实现时怎样 Fallback。

### 6.4 Golden Case 最小组件集

首版围绕 `card-slab` 建立：

- linear stream；
- branching family；
- extracted card；
- connected field；
- persistent stack；
- exploded context layers；
- recombined workbench；
- connector；
- phase zone；
- text / annotation。

不以“组件数量达到 20 个”作为成功标准。

---

## 7. Layout System

Layout System 的目标不是替用户完成最终构图，而是生成一个可编辑、结构正确的初稿。

### 7.1 输入

- Semantic Graph；
- Page Composition；
- Node estimated bounds；
- Phase / route role；
- safe areas；
- pinned Human Override。

### 7.2 输出

- Node positions；
- Zone bounds；
- Route points；
- Annotation candidates；
- unresolved collision warnings。

### 7.3 Golden Case Constraints

- 主路径为对角线；
- Alternative 在下方；
- External Input 在上方；
- Loop 返回新任务；
- Gutter 与 margin 不可侵入；
- 已被用户调整的对象保持固定；
- 无法消除的标注冲突必须显式报告。

### 7.4 不自研完整布局算法

MVP 评估 ELK、Dagre 等成熟算法，再增加薄的 Page Constraint 层。只有经过 Fixture 证明现有能力无法满足时，才讨论更复杂的专用算法。

---

## 8. Renderer Contract

Renderer Adapter 只消费解析后的 Render Document：

```text
Semantic Model
+ Effective Layout
+ Page Composition
+ Resolved Component Templates
+ Asset References
+ Presentation Tokens
```

Renderer 必须提供：

- Scene Node 渲染；
- Route 渲染；
- Annotation 渲染；
- 正交等轴默认视图；
- hit testing；
- Node transform preview；
- PNG capture；
- 缺失能力与资产的结构化错误。

Renderer 不直接修改 Diagram。Workspace 把用户交互转换成 Domain Command，再更新 Human Override。

---

## 9. Workspace UI

### 9.1 首版信息架构

```text
┌───────────────────────────────────────────────────────┐
│ File / Save / Undo / Redo / View / Export PNG        │
├───────────────┬─────────────────────────┬─────────────┤
│ Components    │ Isometric Canvas        │ Inspector   │
│ Assets        │ Routes & Annotations    │ Selection   │
└───────────────┴─────────────────────────┴─────────────┘
```

MVP 不在 Workspace 内重复建设 Agent 聊天框。

### 9.2 直接操作

- 选择 Scene Node；
- 平面移动；
- 绕垂直轴旋转；
- 等比缩放；
- 调整前后层级；
- 调整 Route 控制点；
- 编辑 Label 与自由 Annotation；
- 视图平移、缩放与旋转；
- 恢复默认等轴视图；
- Undo / Redo。

### 9.3 文件与导出

- 创建 / 打开 / 保存 `*.diagram.json`；
- 自动提示未保存修改；
- 显示页面、margin、gutter 和导出范围；
- 导出可预测尺寸和背景的 PNG。

---

## 10. Codex 与 MCP

Codex 是自然语言入口，MCP 是语义操作协议。

MCP Tool 分为：

### Diagram Lifecycle

- create_diagram；
- load_diagram；
- save_diagram；
- validate_diagram。

### Node

- create_node；
- update_node；
- delete_node。

### Edge

- connect_nodes；
- update_edge；
- disconnect_nodes。

### Group / Zone

- create_group；
- update_group；
- move_into_group。

### Component Library

- search_components；
- get_component_definition。

### Layout

- generate_layout；
- check_layout。

Tool 输入与结构化输出使用 JSON Schema 2020-12。每个写操作必须说明副作用、返回文件版本，并以原子方式保存。

Agent 不调用 iCraft-specific Tool，也不直接编辑 Renderer Scene。

---

## 11. 模块边界

```text
Codex
  ↓ MCP
Diagram MCP Server
  ↓
Diagram Core ───── Component Library
  ↓                         ↓
Artifact Storage      Template Resolver
  ↓                         ↓
Layout Adapter ───── Renderer Adapter
  ↓                         ↓
             Workspace UI
                  ↓
                PNG
```

| 模块 | 负责 | 不负责 |
|---|---|---|
| Diagram Core | 数据结构、校验、Domain Command、Effective Layout | 3D 渲染 |
| Artifact Storage | 原子保存、加载、版本错误 | 云同步 |
| Component Library | 语义检索、Template Manifest、Renderer Mapping | 生成 Agent 意图 |
| Layout Adapter | 自动初稿、Constraint、碰撞警告 | 最终美术判断 |
| Renderer Adapter | 将 Render Document 变成可见场景 | 修改 Diagram 语义 |
| Workspace UI | 直接操作、检查器、文件与导出 | 自然语言理解 |
| MCP Server | 把 Codex Tool 调用转为 Domain Command | Renderer-specific 控制 |

---

## 12. MVP 不做

- 云同步、多人协作、账号和权限；
- Marketplace；
- 完整自定义 Component 管理器；
- 多 Renderer 的正式产品支持；
- 完整 3D 建模；
- 顶点 / 面编辑；
- 高级材质编辑；
- 动画时间轴和相机关键帧；
- AI 生成 3D 模型；
- 自研完整 Layout Algorithm；
- 可恢复 Diagram 的 HTML / PNG；
- Workspace 内置 Agent Chat；
- 逆向 iCraft 文件格式。

---

## 13. MVP 成功定义

MVP 成功不等于“所有模块都有代码”。它必须完成两个真实闭环：

### 创建闭环

```text
Codex 自然语言
→ Flovvas Semantic Diagram
→ 自动初稿
→ Workspace 人工构图
→ PNG
```

### 修改闭环

```text
已有 diagram.json
→ Codex 语义修改
→ 保留 Human Override
→ Workspace 显示更新
→ 再次导出 PNG
```

Golden Case 验收：

- 初读者能复述 linear chat → spatial thought → persistent knowledge → reusable context；
- 同一个 `card-slab` 在七个状态中持续可识别；
- 主路径三秒内可识别；
- Alternative 不会被误认成主路径；
- Gutter 没有关键内容；
- 颜色在灰度下仍可区分；
- 移除大部分段落后，形态变化仍能解释产品演化；
- PNG 达到可放入作品集继续排版的质量。

---

## 14. 术语表

| 术语 | 定义 |
|---|---|
| Diagram Artifact | 用户拥有的 `*.diagram.json` 正式资产 |
| Semantic Model | Node、Edge、Group 及其意义 |
| Page Composition | 页面、margin、gutter、阅读方向和默认视图 |
| Generated Layout | Layout Engine 生成的初稿 |
| Human Override | 用户在 Workspace 中产生的非破坏性覆盖 |
| Effective Layout | Generated Layout 与 Human Override 合并后的结果 |
| Scene Node | 在画布中承载一个语义 Node 的 3D 模型或小场景 |
| Route | 可视化后的语义 Edge |
| Annotation | Node、Route 或页面上的解释文字 |
| Visual Role | active、retained、historical 等语义视觉角色 |
| Component Definition | Agent 用来理解 Type 的语义说明 |
| Component Template | Semantic Type 到 Parametric Scene 或 Asset 的 Manifest |
| Parametric Scene Template | 用基础 Primitive 和参数组合出来的 Scene Node |
| Asset Reference | 指向 GLB / GLTF 等外部资产的稳定引用 |
| Renderer Adapter | Render Document 到具体渲染能力的适配层 |
| Reference Renderer | iCraft 不可用时保证核心闭环的本地 Renderer |
| Golden Case | 冻结语义、视觉、布局和验收的真实作品集案例 |
