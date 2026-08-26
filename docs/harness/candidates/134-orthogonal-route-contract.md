# Candidate Harness: #134 正交路线

状态：candidate，尚未升级为正式 Harness。

## 目标

让 Route 在 Renderer-independent 的 Diagram 坐标中保持方形网格边，并由
`diagramToWorld` 得到世界 X/Z 平面上的正交路线。

## 不变量

- Diagram `x` 映射世界 `X`，Diagram `y` 映射世界 `Z`；检查路线形状时只看这两个轴。
- 每一对相邻控制点只能改变世界 `X` 或世界 `Z` 其中一个；斜线必须结构化拒绝。
- `elevation` 映射世界 `Y`，可以独立变化，不参与 XZ 正交判断。
- Generated Layout、Human Override、Route Editor、Overlay projection 和
  Workspace renderer 使用同一份路线契约。
- Workspace 网格由当前 world-to-screen 变换动态投影；视角变化不能改变路线拓扑。

## 覆盖场景

- Generated Layout 的 `main-flow`、`alternative` 和 `compounding-loop` 路线。
- 路线编辑器的端点、折点移动和 1 Diagram-unit 吸附。
- Domain/Overlay command 对斜线路线的拒绝，以及合法路线的一次性提交。
- Overlay 的 Diagram points 与 world X/Z/Y 映射。
- pan、zoom、orbit 后，路线世界点不变且网格方向仍对应 world X/Z。
- Golden Case 继续可读；旧的斜线输入明确以结构化错误阻断。

## 明确不覆盖

本 Issue 不引入节点端口、箭头造型、标签、相机/打印图框或 PNG 行为。
