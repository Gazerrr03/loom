# Workspace 文件往返验收（Issue #125）

这条验收只验证浏览器中的原生 JSON 往返，不引入云端文件系统，也不把 GLB 二进制写进 `diagram.json`。

## 启动环境

在仓库根目录执行：

```sh
python3 -m http.server 18772
```

然后打开：

```text
http://127.0.0.1:18772/workspace/
```

## 可重复步骤

1. 点击「载入 Golden Case」，选择 `stage-line`，在 Inspector 将「绕 Y 轴旋转」改为 `18` 并离开字段。
2. 确认状态栏显示 `dirty`，点击「保存」，在浏览器下载目录找到 `flovvas-massing.diagram.json`。
3. 点击「打开 Diagram」，选择刚下载的 JSON。
4. 确认状态回到 `ready`，`stage-line` 的旋转值仍为 `18`，路线、标注和其他 semantic IDs 仍存在。
5. 通过浏览器控制台记录以下比较结果：

   ```js
   const state = window.LoomWorkspace.getState();
   const overrides = state.artifact.layout.overrides;
   const semanticIds = {
     nodes: state.artifact.semantic.nodes.map(({ id }) => id),
     edges: state.artifact.semantic.edges.map(({ id }) => id),
     annotations: state.artifact.annotations.map(({ id }) => id),
   };
   console.table({
     revision: state.revision,
     rotationYDeg: overrides.nodes["stage-line"]?.rotationYDeg,
     semanticIds: JSON.stringify(semanticIds),
     glbBytesEmbedded: JSON.stringify(state.artifact).includes("glbBytes"),
   });
   ```

预期：`rotationYDeg` 为 `18`，semantic ID 列表与保存前一致，`glbBytesEmbedded` 为 `false`，且 `revision` 是可追踪的非空值。

## 本次浏览器冒烟记录

2026-08-25，在 `codex/issue-125` 工作树以 `localhost:18773` 执行：

- 修改 `stage-line` 的 `rotationYDeg` 为 `18`，状态为 `dirty`，保存下载 `flovvas-massing.diagram.json`，保存 receipt revision 为 `sha256:310f8c85e25ef4ac93bb34c9e23ed73707057c388f80b54150327edbf408a48b`。
- 重新打开该下载文件后状态为 `ready`、`dirty=false`、`rotationYDeg=18`；semantic IDs 为 15 nodes、15 edges、4 annotations，`glbBytesEmbedded=false`。
- 选择无效 `README.md` 后状态为 `error · 文件无效`，原 Diagram 和旋转值仍保留；触发选择器取消后状态为 `ready · 已取消打开 · 当前 Diagram 未改变`，草稿仍保留。
- `node --test`：230 passed / 0 failed；`git diff --check`：通过。

## 失败路径

- 在文件选择器点击取消：状态显示「已取消打开 · 当前 Diagram 未改变」，当前草稿和 dirty 状态不变。
- 选择格式错误或无效 JSON：状态显示「文件无效」，当前合法草稿仍可继续保存或编辑。
- 文件读取失败：状态显示「文件读取失败」，当前合法草稿仍保留。

## 证据边界

本验收证明浏览器下载与原生 JSON 重新打开的本地闭环；不证明真实 Codex runtime、远程文件系统、iCraft 授权 fixture 或作者对最终 PNG 的视觉验收。
