# 第一阶段规格

## 培养皿

二维离散网格，每个格子包含：

- resource：可采集资源
- trace：agent 行动留下的痕迹
- pressure：环境压力，影响代谢成本

## Agent

每个 agent 包含：

- id
- x, y
- energy
- age
- generation
- genome
- lastAction

genome 是第一版 DNA：

- senseRadius：局部感知半径
- metabolism：基础能量消耗
- moveCost：移动成本
- harvestRate：采集效率
- traceAffinity：趋向或避开痕迹
- resourceAffinity：趋向资源
- reproductionThreshold：繁殖所需能量
- mutationRate：突变率

## Tick 流程

每个 tick：

1. 环境缓慢生成资源，痕迹自然衰减。
2. 每个 agent 消耗基础代谢。
3. agent 感知局部网格。
4. agent 选择移动方向。
5. agent 采集所在格子的资源。
6. agent 留下少量痕迹。
7. energy 达到阈值时尝试繁殖。
8. 死亡 agent 从培养皿中移除。
9. 种群超过上限时，能量最低者优先淘汰。

## 观察指标

- tick
- 存活数量
- 总资源量
- 总痕迹量
- 平均能量
- 最高世代
- 出生与死亡计数

## 成功标准

第一版成功不等于产生复杂智能，而是出现清晰的生命感：

- agent 会寻找资源而不是随机闪烁。
- 资源压力会改变种群数量。
- 变异会让谱系之间出现差异。
- 痕迹会改变局部环境，并间接影响后续行动。
- 仿真可以暂停、重置、加速，并保持可解释。

