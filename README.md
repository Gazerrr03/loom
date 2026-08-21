# Loom MVP Planning Package

Loom 的 MVP 目标是：通过 Codex 创建或语义修改一张 2.5D 等轴逻辑图，在 Workspace UI 中完成模型选择、构图、拖动与标注，并以 `diagram.json` 为正式资产、PNG 为作品集派生输出。

## 阅读顺序

1. `diagrams/loom-mvp-module-map.html`：先用一张图理解 M0–M8 如何围绕 `diagram.json` 运作。
2. `AI Native 3D Diagram Workspace 产品核心设计文档.md`：产品是谁、服务谁、为什么成立，以及长期稳定的数据边界。
3. `AI Native 3D Diagram Workspace MVP 需求池.md`：已确认需求、MVP 后需求和被外部验证阻塞的事项。
4. `AI Native 3D Diagram Workspace MVP 实施计划文档.md`：Gate、Golden Journey、停止条件和验收顺序。
5. `issues/modules/`：准备发布到 GitHub 的一个 Parent Issue 与 M0–M8 模块 Sub-issue 正文。
6. `issues/MVP 原子 Issue 规划.md`：模块通过后继续向下拆分的 21 个原子 Issue 草案。
7. `issues/atomic/README.md`：M0–M8 下一层的 45 个统一抽象原子 Issue 目录。

## Gate 0 契约

- `contracts/diagram.schema.json`：正式 Diagram Artifact 的 JSON Schema 2020-12 契约。
- `contracts/component-template.schema.json`：Scene Template 的语义、参数、能力与 Renderer Mapping 契约。
- `contracts/renderer-contract.md`：可替换 Renderer Adapter 的责任和交互边界。
- `examples/flovvas-massing.diagram.json`：Flovvas Massing Golden Case fixture。
- `examples/flovvas-workbench.component.json`：Component Template 示例。

## 当前状态

- 产品用户、Diagram Family、两个协作表面、Human Override、原生 JSON、PNG 输出和模型来源组合已确认。
- Gate 0 草案已经落地并通过 JSON Schema 与引用完整性校验。
- iCraft 仍是首选但可替换的路径；程序化能力和授权是并行 spike，不阻塞参考 Renderer。
- 下一步是审查 Gate 0 契约，然后执行 Gate 1 视觉纵切。

## 发布边界

当前目录不是 Git 仓库，Issue 只是本地草案，没有创建远端 Issue、分支或 PR。发布前需要确定目标仓库、分支和 label 体系。
