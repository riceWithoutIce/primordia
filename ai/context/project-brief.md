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

Phase 2.2：世界化环境与分化生态已完成验收，下一步进入 Phase 3 行为器官与工具边界的安全设计与任务拆分。

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
- 2026-05-25：Phase 1.5 death reasons and residue recovery 已完成初版：记录 `starvation`、`pressure`、`overflow` 死亡原因，死亡残余回收到 resource/trace/pressure，UI 显示死亡原因计数；Vitest 覆盖三类死亡原因与残余回收。
- 2026-05-25：Phase 1.5 浏览器人工验证通过：agent 移动、tick 变化、按钮与速度滑块可用；当前生命运动轨迹仍显得随机、生命感较初级，后续应通过资源梯度、痕迹偏好、谱系差异和生态压力继续强化可感知的方向性。
- 2026-05-25：Phase 1.6 lineage tracking 已完成初版：初代 agent 获得独立 `lineageId`，后代继承父代谱系，metrics 与 UI 显示当前存活谱系数量；Vitest 覆盖初代谱系独立性、繁殖谱系继承和最高世代。
- 2026-05-25：Phase 1.7 genome bounds and tradeoffs 已完成初版：集中 `GENOME_BOUNDS` 与 `constrainGenome`，spawn 和 mutation 都收束 genome；大感知、高采集、高资源偏好、高痕迹亲和、低繁殖阈值会转化为代谢、移动成本、局部 pressure 或繁殖损耗；Vitest 覆盖 genome 边界、突变边界和生态代价。
- 2026-05-25：Phase 1.7 后人工观察：修正速度滑条后，低速观察已经能看到一些不一样的表现，说明生态代价和谱系/资源机制开始产生可感知差异；后续调参和 Phase 1.8 观察指标应继续服务于“肉眼能看见生命过程”。
- 2026-05-26：Phase 1.8 observability metrics 已完成：core metrics 和 UI 展示当前 seed、生命数量、谱系数量、总资源、总痕迹、总压力、平均能量、最高世代、出生与饥饿/压力/溢出死亡原因统计；指标随 step/reset 更新，不引入外部数据源。
- 2026-05-26：Phase 1.9 deterministic test suite 已完成：`npm run test` 可运行 DOM-free Vitest；覆盖完整快照 replay、closed 自然灭绝、flux 有界生命周期、death recovery、genome bounds、population cap 和 UI 指标绑定；`npm run check` 覆盖 typecheck 与 tests。
- 2026-05-26：Phase 1.10 GitHub Pages 已完成：生产构建发布到 `gh-pages` 分支，Pages source 为 `gh-pages /`，公开 URL 为 <https://ricewithoutice.github.io/primordia/>；已验证 HTML/JS/CSS 返回 HTTP 200。仍建议用户用浏览器人工确认 Canvas 非空和按钮交互。
- 2026-05-26：Phase 1.12 验收已完成，Phase 1 父 issue 已关闭；之后进入 Phase 2 生态与谱系任务。
- 2026-05-26：Phase 2.1 到 Phase 2.3 已完成：资源初始化改为确定性地形，资源恢复由肥力驱动，并加入局部枯竭与压力敏感恢复；用户已观察到噪声区域和资源/恢复差异。
- 2026-05-26：Phase 2.4 到 Phase 2.5 已完成：agent 按谱系着色，并在 metrics/UI 中追踪总谱系、活跃谱系、灭绝谱系、优势谱系与优势占比；用户已确认能看到不同谱系。
- 2026-05-26：Phase 2.6 到 Phase 2.7 已完成：压力扩散、移动成本地形和硬屏障已实现；用户确认压力不再是单点，并反馈 agent 容易卡在边缘，已在 #26 备注为后续可调优点。
- 2026-05-26：Phase 2.8 已完成：确定性 bloom/pressure 环境事件按 seed 和 tick 触发，不消耗普通仿真随机序列；页面显示事件数量、最近事件和短暂事件脉冲。
- 2026-05-26：Phase 2.9 已完成：`Simulation.snapshot()` 输出可复现实验快照，页面可记录、复制和下载 JSON；用户已人工验证记录导出正确。
- 2026-05-26：Phase 2.10 验收已完成：详见 `docs/05-phase-two-acceptance.md`。Phase 2 当前任务定义下通过，暂不追加环境事件细化等临时任务。
- 2026-05-26：Phase 2.2 已完成：core 拆分为 config/random/world/life/sim，默认世界扩大到 `256 x 160`，新增 `WorldState`、terrain/biome、动态 fields、moisture-front 环境过程、行为 genome traits、species/clade 指标、snapshot schema v2、terrain base map + overlays 可视化，以及大世界性能基线优化；详见 `docs/06-phase-two-two-acceptance.md`。

## 当前优先级

1. 保持安全边界清晰。
2. 让培养皿稳定、可观察、可暂停、可重置。
3. 让生命感先于智能感出现。
4. 记录实验参数和观察结果。
5. 进入 Phase 3 时，先完成行为器官和工具边界的安全设计，再实现任何模拟工具系统。

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
