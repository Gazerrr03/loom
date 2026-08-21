## TL;DR

把同一份 `diagram.json` 稳定呈现为具有空间层级、路线和标注的 2.5D 等轴场景，并允许在不迁移用户文件的情况下替换 Renderer。

## 问题/需求描述

Loom 的价值不只是把二维卡片加上立体阴影，而是让 3D 形态、空间位置、路线和注释共同承担叙事。Renderer 需要提供这种视觉表达，但不能成为正式资产或产品语义的所有者。

## 当前行为

仓库已有 Renderer Contract、Golden fixture 和模块图，但没有可运行的 Renderer Adapter、Reference Renderer、Template 几何实现或 2.5D overlay。iCraft 的程序化创建能力和产品授权也尚未验证。

## 期望行为

Renderer 接收 Core 生成的只读 RenderDocument，呈现 Scene Node、路线、Phase Zone 和 Annotation。Workspace 的拖动只在 Renderer 中预览，提交后才由 Core 写入 Human Override。Reference Renderer 保证主路径可交付；iCraft 只有在能力和授权都通过时作为可替换 Adapter 进入。

## 完成后的用户体验

1. Workspace 打开 Diagram 后显示稳定的正交等轴场景。
2. 七个主阶段仅看形态也能感知从线性流到复利工作台的演化。
3. 用户 pan、zoom 或 orbit 后，路线和标注仍与目标对齐。
4. 缺失模板或资产时，用户看到明确 fallback 或错误，不会出现无提示的空节点。

## 影响范围

| 文件或功能域 | 当前状态 |
|---|---|
| `contracts/renderer-contract.md` | Adapter v0.1 契约草案已存在 |
| `examples/flovvas-massing.diagram.json` | Golden RenderDocument 来源已存在 |
| Reference Renderer | 尚无应用代码 |
| iCraft Adapter | 被程序化能力与授权验证阻塞 |
| 2.5D Route / Annotation overlay | 尚未实现 |

## 验收标准

- [ ] Adapter 在加载前声明并检查 projection、component、interaction、asset 和 export 能力。
- [ ] Golden Case 七个主阶段具有可辨认的形态演化，并保持同一 `card-slab` 家族感。
- [ ] 正交等轴视图、光照、阴影和视觉 token 不写入 Renderer 私有正式资产。
- [ ] 路线、Phase Zone 和 Annotation 在视图变化后仍正确对齐。
- [ ] 拖动预览不修改 Artifact；提交后只产生相应字段的 Human Override。
- [ ] 缺失能力、模板或资产时返回结构化错误或显式 fallback，不静默丢内容。
- [ ] Reference Renderer 可以独立完成 Golden Case，不依赖 iCraft。
- [ ] 如果接入 iCraft，更换 Adapter 时无需迁移 `diagram.json`。

## 决策点

- [ ] iCraft 程序化能力与授权均获得证据后，决定它是 MVP Adapter 还是仅保留为后续路径；该决定不得阻塞 Reference Renderer。

## 非目标

- 不实现完整 3D Editor、材质编辑器、动画时间线或视频导出。
- 不逆向 `.iplayer` 或使用未获授权的内部接口。

## 关联

- Parent：#1。
- 依赖：#2、#3、#4、#5。
- 被依赖：#7 Workspace、#9 PNG 导出、#10。

## 原子 Sub-issues

- #31 `M4-01` 渲染输入：定义 RenderDocument 的解析结果
- #32 `M4-02` 能力协商：定义 Adapter 加载前的能力声明与缺失处理
- #33 `M4-03` 场景投影：定义 Template、Layout 到 Scene Node 的可见投影
- #34 `M4-04` 覆盖层：定义 Route、Phase Zone 与 Annotation 的跟随关系
- #35 `M4-05` 预览提交：定义交互预览与 Domain Command 提交边界
- #36 `M4-06` 参考渲染：让 Reference Renderer 通过 Golden Case 视觉纵切
- #37 `M4-07` iCraft 验证：记录 iCraft 程序化能力与授权结论
