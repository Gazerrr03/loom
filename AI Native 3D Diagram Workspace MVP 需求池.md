# AI Native 3D Diagram Workspace MVP 需求池

版本：v0.5
状态：MVP 产品范围已冻结；技术路径按 Gate 验证
用途：作为产品需求事实源；工程交付拆分见 `issues/MVP 原子 Issue 规划.md`

---

## 1. 先说结论

当前最值得验证的不是“能否实现一套完整 Diagram 架构”，而是下面这条真实用户闭环：

> 用户在制作设计作品集时，把需要讲清楚的流程或逻辑关系交给 Codex；系统生成一个比传统 2D 流程图更有空间层次和视觉表现力、可拖动调整、可再次打开和修改的 3D Diagram，并把原生 JSON 作为正式资产。

MVP 已经确认：

1. 首先服务用户本人制作设计作品集中的逻辑类图表；
2. iCraft 是首选但可替换的 Renderer 路径；
3. MVP 必须提供可拖动的编辑界面，并把调整保存为 Human Override；
4. MVP 的正式资产先只考虑原生 JSON；可恢复、可继续编辑的便携 HTML / PNG 不进入首版正式资产范围。

用户随后补充确认：

5. 产品需要一个可直接操作 Diagram 的 Workspace UI，交互原则参考 iCraft；
6. MVP 需要导出 PNG 作为作品集使用的派生结果，但 JSON 仍是唯一正式资产；
7. 3D 的首要价值是空间层级、视觉隐喻和作品集质感，而不是单纯把矩形卡片加上立体阴影。

产品范围上的关键选择已经完成。当前剩余未知项主要是需要用 Spike 和 Fixture 验证的技术事实：

1. Parametric Scene Template 能否只用 `card-slab` 等基础原语达到作品集所需的视觉质量；
2. 现有 Layout Engine 加少量 Constraint 后，能否生成可用的双 A4 Spread 初稿；
3. iCraft 是否存在合法、稳定的程序化生成路径；若没有，则使用本地 Reference Renderer。

这些问题会决定工程实现路径，但不会再改变 MVP 的核心用户、协作表面或验收场景。

在这些问题确认前，本需求池使用以下状态：

- `已确认`：已有明确产品判断，可以进入需求细化；
- `候选`：合理，但是否进入 MVP 仍需取舍；
- `被决策阻塞`：产品选择会改变需求本身；
- `被验证阻塞`：必须先证明技术或授权路径成立；
- `MVP 后`：保留长期方向，但不进入首版闭环。

---

## 2. 已确认的产品判断

这些判断来自现有两份项目文档和前序聊天：

- 产品是运行在本地 Agent Runtime 中的 AI-native Diagram Workspace，不是单纯的 iCraft 插件；
- Diagram 是用户拥有的正式文件资产，不是一次对话结果；
- Canonical Representation 至少包含 Semantic Model、Diagram-level Layout 和 Human Override 的数据边界；
- Renderer-specific 的 Mesh、材质、GPU、相机运行状态不进入核心资产；
- iCraft 是首个 Renderer / Capability Provider 候选，但核心资产不能依赖 iCraft 文件格式；
- Node Type 使用开放 Namespace，不使用封闭枚举；
- Component Library 同时承担语义说明与 Renderer Mapping；
- Agent 负责表达实体、关系与分组，Layout Engine 负责计算坐标；
- 布局算法优先使用成熟实现，不自研；
- 第一种 Agent Runtime 是 Codex，第一种协议是 MCP；
- MCP Tool 应职责清楚、参数可校验，不向 Agent 暴露 Renderer 内部状态；
- 多人协作、云同步、权限、Marketplace、多 Renderer 和自研 3D Engine 不属于 MVP。

首发用户与任务已经进一步收敛：

- 首发用户：用户本人；
- 使用情境：制作设计作品集；
- 核心任务：把流程、步骤、因果、依赖、分组等逻辑关系转成具有更强视觉表达的 3D Diagram；
- 当前替代方案：传统 2D 流程图工具；
- 当前痛点：2D 表达缺少空间层级、可承载语义的 3D 视觉隐喻与作品集所需的构图质感；Flovvas Golden Case 已把这些能力具体化。

用户已进一步明确 2D 工具的不足：

