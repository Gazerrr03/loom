## TL;DR

提供一个可见的 Workspace，让用户不编辑 JSON 就能选择模型、调整节点、路线和标注，并用 Undo/Redo 安全完成作品集构图。

## 问题/需求描述

自动布局只能生成草稿，作品集构图仍需要人的空间判断和视觉取舍。如果缺少直接操作界面，用户只能修改坐标或依赖 Agent 猜测，无法高效完成模型选择、留白、层级和标注等细节。

## 当前行为

仓库已有 Workspace 的产品边界、交互范围和 Renderer Contract，但没有可运行的应用界面。当前无法从 UI 打开 Diagram、选择 Scene Node、预览变换、提交 Human Override 或执行 Undo/Redo。

## 期望行为

用户可以在一个由主画布、Component 入口和 Inspector 组成的 Workspace 中查看并编辑 Diagram。交互感觉参考 iCraft 的直接操控，但所有正式修改通过 Domain Command 写回 `diagram.json`，不依赖 iCraft 私有状态。

## 完成后的用户体验

1. 用户打开 `*.diagram.json`，立即看到完整等轴场景和文件状态。
2. 用户选中节点，在画布中移动、绕 Y 轴旋转、等比缩放、调整 elevation 或前后层级。
3. 用户编辑路线控制点、Route Label 和自由标注。
4. 每次完整手势只形成一个可撤销操作；保存重开后结果保持一致。
5. 用户可以搜索、预览并替换 Component Template。

## 影响范围

| 文件或功能域 | 当前状态 |
|---|---|
| `diagrams/loom-mvp-module-map.html` | 已定义 Workspace 在闭环中的职责 |
| 产品核心文档中的 Workspace 操作集合 | 已确认 |
| Workspace 应用壳层 | 尚无应用代码 |
| 直接操作与历史记录 | 尚未实现 |

## 验收标准

- [ ] 支持创建、打开、保存、另存和重新打开 Diagram。
- [ ] 主界面至少包含画布、Component 入口、选中状态、Inspector 和文件状态反馈。
- [ ] 支持节点平面移动、Y 轴旋转、等比缩放、elevation 和前后层级调整。
- [ ] 支持画布 pan、zoom、orbit 和一键 reset isometric；重置视图不改变节点构图。
- [ ] 支持路线控制点、Route Label、对象关联标注和自由文本标注。
- [ ] 拖动期间实时预览，松手后只提交一个 Domain Command。
- [ ] Node、Route、Annotation 和 Template 替换均可 Undo/Redo。
- [ ] 保存重开后 Human Override 保持一致，未保存状态和错误对用户可见。

## 非目标

- Workspace 不重复建设 Agent 聊天入口，自然语言交互保留在 Codex。
- 不在 MVP 中提供完整网格建模、材质编辑或动画编辑。

## 关联

- Parent：#1。
- 依赖：#3 Diagram Artifact、#4 Component Template、#5 Layout、#6 Renderer。
- 被依赖：#9 PNG 导出、#10 端到端验收。
