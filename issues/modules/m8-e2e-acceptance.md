## TL;DR

在干净环境中完整走通“Codex 创建 → Workspace 手工构图 → Codex 再修改 → 保存重开 → PNG 导出”，证明 MVP 是可重复使用的产品，而不是当前电脑上的一次演示。

## 问题/需求描述

各模块分别通过测试，不代表两个协作表面能围绕同一 Artifact 往返工作。MVP 还必须排除依赖开发者缓存、手工补中间文件或特定 Renderer 私有状态造成的假成功。

## 当前行为

仓库目前是产品规划与工程契约包，没有可安装的应用、MCP Server 或端到端测试。Golden fixture 能通过 Schema 与引用检查，但不能代表真实用户旅程已经成立。

## 期望行为

一个新的本地环境可以按文档安装并启动 Core、Workspace、Renderer 与 MCP。测试从真实自然语言请求开始，经过多次 Codex / Workspace 往返后仍保持合法 Artifact，并输出被作者接受的作品集 PNG。

## 完成后的用户体验

1. 用户在新环境完成安装和 Codex 连接。
2. 用户从自然语言创建 Golden Case，而不是复制完成好的 fixture。
3. 用户在 Workspace 中调整节点、路线和标注，保存并重新打开。
4. 用户让 Codex 修改一个阶段或关系，无关手工构图保持不变。
5. 用户完成至少三次往返并导出最终 PNG。

## 影响范围

| 文件或功能域 | 当前状态 |
|---|---|
| `AI Native 3D Diagram Workspace MVP 实施计划文档.md` | 已定义 Golden Journey 与 Gate 5 |
| M0–M7 模块 | 尚未实现和集成 |
| 安装、启动和卸载说明 | 尚未建立 |
| 端到端与干净环境验证 | 尚未建立 |

## 验收标准

- [ ] 从干净环境完成安装、启动、Codex 连接和卸载说明验证。
- [ ] E2E 从真实 Codex 请求创建 Diagram，不用手写中间 JSON 冒充 Agent 结果。
- [ ] Workspace 完成节点变换、路线、标注和 Undo/Redo 操作。
- [ ] 保存、关闭并重新打开后，语义与 Human Override 保持一致。
- [ ] Codex 修改已有 Diagram 时不覆盖无关 Override。
- [ ] 三次 Codex ↔ Workspace 往返后，Schema、稳定 ID 和引用完整性仍通过。
- [ ] iCraft 不可用时，Reference Renderer 能完成全部验收步骤。
- [ ] 构建、契约测试、Core 测试、Renderer 测试、Workspace 测试和 MCP 测试通过。
- [ ] 最终双 A4 PNG 通过 M0 质量标准，并被作者接受进入作品集排版。

## 非目标

- 不以单元测试、手工修改 fixture 或开发环境截图代替真实 E2E。
- 不把未来的云同步、多人协作和便携 Viewer 纳入 MVP 关闭条件。

## 关联

- 依赖：M0–M7 全部模块。
- 关闭本 Issue 后，MVP Parent Issue 才具备关闭条件。
