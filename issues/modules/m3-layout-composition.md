## TL;DR

从语义关系生成一张可继续修正的双 A4 等轴构图草稿；用户拖动或调整后的字段被保存，后续重新布局不会覆盖人的视觉判断。

## 问题/需求描述

通用流程图布局通常只关注节点不重叠，不能直接满足作品集中的主对角线、页面留白、中缝安全区和主次路线层级。另一方面，完全手工排版又失去 Agent 快速生成初稿的价值。

## 当前行为

Golden fixture 已手工记录双 A4 页面、safe area、节点位置和示例 Human Override，但还没有可运行的布局能力、碰撞检查、局部重排或 Generated Layout 与 Human Override 的字段级合并逻辑。

## 期望行为

系统先根据语义和页面约束生成稳定初稿。用户在 Workspace 中修改位置、旋转、缩放或路线后，只覆盖相应字段；新增节点或重新布局时，其余可生成字段继续更新，已经确认的人工构图保持不变。

## 完成后的用户体验

1. 用户创建 Golden Case 后，立即看到从左下向右上推进的双页构图草稿。
2. 关键节点、标题和标注避开中央 gutter。
3. 用户只调整某个节点的横向位置，后续重新布局仍可更新它未被覆盖的其他字段。
4. 用户可以清除某个对象的人工调整，让它重新回到自动布局。

## 影响范围

| 文件或功能域 | 当前状态 |
|---|---|
| `contracts/diagram.schema.json` 的 composition/layout | 已定义数据边界 |
| `examples/flovvas-massing.diagram.json` | 已提供手工 Golden 布局 |
| Layout 生成、碰撞检查和局部重排 | 尚无应用代码 |
| Human Override 合并 | 只有契约，没有运行实现 |

## 验收标准

- [ ] Golden Case 自动初稿的主叙事顺序与 LINE → WORKBENCH 一致。
- [ ] 双 A4 页面、页边距和 10–14 mm gutter safe zone 被布局过程尊重。
- [ ] Main Flow、Alternative、External Input 与 Compounding Loop 能使用不同区域或层级约束。
- [ ] 相同输入和 seed 产生稳定布局，不发生无语义原因的大幅跳动。
- [ ] Generated Layout 与 Human Override 按字段合并；覆盖 `x` 不会冻结 `y`、scale 等其他字段。
- [ ] 支持清除单字段、单对象和整图 Override。
- [ ] 节点、关键标注或路线无法避碰时给出可定位警告，而不是静默重叠。

## 非目标

- 不承诺一次自动生成就达到最终作品集构图。
- 在成熟布局能力未被 Golden Case 证明不足前，不自研通用 3D 图布局算法。

## 关联

- Parent：#1。
- 依赖：#2 Golden Case、#3 Diagram Artifact。
- 被依赖：#6 Renderer、#7 Workspace、#8 Codex / MCP、#10。
