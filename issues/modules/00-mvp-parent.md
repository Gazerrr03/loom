## TL;DR

完成一条从自然语言到作品集图片的真实闭环：作者通过 Codex 创建或修改逻辑图，在 Workspace 中直接调整 2.5D 等轴构图，并以 `diagram.json` 保存可继续编辑的源资产、以 PNG 交付作品集结果。

## 概述

传统二维流程图主要依靠矩形卡片和连线表达关系，难以承载空间层级、3D 视觉隐喻和作品集需要的构图质感。Loom MVP 首先服务作者本人制作设计作品集中的逻辑分析图，并用 Flovvas Massing 作为唯一 Golden Case。

MVP 有两个协作表面：Codex 负责自然语言创建、理解和语义修改；Workspace UI 负责模型选择、构图、直接操作、标注和 PNG 导出。两者通过同一份 Renderer-independent 的 `diagram.json` 协作。

## 完成后的完整交互

1. 作者向 Codex 描述一张逻辑分析图。
2. Codex 创建经过校验的 `diagram.json`，并生成可编辑的初始构图。
3. Workspace 打开同一文件，显示 2.5D 等轴场景。
4. 作者拖动、旋转、缩放节点，调整层级、路线和标注，并保存 Human Override。
5. 作者再次让 Codex 修改语义，无关的手工构图保持不变。
6. 作者导出包含场景、路线和标注的双 A4 PNG，并将其用于真实作品集排版。

## 子模块总览

| 模块 | 完成后实现的结果 | 主要依赖 |
|---|---|---|
| #2 · M0 Golden Case | 团队使用同一案例和质量标准判断结果是否成立 | 无 |
| #3 · M1 Diagram Artifact | 图可以安全创建、保存、校验和重新打开 | #2 |
| #4 · M2 Component Template | Codex 与 Workspace 能按语义找到并替换 3D 形态 | #2、#3 |
| #5 · M3 Layout & Composition | 自动生成双 A4 构图，并保留用户手工调整 | #2、#3 |
| #6 · M4 Renderer | 同一图文件可被呈现为可替换的 2.5D 等轴场景 | #2、#3、#4、#5 |
| #7 · M5 Workspace UI | 用户能直接编辑节点、路线和标注，并撤销重做 | #3、#4、#5、#6 |
| #8 · M6 Codex / MCP | 用户能用自然语言创建和修改已有 Diagram | #3、#4、#5 |
| #9 · M7 PNG 导出 | 当前构图能输出为作品集可用 PNG | #2、#6、#7 |
| #10 · M8 端到端验收 | 干净环境可重复完成创建、编辑、再修改和导出 | #2–#9 |

## 整体验收标准

- [ ] M0–M8 九个模块 Issue 全部关闭。
- [ ] 从真实 Codex 请求开始创建 Diagram，不以手写完成品代替 Agent 闭环。
- [ ] Workspace 无需用户编辑 JSON 即可完成构图调整。
- [ ] 保存、关闭并重新打开后，语义与 Human Override 保持一致。
- [ ] Codex 修改已有 Diagram 时不覆盖无关的 Human Override。
- [ ] iCraft 不可用或未获授权时，Reference Renderer 仍能完成主闭环。
- [ ] Flovvas Golden Case 的双 A4 PNG 被作者接受进入作品集排版。

## 明确不在 MVP 内

- 多人实时协作、账号、权限和云同步。
- 通用 CAD / DCC 网格建模。
- AI text-to-3D 资产生成。
- 组件市场、动画时间线和视频导出。
- 与 iCraft 私有文件格式双向无损转换。

## 项目依据

- `diagrams/loom-mvp-module-map.html`
- `AI Native 3D Diagram Workspace 产品核心设计文档.md`
- `AI Native 3D Diagram Workspace MVP 需求池.md`
- `AI Native 3D Diagram Workspace MVP 实施计划文档.md`
- `examples/flovvas-massing.diagram.json`
