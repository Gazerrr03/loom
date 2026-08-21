## TL;DR

让用户拥有一份可信赖的 `diagram.json`：可以创建、校验、保存、关闭并重新打开，失败操作不会损坏已有图。

## 问题/需求描述

Codex 与 Workspace 必须修改同一种正式资产，否则自然语言生成、手工构图和重新打开会成为彼此断裂的流程。Diagram Artifact 还必须与具体 Renderer 解耦，避免未来更换 iCraft 或 Reference Renderer 时导致用户文件失效。

## 当前行为

仓库已有 `diagram.schema.json` 和一份通过 Schema 校验的 Golden fixture，但没有可运行的 Diagram Core。当前无法通过产品入口创建文件、执行引用完整性校验、原子保存或完成 load/save round-trip。

## 期望行为

Codex 和 Workspace 都通过 Diagram Core 读取或修改同一份文件。Core 拒绝无效结构，所有成功修改保持稳定 ID 和引用完整性；保存失败时原文件仍然可以打开。

## 完成后的用户体验

1. 用户创建或打开一个 `*.diagram.json`。
2. 系统在进入编辑状态前完成校验，并用可理解的信息指出错误对象和字段。
3. 用户保存、关闭再打开后，节点关系、页面构图和 Human Override 保持一致。
4. Renderer 更换不会要求用户迁移或重新制作 Diagram。

## 影响范围

| 文件或功能域 | 当前状态 |
|---|---|
| `contracts/diagram.schema.json` | v0.1 Schema 草案已存在 |
| `examples/flovvas-massing.diagram.json` | 正例 fixture 已存在 |
| Diagram Core / 文件生命周期 | 尚无应用代码 |
| 无效 fixture 与 round-trip 测试 | 尚未建立 |

## 验收标准

- [ ] 支持创建、加载、校验、保存和另存 `*.diagram.json`。
- [ ] duplicate ID、dangling reference、未知 Schema 版本和非法 Human Override 会被拒绝，并返回可定位的错误。
- [ ] 保存中断或校验失败不会覆盖最后一份合法文件。
- [ ] 成功保存会更新可追踪的 revision 或更新时间。
- [ ] Golden fixture 完成 load → save → reload 后语义和布局一致。
- [ ] Generated Layout 与 Human Override 独立保存，并能生成字段级 Effective Layout。
- [ ] Artifact 中不存在 Renderer 私有 mesh、camera runtime 或材质实例状态。

## 非目标

- 不实现云同步、多人版本管理或账号权限。
- 首版不自动迁移未来未知的 Schema 版本。

## 关联

- 依赖：M0 Golden Case。
- 被依赖：M2、M3、M4、M5、M6、M8。