- 缺少空间层级，难以用前后、上下、分层表达复杂关系；
- 缺少视觉隐喻，节点通常只能是矩形卡片，不能由承载语义的 3D 模型来表达；
- 缺少作品集质感，输出更像通用制图工具，而不是经过构图和视觉设计的分析图。

需要特别区分：

- “用户未来能分享、版本管理、脱离本产品查看资产”是已确认的长期方向；
- 这些能力已明确不进入 MVP；首版只承诺原生 JSON 与派生 PNG。

---

## 3. 当前外部能力事实与风险

### 3.1 已验证事实

- iCraft Editor 当前支持在网页编辑器中把 Mermaid `architecture`、`flowchart`、`stateDiagram` 转成 3D 场景；转换和渲染在浏览器本地完成。
- `@icraft/player-react` 和 `@icraft/player` 的公开用法都是加载由 iCraft Editor 导出的 `.iplayer` 文件。
- 公开 Player API 可以读取元素、播放动画、切换视图和加载文件，但公开文档未提供创建元素、创建连线或保存 `.iplayer` 场景的 API。
- iCraft GitHub 仓库虽然公开可见，但 LICENSE 是商业专有许可证，并限制修改、衍生、逆向、再分发及用于创建竞争产品。

参考：

- iCraft Mermaid 3D：https://icraft.gantcloud.com/blog/mermaid
- iCraft Player API：https://icraft.gantcloud.com/player-javascript/api
- Player React README：https://github.com/gantFDT/icraft/blob/main/player-react.README.zh-CN.md
- iCraft LICENSE：https://github.com/gantFDT/icraft/blob/main/LICENSE

### 3.2 对 MVP 的影响

因此，下面这条链路目前只是产品假设，不是已证明的实现能力：

```text
Diagram Artifact
  → iCraft Renderer Adapter
  → 自动生成 .iplayer
  → @icraft/player-react 展示
```

在获得官方许可或公开的程序化场景生成接口之前，不能把“实现 iCraft Adapter”当成普通、确定的开发 Issue。它必须先经过可行性与授权 Gate。

可选产品路径：

| 路径 | 用户体验 | 复杂度与风险 | 是否满足原始闭环 |
|---|---|---|---|
| A. 获得 iCraft 官方生成接口与许可 | Codex 到 3D 全自动，且使用 iCraft | 依赖外部授权与未公开能力 | 满足 |
| B. 输出 Mermaid，用户手动导入 iCraft Editor | 最快看到 iCraft 3D 结果 | 有人工断点，不是完整 Workspace 闭环 | 部分满足 |
| C. 先做可替换的本地 Reference Renderer | Codex 到 3D 全自动、资产完全本地 | 首版不使用 iCraft；需实现最小渲染器 | 满足核心价值，不满足“首版必须 iCraft” |

### 3.3 视觉 Golden Reference

用户提供的参考案例：

- Pinterest：https://www.pinterest.com/pin/601582462732396893/
- 参考类型：等轴 3D 流程 / 导览分析图

这张图不是“矩形流程图的 3D 皮肤”，而是由以下视觉语法组成：

1. **Scene Node**：每个节点是承载语义的 3D 场景或模型，而不是统一矩形卡片；
2. **统一投影**：所有模型使用相近的正交等轴视角，放在同一个页面构图中；
3. **空间层级**：模型有不同体量、层数和高度，局部可使用爆炸分解来表达内部结构；
4. **Route**：关系使用实线、虚线、颜色和弯曲路径区分不同语义；
5. **Annotation**：节点名、路径说明、标题、图例和补充段落共同解释图，而不是把所有文字塞进节点；
6. **Editorial Composition**：留白、疏密、模型尺寸和阅读路径共同形成作品集版式；
7. **克制材质**：低饱和模型、浅色背景和少量强调色让复杂信息仍然清晰。

因此 MVP 更准确的视觉定位是：

> 一个由 Agent 辅助生成、由用户在 UI 中排版的 2.5D 等轴 Diagram Workspace。

“2.5D”表示 Diagram 仍以页面构图和逻辑关系为主，但节点可以是真实 3D 模型，用户不需要进入完整 3D 建模工作流。

### 3.4 语义 Golden Case：Flovvas Massing Flowchart

来源：`flovvas-massing-flowchart-case.md`

#### 用户任务

制作一张横跨两个 A4 横版页面的连续分析图，解释 Flovvas 如何从线性 AI 对话演化成可复用的 Context Workspace。

这不是普通时间线，也不是用户流程。它的核心语义是：

