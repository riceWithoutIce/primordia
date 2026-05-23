# Primordia Simulation Skill

用于修改未形第一阶段培养皿仿真。

## 先读

1. `docs/origin.md`
2. `docs/03-phase-one-spec.md`
3. `src/primordia.js`
4. `scripts/smoke-test.js`

## 工作原则

- 生命感先于智能感。
- agent 只能是本地仿真数据结构。
- 文件引用使用仓库相对路径，不写机器硬路径。
- 新规则必须可观察、可暂停、可重置。
- 所有参数需要有上限或钳制，避免不可控爆炸。
- 修改共享机制时更新 smoke test。

## 常见任务

- 添加新环境场：污染、屏障、温度、营养类型。
- 添加新指标：死亡原因、谱系数量、平均年龄。
- 调整基因：移动偏好、痕迹亲和、繁殖阈值。
- 添加实验 seed，保证现象可复现。

## 验证

运行：

```powershell
npm run check
```
