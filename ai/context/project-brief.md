# 项目简报

未形 / primordia 是一个本地安全沙盒中的数字生命培养皿。

它探索的不是高智能助手，也不是自我传播系统，而是低等数字生命在边界内持续存在的条件：能量、物质、DNA、RNA、蛋白质、细胞膜、代谢、免疫、繁殖和死亡如何在信息环境中形成一个可观察的生命闭环。

未形研究封闭信息生物圈中的低等数字生命：它在有限通量中形成生存循环，遗传可变的信息形态，在边界内进化，并通过改变与回归环境延续影响。

基础公理：

- 环境公理：生命来自环境，存在于环境，改变环境，并最终回到环境。
- 通量公理：培养皿不是无限资源池，而是封闭边界内有有限能量通量的信息生物圈。
- 循环公理：生命必须拥有自己的感知、代谢、行动、获取资源、繁殖或修复、死亡与回归循环。
- 遗传公理：生命延续的不是个体永生，而是可遗传、可变异、可持续产生影响的信息形态。
- 进化公理：变异和选择必须发生在细胞膜内，任何优势都要伴随生态代价。

研究护栏：

- 观察护栏：生命过程必须可观察、可暂停、可重置、可回放。
- 非拟人化护栏：第一阶段不假设意识、意图或主体体验。

## 当前阶段

Phase 1.1：工程迁移已完成，进入用户本地手动验证前。

- 项目起源已经沉积到 `docs/origin.md`。
- 基础文档结构已经建立。
- 第一版 TypeScript 仿真内核位于 `src/core/primordia.ts`。
- 第一版 Vite + Canvas 培养皿界面位于 `src/app/`，入口为根目录 `index.html`。
- AI 协作结构位于 `ai/`。
- 2026-05-24：已从静态 JS 原型迁移到 TypeScript + Vite；`npm run check` 与 `npm run build` 已通过自动验证。
- 2026-05-25：用户已完成 Windows 本地浏览器手动验证：agent 移动、tick 变化、暂停/继续/单步/重置、速度滑块均正常。Chrome Issues 面板出现 dev 环境 CSP eval 提醒，但未在 app 源码或生产构建中发现对应问题。
- Windows 一键启动入口位于 `start-dev.bat`，实际逻辑位于 `scripts/start-dev.ps1`。
- 2026-05-25：Phase 1.2 typed simulation core 已完成初版：明确 `SimulationConfig`、`Agent`、`Genome`、`EnvironmentCell`、`Metrics` 等 core 类型，新增 typed 环境读取 API，并用 Vitest 覆盖 DOM-free core、配置 patch、环境 cell 快照和 deterministic replay。
- 2026-05-25：Phase 1.3 environment flux modes 已完成初版：`SimulationConfig.environmentMode` 支持 `closed` 与 `flux`；`closed` 不再生成新 resource，`flux` 保持有限资源通量；Vitest 覆盖 closed 无输入、flux 有界输入与 deterministic 行为。
- 2026-05-25：Phase 1.4 agent survival loop 已完成初版：tick 内部明确为代谢、移动、采集、留痕、尝试繁殖、死亡移除；Vitest 覆盖 closed 无资源自然灭绝，以及存活行动会改变 energy 或 environment。

## 当前优先级

1. 保持安全边界清晰。
2. 让培养皿稳定、可观察、可暂停、可重置。
3. 让生命感先于智能感出现。
4. 记录实验参数和观察结果。
5. 推进 Phase 1：最小生命闭环。

## 未来研究线

- Phase 5：语义器官。LLM 作为高成本语义器官，不作为基础生命，详见 `docs/future/llm-semantic-organ.md`。
- Phase 6：半透膜外部通量。互联网只能作为经白名单、缓存、摘要、预算和审计进入培养皿的外部环境输入。
- Phase 5 和 Phase 6 实施前都必须重新审核前置 phase 的生态、安全和审计结果。
- 真实 LLM API 与真实互联网输入都不能成为核心仿真依赖。

## 不要做

- 不要实现真实网络传播。
- 不要让 agent 读取真实文件、环境变量、token 或密钥。
- 不要研究逃逸、提权或权限试探。
- 不要把互联网描述为生命领土或 agent 能力；只能作为未来半透膜外部通量。
- 不要为了“更像生命”牺牲可终止性和可解释性。