```text
State
→ Design Operation
→ Transformed State
```

#### 主叙事

```text
LINE
→ BRANCH
→ CARD
→ FIELD
→ ARCHIVE
→ CONTEXT
→ WORKBENCH
```

对应操作：

```text
SPLIT
→ EXTRACT
→ CONNECT
→ STORE
→ LAYER
→ RECOMBINE
```

#### 规范化语义对象

- 7 个 Main State；
- 6 个位于 Edge 上的 Design Operation；
- 4 个 Phase Zone：Existing Condition、Spatialization、Persistence、Compounding；
- 3 个被弱化且终止的 Alternative；
- 5 个进入 Context State 的 External Input；
- 1 个从 Workbench 返回新任务的 Compounding Loop；
- 1 个贯穿所有 Main State 的基础原语：`card-slab`。

#### 关键视觉约束

- 画布为两个 A4 横版拼成的 `594 × 210 mm` 横向 Spread；
- 主路径从左下向右上形成对角线；
- 中缝 `10–14 mm` 内不能放置 Node、标题或关键 Annotation；
- Alternative 位于主路径下方，External Input 从上方进入；
- 左页承担“重新设计思考容器”，右页承担“让 Context 持续复利”；
- 同一个 `card-slab` 必须通过拆分、抽取、连接、堆叠、分层和重组逐步演化，不能换成七个互不相关的图标；
- Graphite、Pale Blue、Mint、Muted Coral 是语义色，不是装饰色；
- 即使大部分段落被移除，读者仍应通过形态变化理解产品演化。

#### 对产品架构的影响

这个案例证明 Component Library 不能只做：

```text
Semantic Type → 一个静态 GLB
```

它还要支持：

```text
Semantic Type
→ Parametric Scene Template
→ 重复使用基础 3D Primitive
→ 组合、堆叠、分层或爆炸
```

因此 MVP 的首批视觉资产可以优先使用合法内置的程序化基础几何，而不是等待一整套复杂外部模型。GLB / GLTF 导入仍然保留，用于未来需要更具体视觉隐喻的 Scene Node。

---

## 4. MVP 成功标准草案

以下成功标准建立在“创建 + 再次修改”比“一次性生成”更能验证 Workspace 价值的判断上：

### 核心验收场景 A：从自然语言创建

1. 用户在 Codex 中输入一条自然语言请求；
2. Agent 查询受支持的 Component Library；
3. Agent 创建 Node、Edge，必要时创建 Group；
4. 系统生成并校验一个 `*.diagram.json` 文件；
5. Layout Engine 生成 Diagram Space 坐标；
6. Workspace UI 展示与语义一致的 3D Diagram；
7. 关闭后再次打开，Diagram 的内容和布局保持一致。

### 核心验收场景 B：修改已有资产

1. 用户要求 Codex 修改已有 Diagram，例如“在支付服务和数据库之间增加队列”；
2. Agent 加载原文件，完成局部修改，而不是重新生成另一份无关文件；
3. 未被修改的 Node ID、关系和用户调整保持稳定；
4. 文件再次通过 Schema 校验，Workspace UI 显示修改后的结果。

### 最低质量门

- 文件不是 Renderer 输出的临时缓存，而是可直接检查的用户资产；
- 同一文件重复加载不会随机丢失实体、关系或布局；
- 不支持的组件或 Renderer Mapping 会给出可行动的错误，不静默生成错误图形；
- 替换测试 Renderer 时，核心 Diagram 文件不需要改写语义数据；
- 端到端验收必须从真实 Codex MCP 调用开始，不能只用单元测试代替。

---

## 5. MVP 需求池

### Epic A：首个用户任务与产品闭环

