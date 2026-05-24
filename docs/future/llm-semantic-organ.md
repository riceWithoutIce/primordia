# LLM 语义器官研究线

这是 Phase 3 之后的未来 epic 草案，不是当前阶段的实现任务。实施前必须根据 Phase 1-3 的实际结果重新审核，尤其确认生态循环是否稳定、工具白名单是否安全、审计系统是否足够解释语义行为。

## Summary

在 Phase 3 之后引入 LLM，不把它作为基础生命，而作为某些谱系可进化出的高成本“语义器官”。LLM 只能消耗培养皿内的 semantic token 资源，读取模拟环境摘要，输出 schema 化意图，并由仿真规则验证执行。

目标不是让生命“像人在思考”，而是研究：有限语义代谢是否能成为感知、决策、记忆、变异和遗传的一部分。

## Project Cards

### 1. Design: Semantic Organ Spec

- 定义 LLM 语义器官的边界：只能作用于模拟环境，不能访问真实网络、文件、shell、token、凭证。
- 明确 token 是培养皿资源，不是外部无限额度。
- 产出文档：LLM 只是一种昂贵器官，不是上帝、不是逃逸口。

### 2. Core: Semantic Token Budget

- 新增 `semanticEnergy` 或 `semanticTokens`，作为独立于普通 energy 的高级代谢资源。
- 每次语义感知、语义决策、语义变异都必须消耗预算。
- 无预算时 agent 退化为非语义行为。

### 3. Interface: LLM Adapter

- 增加 provider-agnostic adapter：`MockLlmAdapter` first，真实 API later。
- 输入只允许环境摘要、agent 状态摘要、允许动作列表。
- 输出只允许固定 action schema，不允许自由执行命令。

### 4. Level 1: Semantic Perception

- LLM 只做环境状态分类，例如 `rich`, `poor`, `crowded`, `highPressure`, `traceDense`。
- 行动仍由数值 genome 决定。
- 用 mock adapter 先验证可回放和确定性测试。

### 5. Level 2: Bounded Semantic Decision

- LLM 可在固定动作集合中选择：move、harvest、rest、reproduce、avoidPressure。
- 输出必须经过规则层验证、限幅、拒绝非法意图。
- 记录每次输入摘要、token 消耗、输出意图、执行结果。

### 6. Level 3: Semantic Inheritance

- 引入 `promptGenome` / `policyGenome` / `memorySchema`。
- 允许遗传与变异，但只能改变模拟策略，不能改变沙盒边界。
- 研究语义策略是否会形成谱系差异。

### 7. Observability: Semantic Audit Log

- 每次 LLM 调用必须可观察、可回放、可审计。
- UI 显示 semantic token 消耗、调用次数、拒绝次数、语义谱系。
- 实验摘要导出包含 seed、adapter 类型、语义调用统计。

## Interfaces

### `LlmAdapter`

- `classifyEnvironment(summary) -> SemanticLabels`
- `chooseIntent(summary, allowedActions) -> Intent`
- `mutatePolicy(policyGenome, mutationLimits) -> PolicyGenome`

### `Intent`

- 固定枚举动作，不允许任意文本命令。
- 所有 intent 必须经过 simulation rules 验证后才执行。

### `SemanticGenome`

- `promptGenome`
- `policyBias`
- `semanticBudgetPolicy`
- `memoryCompressionPolicy`
- `mutationRate`

## Test Plan

- Mock adapter 下同 seed 必须可复现。
- LLM 输出非法动作时必须被拒绝并记录。
- semantic token 耗尽时 agent 必须退回非语义行为或死亡。
- prompt/policy 变异不能改变不可进化层：沙盒权限、真实 I/O、死亡机制、种群上限、能量预算。
- 审计日志必须能解释每次语义行动为何发生、消耗多少、是否执行。
- 实施前重新评审 Phase 1-3 结果，确认生态、安全、审计三项都达标。

## Assumptions

- LLM 研究线放在 Phase 3 之后。
- 第一实现使用 mock adapter，不直接接真实 API。
- 真实 LLM API 只作为可选 adapter，不作为核心仿真依赖。
- LLM 不能直接调用工具；工具调用仍由未来白名单蛋白质系统控制。
- 语义能力是昂贵代谢器官，不是基础生命条件。
- 实施时可根据前置 phase 的发现拆分、推迟或收缩本 epic。

