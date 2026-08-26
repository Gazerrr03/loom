# Candidate Harness — #133 Diagram → World coordinate contract

状态：candidate。它记录本轮可重复验证的不变量，不是已升格的 `formal/` 规范。

## 目的

确认 Loom 的正式 `diagram.json` 保持 Renderer-independent 的 Diagram 坐标，
而所有需要世界坐标的消费者都通过同一个适配器解释它：

- Diagram `x` → world `X`
- Diagram `y` → world `Z`
- optional `elevation` → world `Y`
- 缺少 `elevation` 时 world `Y = 0`

`composition.unit` 是数值语义来源；Workspace 的 pan、orbit、camera 和最终
屏幕缩放是运行时状态，不写回 Artifact。

## 必须保持的断言

1. Node、Route point、Group footprint 和 Annotation anchor/offset 都保留
   Diagram `x/y`；Node 和 Route point 可按各自字段携带 `elevation`。
2. Scene projection、Overlay projection、Workspace screen/hit-test 和 PNG
   scene input 对同一个 Diagram 输入得到一致的 XZ/Y 解释。
3. `rotationYDeg` 是 world-Y 方向的平面旋转；`zIndex` 仍只是 2D painter
   order，不是 world Z。
4. schema `0.1.0` 的现有 x/y/elevation Golden Case 可以直接读取、保存和
   再读取，且不需要增加 world vector 或 Renderer 私有字段。
5. 持久化的 `z`、world coordinate container、camera、scene tree、GPU 或
   其它 Renderer-private state 必须返回结构化、不可恢复的兼容性错误，不能
   被静默忽略。
6. Route adapter 只转换坐标，不在 #133 中改变 Route 的折线/正交形状规则。

## 当前证据

- `tests/world-coordinates.test.mjs`
- `tests/scene-projection.test.mjs`
- `tests/overlay-projection.test.mjs`
- `tests/workspace-canvas.test.mjs`
- `tests/artifact-store.test.mjs`
- `tests/render-document.test.mjs`
- `tests/workspace-export.test.mjs`
- `tests/diagram-tools.test.mjs`
- `node --test tests/*.test.mjs`
- `node scripts/loom-healthcheck.mjs`

## 升格条件

只有在维护者确认候选卡覆盖后续 Renderer/Workspace 实现，并明确接受其
兼容性错误语义时，才将该卡迁入正式 harness；本卡不替代 #134 或 #135 的
路线和端口验收。