| ID | 需求 | 状态 | MVP 验收意图 | 依赖 |
|---|---|---|---|---|
| MVP-A01 | 冻结一个首要用户与一种首发 Diagram Family | 已确认 | 用户本人使用逻辑类 Diagram 表达设计作品集内容；首版不同时覆盖软件架构或建筑体块组件库 | DEC-01 |
| MVP-A02 | 用户可通过 Codex 自然语言创建 Diagram | 已确认 | 一条用户请求触发组件查询、图创建、布局、保存与展示 | A01、C、D、E、F |
| MVP-A03 | 用户可通过 Codex 修改已有 Diagram | 已确认 | 至少支持新增、删除、重命名 Node 和新增、删除 Edge | B、E |
| MVP-A04 | 用户可关闭并重新打开 Diagram | 已确认 | 重开后语义和布局一致 | B、F |
| MVP-A05 | 用户可在 Workspace UI 中拖动 Node 并保存调整 | 已确认 | 拖动后重开文件位置保持；Agent 后续修改不覆盖该调整 | DEC-03、B06、F05 |
| MVP-A06 | 用户可获得脱离运行环境且保留可编辑源数据的便携资产 | MVP 后 | 可恢复的 HTML / PNG 等方案后续设计；不与首版派生 PNG 混为一谈 | DEC-04 |
| MVP-A07 | 用户可把当前构图导出为 PNG | 已确认 | PNG 可直接进入作品集；它是从 JSON 派生的输出，不承担继续编辑或恢复源数据 | DEC-08、F13 |
| MVP-A08 | 完成 Flovvas Massing Golden Case | 已确认 | 从语义描述生成可编辑初稿，经人工排版后导出满足双 A4 Spread 验收的 PNG | DEC-06、G01、G10 |

### Epic B：Diagram Artifact 与 Core

| ID | 需求 | 状态 | MVP 验收意图 | 依赖 |
|---|---|---|---|---|
| MVP-B01 | 定义带版本号的 `diagram.schema.json` v0.1 | 已确认 | 合法文件可校验；错误字段有明确路径和原因 | A01 |
| MVP-B02 | 支持 Diagram metadata 与稳定 ID | 已确认 | 文件有版本、ID、标题、创建与更新时间；实体 ID 可供后续修改引用 | B01 |
| MVP-B03 | 支持 Node | 已确认 | Node 至少包含稳定 ID、开放 Type、Label、可选 Description / Properties | B01 |
| MVP-B04 | 支持 Edge | 已确认 | Edge 可表达 Source、Target、开放 Relation Type 和可选 Label | B01 |
| MVP-B05 | 支持 Group / Phase Zone | 已确认 | Golden Case 可表达四个轻量 Phase Zone，不强制渲染为重型容器框 | A08、B01 |
| MVP-B06 | 分离 Generated Layout 与 Human Override | 已确认 | 两层可合并读取；重新布局和 Agent 修改不覆盖人工调整 | DEC-03、B01 |
| MVP-B07 | 提供创建、加载、原子保存与修改能力 | 已确认 | 写入中断不会留下半份合法 JSON；修改后仍通过校验 | B01-B04 |
| MVP-B08 | 提供明确的 Schema 版本错误 | 已确认 | 不支持的未来版本不会被误读或静默降级 | B01 |
| MVP-B09 | 提供 v0.1 内部模型与 Renderer Model 的隔离边界 | 已确认 | 核心文件中不出现 `.iplayer` 专属 Mesh、材质、相机运行状态 | B01 |
| MVP-B10 | 自动迁移旧 Schema | MVP 后 | 首版尚无历史用户资产，只保留 version 字段与拒绝策略 | B01 |
| MVP-B11 | 支持 Golden Case 的语义角色 | 已确认 | State、Alternative、External Input 作为开放 Node Type；Design Operation 作为 Edge Type / Label；角色不依赖颜色推断 | A08、B03、B04 |
| MVP-B12 | 把 Page Composition 保存为 Layout Asset | 已确认 | 保存画布尺寸、页边距、中缝安全区、阅读方向和 Node / Annotation 位置，不保存 GPU 或缓存状态 | A08、B01 |
| MVP-B13 | 保存语义 Visual Role 与人工 Style Override | 已确认 | `historical / active / retained / warning` 等语义角色与具体材质解耦；用户颜色调整可往返保存 | A08、B01、B06 |

### Epic C：Component Library

