## TL;DR

把用户当前确认的构图导出为一张包含 3D 场景、路线和标注的双 A4 PNG，尺寸和视图可预测，可直接进入作品集排版。

## 问题/需求描述

编辑器里“看起来正确”不等于作品集可用。用户最终需要一个不带选择框、控制手柄或调试信息的稳定输出，并且能确认该图片对应哪一次保存状态。

## 当前行为

仓库中的模块图 HTML 可以导出自身作为规划图，但 Loom 产品尚没有从 Diagram Renderer 导出作品集 PNG 的能力。Golden fixture 已定义 594 × 210 mm 的双 A4 Composition，尚无产品级输出与回归验收。

## 期望行为

用户在 Workspace 中选择导出范围、分辨率和背景后，得到一张与当前 Effective Layout、视图和 revision 一致的 PNG。导出包含 3D 场景与完整 2.5D overlay，但不包含编辑器辅助 UI。

## 完成后的用户体验

1. 用户完成节点、路线和标注调整并保存。
2. 用户点击导出 PNG，确认完整 Spread、输出尺寸和背景。
3. 系统生成图片并说明实际尺寸、对应 revision 和可能的降级警告。
4. 用户直接把图片放进作品集排版，无需截图或手工拼接两页。

## 影响范围

| 文件或功能域 | 当前状态 |
|---|---|
| `examples/flovvas-massing.diagram.json` composition | 已定义双 A4 目标尺寸 |
| `contracts/renderer-contract.md` capturePng | 已定义输入输出边界 |
| Workspace 导出交互 | 尚无产品实现 |
| Golden PNG 质量回归 | 尚未建立 |

## 验收标准

- [ ] 支持导出完整双 A4 Spread，并能明确设置像素尺寸、pixel ratio 和背景。
- [ ] PNG 包含 Scene Node、Route、Phase Zone 和 Annotation。
- [ ] 默认隐藏选择框、变换手柄、safe area 辅助线和调试 UI。
- [ ] 导出结果返回实际尺寸、Artifact revision 和降级警告。
- [ ] 导出操作不修改 `diagram.json` 或 Human Override。
- [ ] 相同 revision 和导出设置产生一致的视图、尺寸与场景结构。
- [ ] Golden Case 在目标作品集尺寸下文字可读，中缝不破坏关键内容。
- [ ] 作者明确接受至少一张导出结果进入真实作品集排版。

## 非目标

- PNG 不承担恢复或继续编辑源数据的职责。
- MVP 不提供 PDF、视频、动画或便携交互 Viewer 导出。

## 关联

- Parent：#1。
- 依赖：#2 Golden Case、#6 Renderer、#7 Workspace。
- 被依赖：#10 端到端验收。
