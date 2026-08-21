# GitHub MVP 模块 Issue 正文

本目录保存 GitHub Parent Issue 与 M0–M8 模块 Sub-issue 的可审查正文。远端 Issue 是协作和状态事实源；这里的文件保留初始问题定义，便于代码审查和仓库内检索。

## 标题与正文原则

- 标题直接说明模块完成后实现的用户交互或可观察结果。
- TL;DR 让维护者在十秒内判断 Issue 的价值和边界。
- “当前行为”只描述仓库已验证状态，不把规划写成已经实现。
- “期望行为”和“验收标准”描述结果，不预设具体实现方案。
- 模块 Issue 是可继续拆原子 Issue 的交付容器，不要求一次提交完成整个模块。

## 文件映射

- `00-mvp-parent.md`：MVP Parent Issue
- `m0-golden-case.md`：Golden Case 与质量标准
- `m1-diagram-artifact.md`：Diagram Artifact 与 Core
- `m2-component-template.md`：Component Template 与资产
- `m3-layout-composition.md`：Layout、Composition 与 Human Override
- `m4-renderer.md`：Renderer 与 2.5D 视觉系统
- `m5-workspace-ui.md`：Workspace UI 与直接操作
- `m6-codex-mcp.md`：Codex / MCP 语义协作
- `m7-png-export.md`：PNG 与作品集交付
- `m8-e2e-acceptance.md`：安装、恢复与端到端验收