| ID | 需求 | 状态 | MVP 验收意图 | 依赖 |
|---|---|---|---|---|
| MVP-C01 | 定义 `component-template.schema.json` v0.1 | 已确认 | Component Template 包含稳定 ID、语义说明、参数、能力、依赖、Renderer Mapping 和 Fallback | A01 |
| MVP-C02 | 提供首发 Golden Case 的最小内置组件集 | 已确认 | 覆盖 card slab、stack、field、layer、connector、zone 和 text 等必要原语 / 模板；不以“20 个”为目标 | DEC-06、DEC-07、C01 |
| MVP-C03 | 支持按自然语言检索组件 | 已确认 | Agent 能从用户词汇找到合适 Type，并得到选择理由所需的描述 | C01、C02 |
| MVP-C04 | 支持查询单个 Component Definition | 已确认 | Agent 可读取该 Type 的能力、关系和可用 Renderer Mapping | C01 |
| MVP-C05 | 缺少精确匹配时使用明确的视觉 Fallback | 已确认 | 语义仍保留；Workspace 使用通用形状并提示未匹配，而不是丢失 Node | C01、F01 |
| MVP-C06 | Schema 允许开放 Namespace Type | 已确认 | 文件可以引用非内置 Type；校验器不把 Type 限制为固定枚举 | B01、C01 |
| MVP-C07 | 用户可创建和安装自定义 Type Definition | MVP 后 | 首版只保证数据模型可扩展，不建设完整 Library 管理体验 | C01 |
| MVP-C08 | 使用 Embedding / 向量数据库做语义搜索 | MVP 后 | 小型内置库先使用可解释的文本匹配，除非验证证明不够用 | C03 |
| MVP-C09 | 为 Component Definition 提供可合法使用的 3D Asset | 已确认 | Asset 来源采用合法内置原语、小型可再分发模型、用户导入 GLB / GLTF 和基础几何 Fallback；记录来源与许可 | DEC-10、C01、F01 |
| MVP-C10 | 支持 Parametric Scene Template | 已确认 | 一个 State 可由同一 `card-slab` 的数量、位置、旋转、堆叠和层级参数生成，不要求每个 State 对应独立模型 | A08、C01、F01 |
| MVP-C11 | 支持用户导入 GLB / GLTF | 已确认 | 导入资产有稳定引用、预览、基本尺寸归一化和缺失文件错误；MVP 可保存本地绝对路径与授权信息，但不会把大型二进制直接内嵌进 JSON；缺失资产阻止 PNG 导出 | DEC-10、C01、F05 |

### Epic D：Layout

| ID | 需求 | 状态 | MVP 验收意图 | 依赖 |
|---|---|---|---|---|
| MVP-D01 | 用首发 Golden Cases 评估并冻结一个现成 Layout Engine | 已确认 | 比较 Dagre / ELK 等候选对方向、分组、稳定性和包体的支持后记录 ADR | A01、B03-B05 |
| MVP-D02 | 从 Semantic Graph 生成 Diagram Space 的 2D 坐标 | 已确认 | Node 不重叠；关系方向可理解；结果写入 Artifact | D01 |
| MVP-D03 | Renderer 将 2D Diagram Space 映射到等轴 3D 构图 | 已确认 | x/y 决定页面排版；Renderer 负责模型高度、统一投影和空间呈现，不把 GPU 状态写回核心资产 | D02、F01 |
| MVP-D04 | 相同输入产生稳定布局 | 已确认 | 无语义变化时重新打开或重新计算不会产生无意义的大幅跳动 | D01 |
| MVP-D05 | 局部修改时保护 Human Override | 已确认 | 新增 Node 后已有人工位置不被覆盖 | DEC-03、B06 |
| MVP-D06 | 自研 3D 图布局算法 | MVP 后 | 除非 2D 到 3D 映射验证失败，不进入 MVP | D03 |
| MVP-D07 | 支持 Spread Layout Constraint | 已确认 | 自动布局避开页边距和中央 Gutter；主路径、Alternative、External Input 和 Loop 可指定不同区域与方向 | A08、B12、D01 |
| MVP-D08 | 支持 Annotation Collision Check | 已确认 | Node Label、Edge Operation 和自由 Annotation 不与关键模型、Gutter 或彼此严重重叠；无法解决时给出警告 | A08、F15 |
| MVP-D09 | 支持主次 Route 层级 | 已确认 | 主演化路径三秒内可识别；Alternative 被视觉弱化并终止；Compounding Loop 明显但不压过主路径 | A08、B04、F11 |

### Epic E：Codex 与 MCP

