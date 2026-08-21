## TL;DR

让用户能通过 Codex 自然语言创建和修改已有 Diagram；Codex 操作的是节点、关系、阶段和构图意图，而不是低层 3D mesh 或屏幕坐标。

## 问题/需求描述

如果 Codex 只能远程点击或移动坐标，它只是另一种鼠标。AI-native 的价值在于理解用户想表达的产品逻辑，并通过受约束的语义操作安全修改正式 Artifact，同时尊重用户已经完成的视觉构图。

## 当前行为

仓库已定义 Codex / MCP 的产品职责和预期工具边界，但没有可运行的 MCP Server 或真实 Codex 集成。当前只能手工编辑 Golden fixture，不能从自然语言请求生成或修改 Diagram。

## 期望行为

Codex 可以创建、打开、摘要、校验和保存 Diagram，查询 Component Template，增删改 Node、Edge、Group 和 Annotation，并请求保留 Human Override 的重新布局。批量修改在提交前提供可理解的 dry-run 摘要，并作为一个事务执行。

## 完成后的用户体验

1. 用户说“把 Flovvas 从线性对话演化到复利工作台画成一张等轴分析图”。
2. Codex 创建结构完整的 Diagram，并说明选择了哪些阶段和组件。
3. 用户再说“让 Branch 更像并行探索，并增加一个外部文件输入”。
4. Codex 预览将修改的对象，确认后提交；Workspace 重载后显示结果。
5. 未被这次请求涉及的手工位置、路线和标注保持不变。

## 影响范围

| 文件或功能域 | 当前状态 |
|---|---|
| 产品核心文档中的 MCP Tool 边界 | 已定义 |
| `contracts/diagram.schema.json` | 可作为 Tool 操作的数据约束 |
| Component 查询与 Domain Command | 尚无运行实现 |
| MCP Server / Codex 连接 | 尚未建立 |

## 验收标准

- [ ] 支持 Diagram 的 create、open、summarize、validate、save 和 layout 请求。
- [ ] 支持查询 Component Template，并返回匹配原因、参数与可用能力。
- [ ] 支持 Node、Edge、Group 和 Annotation 的创建、修改与删除，操作后不存在悬空引用。
- [ ] 批量语义修改在提交前返回 dry-run 摘要，提交后作为一个事务记录。
- [ ] 默认只修改语义和构图意图；只有用户明确要求精确位置时才修改坐标 Override。
- [ ] 修改已有 Diagram 时，无关的 Human Override 保持不变。
- [ ] 失败结果包含对象 ID、字段路径、原因、是否可恢复和建议动作，不泄露无关本地路径或凭证。
- [ ] 在真实 Codex 会话中完成一次从零创建和一次已有 Diagram 修改。

## 非目标

- 不在 Workspace 内嵌第二个 Agent Chat。
- Codex 不直接调用 Renderer-specific Tool 或编辑 Renderer Scene。

## 关联

- Parent：#1。
- 依赖：#3 Diagram Artifact、#4 Component Template、#5 Layout。
- 与 #7 Workspace 可并行推进，最终在 #10 汇合。
- 被依赖：#10 端到端验收。

## 原子 Sub-issues

- #43 `M6-01` 工具信封：定义 MCP Tool 输入、输出与错误的统一结构
- #44 `M6-02` 生命周期工具：定义 Diagram 创建、打开、校验与保存工具
- #45 `M6-03` 组件查询：定义按语义查询和读取 Component Template 的工具
- #46 `M6-04` 语义命令：定义 Node、Edge、Group、Annotation 的原子修改
- #47 `M6-05` 修改事务：定义 dry-run、提交和 Override 保留的语义边界
