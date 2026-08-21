## TL;DR

让 Codex 和 Workspace 能根据“分岔探索”“知识归档”“复利工作台”等语义找到、预览并替换合适的 3D 形态，而不要求用户或 Agent 理解 mesh 和建模代码。

## 问题/需求描述

传统流程图节点大多只能显示为通用矩形。Loom 要让形态承载语义，同时又要避免把产品语义绑定在某个 Renderer 的场景实现中。Component Template 必须成为语义、参数、资产和 Renderer Mapping 之间的稳定接口。

## 当前行为

仓库已有 Component Template Schema 和一个 Workbench 示例 Manifest，但还没有可查询的组件目录、七个 Golden Template、Workspace 预览入口或资产缺失时的运行时 fallback。

## 期望行为

Codex 可以按自然语言与节点类型查询模板，并看到匹配原因和可调参数；Workspace 可以搜索、预览和替换模板。缺少某个 Renderer Mapping 或模型文件时，Diagram 保留语义并显示明确 fallback，而不是丢失节点。

## 完成后的用户体验

1. 用户选中一个表达“知识归档”的节点。
2. Workspace 显示语义匹配的 3D Template 及预览，而不是一份无解释的模型文件列表。
3. 用户替换 Template 后立即看到视觉预览，并能撤销。
4. Codex 也能使用相同的组件定义创建或修改该节点。

## 影响范围

| 文件或功能域 | 当前状态 |
|---|---|
| `contracts/component-template.schema.json` | v0.1 Schema 草案已存在 |
| `examples/flovvas-workbench.component.json` | 单个 Manifest 示例已存在 |
| Component 查询与解析 | 尚无应用代码 |
| Golden Case 七个 Template | 尚未完整实现 |
| GLB/GLTF 导入与 fallback | 尚未实现 |

## 验收标准

- [ ] Golden Case 七个阶段均有可校验的 Component Template。
- [ ] 同一个 `card-slab` 可以通过参数表达 LINE、BRANCH、CARD、FIELD、ARCHIVE、CONTEXT 和 WORKBENCH 的家族关系。
- [ ] 可按节点类型、语义描述、搜索词和能力查询组件，并返回匹配理由与参数说明。
- [ ] Workspace 与 Codex 查询到的是同一份 Component Definition。
- [ ] 用户替换组件后，节点稳定 ID 和语义关系保持不变。
- [ ] Renderer Mapping 缺失或资产不可用时显示明确 fallback 和可定位警告。
- [ ] 用户导入 GLB/GLTF 时记录稳定引用和授权信息，不把大型二进制直接写入 JSON。

## 非目标

- 不建设组件市场或社区发布流程。
- 不提供通用 3D 网格建模器。
- 不在 MVP 中生成 AI text-to-3D 资产。

## 关联

- Parent：#1。
- 依赖：#2 Golden Case、#3 Diagram Artifact。
- 被依赖：#6 Renderer、#7 Workspace、#8 Codex / MCP、#10。

## 原子 Sub-issues

- #21 `M2-01` 模板身份：定义 Component Template 的语义身份与检索字段
- #22 `M2-02` 参数契约：定义模板参数、默认值与参数校验
- #23 `M2-03` 渲染映射：定义模板能力、Renderer Mapping 与 fallback
- #24 `M2-04` 资产引用：定义内置原语、用户模型与授权元数据的引用
- #25 `M2-05` 状态模板：固定 Flovvas 七个阶段的参数化模板集合