| ID | 需求 | 状态 | MVP 验收意图 | 依赖 |
|---|---|---|---|---|
| MVP-E01 | 定义 `mcp-tools.schema.json` v0.1 | 已确认 | Tool 名称、输入、输出、错误和文件副作用均有契约 | B、C、D |
| MVP-E02 | 支持 Diagram 生命周期工具 | 已确认 | `create / load / save` 可在真实 Codex 会话中工作 | E01、B07 |
| MVP-E03 | 支持 Node 原子操作 | 已确认 | `create / update / delete` 均校验 ID 与 Type | E01、B03 |
| MVP-E04 | 支持 Edge 原子操作 | 已确认 | `connect / disconnect` 不产生悬空引用 | E01、B04 |
| MVP-E05 | 支持 Group / Phase Zone 原子操作 | 已确认 | 提供 `create_group / move_into_group` 或等价操作，支持 Golden Case 的四个 Phase Zone | B05 |
| MVP-E06 | 支持 Component Library 查询工具 | 已确认 | `search_components / get_component_definition` 可被 Agent 使用 | C03、C04 |
| MVP-E07 | 支持显式校验和自动布局工具 | 已确认 | Agent 可得到结构化错误；布局不依赖 Renderer | B01、D02 |
| MVP-E08 | 每次文件写入是安全、可恢复的原子操作 | 已确认 | Tool 失败不会留下损坏文件；错误中不泄露无关本地路径或数据 | B07 |
| MVP-E09 | Agent 不直接调用 Renderer-specific Tool | 已确认 | MCP 只表达 Diagram 意图；展示由 Workspace UI 消费 Artifact | F01 |
| MVP-E10 | 提供 Codex 本地安装与连接说明 | 已确认 | 新环境能按文档连接 MCP，并运行 Golden Case | E01-E09 |

### Epic F：Renderer、Workspace UI 与导出

| ID | 需求 | 状态 | MVP 验收意图 | 依赖 |
|---|---|---|---|---|
| MVP-F01 | 定义 Renderer Adapter 输入输出契约 | 已确认 | Adapter 只消费 Semantic Model、Effective Layout 和 Component Mapping | B、C、D |
| MVP-F02 | 完成 iCraft 程序化生成能力 Spike | 被验证阻塞 | 使用官方公开或官方授权接口，从机器生成场景并在 Player 中加载；禁止逆向实现 | 无 |
| MVP-F03 | 完成 iCraft 授权 / 产品边界确认 | 被验证阻塞 | 明确本产品是否允许使用其包、模型库和格式，以及开源或商业发布边界 | 无 |
| MVP-F04 | 实现 MVP Renderer Adapter | 已确认 | iCraft Spike 通过则使用 iCraft；否则实现本地 Reference Renderer，核心 MVP 不因外部能力失败而暂停 | MVP-D02、F02、F03、DEC-02 |
| MVP-F05 | 提供本地 Workspace UI | 已确认 | 可以创建或打开 `*.diagram.json`，查看并编辑 Scene Node、Route 和 Annotation，不依赖用户直接修改 JSON | F01、F04 |
| MVP-F06 | Workspace 支持选择和拖动 Scene Node | 已确认 | 拖动写入 Human Override；Route 自动跟随；具体变换自由度由 DEC-09 冻结 | DEC-03、DEC-09、B06、F05 |
| MVP-F07 | 缺少 Mapping 或资产时给出可见降级 | 已确认 | 通用形状保留语义与 Label；错误可定位到 Type | C05、F01 |
| MVP-F08 | 动画、相机路径、材质编辑与完整 3D Editor | MVP 后 | 首版只验证结构表达与基本浏览 | F05 |
| MVP-F09 | 提供稳定的正交等轴默认视图 | 已确认 | 同一 Diagram 重开后保持可复现的投影、方向与构图；提供平移、缩放和重置视图 | F01、F05 |
| MVP-F10 | 提供作品集画布构图能力 | 已确认 | 用户可以调整 Scene Node 的位置和视觉体量；画布支持足够留白，不把内容强制塞入均匀网格 | F05、F06 |
| MVP-F11 | 支持 Route 的视觉区分 | 已确认 | 至少能用颜色、实线 / 虚线和 Label 表达不同关系；节点移动后路径仍有效 | B04、F05 |
| MVP-F12 | 提供最小编辑器框架 | 已确认 | Workspace 包含主画布、文件操作、组件入口、选中态和属性检查；自然语言输入保留在 Codex，不重复内置聊天框 | DEC-11、F05 |
| MVP-F13 | 导出当前构图为 PNG | 已确认 | 导出范围、背景、分辨率和相机视图可预测；输出不修改原生 JSON | A07、F05、F09 |
| MVP-F14 | 支持 Undo / Redo | 已确认 | 拖动、缩放、旋转或样式调整可撤销，避免一次误操作破坏人工构图 | F05、F06 |
| MVP-F15 | 支持 Diagram Annotation | 已确认 | 至少支持 Node Label、Route Label 和自由文本标注；导出 PNG 时文字在目标尺寸下可读 | B03、B04、F05、F13 |
| MVP-F16 | 支持双 A4 横版 Spread 画布预设 | 已确认 | 显示页面边界、中央 Gutter 安全区和导出范围；关键内容不能跨越 Gutter | A08、B12、F05 |
| MVP-F17 | 支持已确认的直接操作集合 | 已确认 | 支持平面移动、垂直轴旋转、等比缩放、前后层级、Route 控制点、视图平移 / 缩放 / 旋转和等轴重置 | DEC-09、F05、F06、F14 |

