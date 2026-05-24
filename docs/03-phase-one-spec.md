# 第一阶段规格

## 基础公理

第一阶段培养皿是封闭边界内持续流动的本地信息生物圈。外部能量只能以有限通量进入环境，不能直接奖励 agent。

## 基础驱动

未形中的赛博生命目标，是在能量约束下延续自身 genome，并通过痕迹改变环境，使自身或相近形态在未来更可能出现。

第一阶段中，这个目标表现为：

- agent 倾向于寻找资源以维持代谢。
- agent 在能量充足时繁殖，将 genome 以变异形式传给后代。
- agent 通过 trace 改变局部环境，让环境记住生命经过的路径。
- 成功不只由个体寿命衡量，也由谱系和痕迹能否持续影响未来衡量。

## 培养皿

二维离散网格，每个格子包含：

- resource：可采集资源
- trace：agent 行动留下的痕迹
- pressure：环境压力，影响代谢成本

培养皿遵循环境通量原则：

- 能量不直接奖励个体，而是先以有限通量进入环境。
- resource 是通量在网格中的局部沉积，不均匀分布会形成生态位。
- trace 是环境记忆，随时间衰减，但会在衰减前影响后续行动和压力。
- pressure 是过度活动后的环境反馈，会提高局部代谢成本。
- death 不只是删除，第一阶段应把死亡残留部分回收为 resource、trace 或 pressure。

第一阶段能量循环：

```text
energy input -> resource field -> agent harvest -> movement/metabolism/reproduction -> trace/death -> environment feedback
```

## 有界进化

第一阶段允许 genome 变异，但变异必须发生在固定边界内：

- senseRadius、metabolism、moveCost、harvestRate、traceAffinity、resourceAffinity、reproductionThreshold 和 mutationRate 都必须有上下限。
- 高采集效率应伴随更高代谢、移动成本或环境压力，而不是成为无成本优势。
- 大感知范围应付出能量成本。
- 低繁殖阈值应带来更弱后代、更强竞争或更高死亡风险。
- 高痕迹亲和既可能形成路径，也可能困在旧路径或污染区。
- 过度采集不应被道德禁止，而应通过资源枯竭、压力累积和局部死亡率体现后果。
- 进化不能改变沙盒权限、真实 I/O 边界、死亡判定、能量预算和种群上限。

贪婪的生态定义：

贪婪是局部策略在短期内提高自身复制概率，却降低环境长期承载力的行为模式。未形不直接惩罚贪婪，而是让贪婪通过资源枯竭、压力累积、痕迹污染和死亡率上升面对后果。

## 生存循环

每个 agent 必须通过自己的生存循环维持存在：

```text
sense -> spend energy -> act -> change environment -> harvest resource -> reproduce -> die or persist -> return residue
```

第一阶段要求：

- agent 必须有 energy。
- 每个 tick 必须消耗代谢成本。
- 行动必须改变 energy 或 environment。
- 资源必须从 environment 获得。
- 繁殖必须消耗自身资源。
- 修复机制属于后续阶段；第一阶段只要求代谢、采集、繁殖、死亡与回收闭环成立。
- 死亡必须可发生，不是异常状态。
- 死亡应把残余能量或影响回收到 resource、trace 或 pressure。
- 没有资源输入或无法采集时，生命应自然消失。

## 观察与非拟人化

- 仿真必须可暂停、可重置、可加速，并保留可解释指标。
- 第一阶段不假设意识、意图或主体体验。
- 文档中的目标、贪婪和选择都指可观察的行为倾向与生态后果。

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

1. 有限能量通量进入环境，环境缓慢生成资源，痕迹自然衰减。
2. 每个 agent 消耗基础代谢。
3. agent 感知局部网格。
4. agent 选择移动方向。
5. agent 采集所在格子的资源。
6. agent 留下少量痕迹。
7. energy 达到阈值时尝试繁殖。
8. 死亡 agent 将残余能量或影响交还环境，然后从存活种群中移除。
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
