## TL;DR

建立唯一的 Flovvas Golden Case，让产品、设计和工程使用同一张题目判断语义是否正确、构图是否可读、最终 PNG 是否达到作品集质量。

## 问题/需求描述

如果没有固定案例，不同模块可能分别实现“合理”的数据、布局和渲染，但最后无法组成一张真正可用的作品集图。MVP 需要一份稳定的输入、预期语义和人工质量标准，作为所有模块共同的验收基线。

## 当前行为

仓库已经提供产品语义文档、Golden Diagram fixture 和模块图，但还没有可自动执行的结构断言、视觉基线与统一验收记录。当前材料可以用于讨论，尚不能独立回答一次工程改动是否破坏了 Golden Case。

## 期望行为

任何开发者或 Agent 都能从仓库中找到唯一的 Golden Case，运行结构校验并生成同一目标画布。作者能按照固定清单判断七个主阶段是否可辨认、主叙事是否清楚，以及最终 PNG 是否可以进入作品集。

## 完成后的用户体验

1. 作者打开 Golden Case，看到 LINE → WORKBENCH 的七阶段演化。
2. 即使减少大部分解释文字，仍能从空间形态辨认主叙事顺序。
3. 作者能明确给出“接受进入作品集 / 继续修正 / 改变模型策略”的判断。

## 影响范围

| 文件或功能域 | 当前状态 |
|---|---|
| `flovvas-massing-flowchart-case.md` | 已定义完整语义、页面和视觉约束 |
| `examples/flovvas-massing.diagram.json` | 已编码 7 个主阶段、3 条替代路径、5 个输入和 1 个回路 |
| `diagrams/loom-mvp-module-map.html` | 已说明 Golden Case 对全链路的约束关系 |
| Golden Case 测试与验收记录 | 尚未建立 |

## 验收标准

- [ ] 唯一 fixture 包含 7 个主阶段、6 个主转化、4 个 Phase Zone、3 条 Alternative、5 个 External Input 和 1 个 Compounding Loop。
- [ ] 画布固定为 594 × 210 mm，并显式表达两页边界和 10–14 mm gutter safe zone。
- [ ] fixture 通过 Schema、重复 ID 和悬空引用校验。
- [ ] 建立结构验收、布局验收、视觉辨认和作品集质量四类检查项。
- [ ] 视觉验收记录包含作者结论和被审查的 Artifact revision。
- [ ] 后续模块 Issue 均引用该 Golden Case，而不是各自创建替代样例。

## 非目标

- 不在本模块实现完整 Renderer 或 Workspace。
- 不扩展到软件架构、建筑体块等其他 Diagram Family。

## 关联

- 依赖：无。
- 被依赖：M1–M8。