### Epic G：端到端质量与交付

| ID | 需求 | 状态 | MVP 验收意图 | 依赖 |
|---|---|---|---|---|
| MVP-G01 | 为首发场景建立固定 Golden Case | 已确认 | 使用 `flovvas-massing-flowchart-case.md` 固定 Prompt、语义对象、版面约束、视觉规则和预期输出 | DEC-01、DEC-06 |
| MVP-G02 | Schema 与 Core 单元测试 | 已确认 | 合法、非法、悬空引用、重复 ID、版本错误均覆盖 | B |
| MVP-G03 | Component 搜索契约测试 | 已确认 | 首发用户的常用叫法能命中预期组件 | C02、C03 |
| MVP-G04 | Layout Fixture 测试 | 已确认 | 无重叠、方向正确、布局稳定、分组边界符合首发场景 | D01-D04 |
| MVP-G05 | Renderer 契约测试 | 已确认 | 同一 Artifact 可交给 Test Renderer；核心文件不因 Renderer 改变 | F01 |
| MVP-G06 | 真实 Codex → MCP → Artifact → Workspace E2E | 已确认 | 不使用手写中间 JSON 冒充 Agent 闭环 | E、F |
| MVP-G07 | 创建后再次修改的 Round-trip E2E | 已确认 | Agent 修改已有资产，未触及内容和 Override 保持稳定 | A03、B、E、F |
| MVP-G08 | 建立最小本地安装和卸载流程 | 已确认 | 用户能安装、连接、运行、移除，不依赖云账户完成核心闭环 | E10、F05 |
| MVP-G09 | 建立等轴视觉质量回归 | 已确认 | Golden Case 使用统一投影、语义模型、清晰路线与标注；PNG 在目标作品集尺寸下可读 | F09-F13、DEC-06 |
| MVP-G10 | 验收 Flovvas Massing 的叙事可读性 | 已确认 | 初读者能复述 linear chat → spatial thought → persistent knowledge → reusable context；移除大部分正文后仍能从形态变化理解主叙事 | A08、G09 |

---

## 6. 实施 Gate

### Gate 0：契约与 Fixture 冻结

产品范围、Golden Case、模型来源组合、编辑自由度和 Codex / Workspace 分工已经确认。工程首先冻结 Diagram Schema、Component Template Schema、Renderer Contract 与 Flovvas fixture。

通过条件：fixture 通过机器校验，所有引用可解析，且同一 Artifact 不依赖特定 Renderer。

### Gate 1：视觉纵切与 Renderer 决策

并行验证：

- 七个参数化状态是否达到作品集所需的语义辨识和视觉质感；
- 双 A4 Spread、路线和标注是否可读；
- iCraft 是否提供合法、稳定的程序化场景生成路径；
- 当前许可证是否允许本产品形态；
- 如果不可行，使用已确认可替换的本地 Reference Renderer。

通过条件：Golden Case 可导出一张作品集可用的完整跨页 PNG，并明确记录 Renderer `go / partial / no-go` 结论。

### Gate 2：Artifact 与 Core 可往返

完成 Schema、Core、Component Library 最小集和 Layout Adapter。

通过条件：固定 Fixture 可创建、保存、加载、修改、重排并保持合法。

### Gate 3：Workspace 手工编辑闭环

完成 Workspace UI、直接操作、路线与标注编辑、undo/redo、保存重开和 PNG 导出。

通过条件：目标用户无需编辑 JSON 即可完成 Golden Journey 的构图与导出步骤。

### Gate 4：真实 Agent 闭环

完成 MCP 与 Codex 集成。

通过条件：自然语言创建和修改都通过真实 E2E，不手工补中间文件，且不破坏无关 Human Override。

### Gate 5：干净环境验收

从干净安装完成 Codex 创建、Workspace 修正、Codex 再修改、保存重开与 PNG 导出。

通过条件：目标用户接受最终 PNG 进入真实作品集排版；Schema、引用、构建与测试全部通过。

---

## 7. 当前明确不进入 MVP

- 同时覆盖软件架构、产品流程、建筑体块等多个垂直组件库；
- 云同步、多人协作、账号、权限和在线文件管理；
- Marketplace 与社区组件生态；
- 用户可视化管理自定义 Component Definition；
- Embedding / 向量数据库；
- 多 Renderer 的正式产品支持；
- 完整 3D 建模器、顶点 / 面编辑、高级材质编辑、动画编排、相机路径编辑；
- 自研 Layout Algorithm；
- 逆向 `.iplayer` 文件格式或依赖未授权的 iCraft 内部接口；
- 首版自动迁移历史 Schema。

---

## 8. 下一轮需要用户决定的问题

### DEC-01. 首发用户任务——已确认

- 首发用户是用户本人；
- 使用情境是制作设计作品集；
- 首发 Diagram Family 是逻辑类图表，表达流程、步骤、因果、依赖和分组关系；
- 首版不同时建设软件架构和建筑体块等垂直组件库。

### DEC-02. iCraft 的约束级别——已确认

- iCraft 是当前首选 Renderer；
- iCraft 不是 MVP 的硬依赖；
- 如果其合法程序化能力或授权不可行，核心 MVP 可以切换到本地 Reference Renderer。

### DEC-03. 手动编辑范围——已确认

- MVP 必须能拖动 Node；
- 拖动结果必须保存为 Human Override；
- 首版位置、旋转、缩放、层级和路径编辑能力见 DEC-09。

### DEC-04. 正式资产的首版交付——已确认

- MVP 正式资产为原生 `*.diagram.json`；
- 本地 Workspace UI 负责查看和编辑；
- 首版 PNG 只是派生作品集图片；可恢复、可继续编辑的 HTML / PNG 便携资产不进入首版范围。

### DEC-05. 创建与修改——已确认

- Codex 负责自然语言创建、理解和语义修改；
- MVP 必须支持修改已有 Diagram，而不是只生成一次性结果；
- Workspace 的 Human Override 在语义修改后仍需保留。

### DEC-06. 视觉与语义 Golden Case——已确认

已确认参考方向为等轴 3D 流程 / 导览分析图，核心价值是空间层级、视觉隐喻与作品集质感。

语义 Golden Case 使用 `flovvas-massing-flowchart-case.md`：通过同一个 `card-slab` 原语的 SPLIT、EXTRACT、CONNECT、STORE、LAYER 和 RECOMBINE，表达 Flovvas 从线性对话到 Context Workspace 的演化。

### DEC-07. 3D 视觉价值——已确认


优先解决：

- 用深度和分层表达层级；
- 用语义化 3D 模型增强辨识度；
- 用独特构图、材质和光影提升作品集质感；

动画和镜头叙事暂不作为首要价值。

### DEC-08. PNG 派生输出——已确认

- 原生 JSON 是唯一正式资产；
- MVP 提供 PNG 导出，供作品集直接使用；
- PNG 不需要嵌入可恢复的 Diagram 数据。

### DEC-09. 手动编辑的变换自由度——已确认

首版操作集合：

- 在画布平面拖动位置；
- 绕垂直轴旋转模型；
- 等比缩放模型；
- 调整节点在构图中的前后层级；
- 调整 Route 的路径控制点；
- 平移、缩放或旋转整个观察视图。

### DEC-10. 3D 模型来源——已确认

采用组合方案：

- 产品内置合法、可再分发的基础 3D 原语和一小组模型；
- 用户导入 GLB / GLTF；
- 使用基础几何体作为 Fallback；
- iCraft 模型只在授权和接口允许时接入；
- AI 生成 3D 模型不进入 MVP。

Flovvas Golden Case 优先通过程序化组合 `card-slab` 完成，不等待复杂模型库。

### DEC-11. Codex 与 Workspace UI 的关系——已确认

- Codex 负责自然语言创建、理解和语义修改；
- `diagram.json` 是两个表面之间的事实接口；
- Workspace UI 负责模型选择、构图、拖动、标注和 PNG 导出；
- MVP 不在 Workspace UI 中重复建设 Agent 聊天入口。
