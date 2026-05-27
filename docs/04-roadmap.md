# 路线图

未形的路线图按生命复杂度推进，而不是按功能堆叠推进。每个 phase 只回答一个核心问题。

## Phase 0：起源与边界

核心问题：我们研究的生命是什么，不是什么？

目标：

- 建立基础公理、研究护栏和审美原则。
- 明确安全边界：不做真实互联网自我传播、权限试探、token 搜寻、逃逸或资源掠夺。
- 初始化文档结构、本地仿真内核和静态培养皿界面。

成功标准：

- 新线程能从 `docs/origin.md` 和 `ai/context/project-brief.md` 理解项目起点。
- 仓库有可运行的本地培养皿原型。
- 安全边界和不可进化层被写入文档。

## Phase 1：最小生命闭环

核心问题：一个低等数字生命能不能完成最低限度的“活着”？

目标：

- 建立感知、代谢、行动、采集、痕迹、繁殖、变异、死亡与回归环境的闭环。
- 让 energy、resource、trace、pressure 和 death residue 形成最小信息生物圈。
- 保持可观察、可暂停、可重置、可复现。

成功标准：

- 没有资源输入时生命会自然消失。
- 有有限通量时生命能维持、波动或崩溃，并能解释原因。
- agent 能繁殖、变异、死亡，并把残余影响交还环境。
- 同一个 seed 能复现同一类演化过程。

当前状态：

- Phase 1 已完成并验收：TypeScript/Vite 迁移、typed core、closed/flux 环境、agent 生存循环、死亡原因与残余回收、谱系追踪、genome 边界与生态代价、观察指标、确定性测试、文档收尾和 GitHub Pages 静态部署。
- 公开页面：<https://ricewithoutice.github.io/primordia/>

## Phase 2：生态与谱系

核心问题：多个生命闭环能不能形成生态？

目标：

- 引入资源斑块、多资源类型、区域压力、污染、屏障和环境事件。
- 追踪 lineage、祖先、死亡原因、谱系颜色和生态位。
- 让环境历史影响未来生命，而不是只作为背景地图。

成功标准：

- 不同谱系在不同环境里出现不同命运。
- 局部竞争、迁移、繁荣、崩溃和恢复能被观察。
- 实验记录可以保存、回放和比较。

当前状态：

- Phase 2 已完成并验收：资源地形、肥力通量、局部枯竭/恢复、谱系颜色、谱系命运指标、压力扩散、屏障与移动成本、确定性环境事件、实验快照导出和 Phase 2 验收记录均已完成。
- 验收记录见 [Phase 2 Acceptance Review](05-phase-two-acceptance.md)。
- Phase 2.2 已完成并验收：世界化环境、地形/生态位、连续环境过程、行为分化、species/clade 指标、base map + overlays 可视化和大世界性能基线均已完成。
- 验收记录见 [Phase 2.2 Acceptance Review](06-phase-two-two-acceptance.md)。
- Phase 2.3 large-world simulation framework 已完成当前验收：`960 x 640` 默认世界、chunk/region/scheduler、deterministic lazy update、chunk-aware pressure diffusion、snapshot v3、projection cache 和 Canvas 2D 观察已落地，热运行达到约 `16 tick/s`。
- 验收记录见 [Phase 2.3 Acceptance Review](10-phase-two-three-progress.md)。
- Phase 3 已完成并验收；Phase 2.3 现在作为大世界基础设施继续推进。

## Phase 2.2：世界化环境与分化生态

核心问题：生态能不能从资源地图推进成一个可观察、可复现、可承载分化的小世界？

目标：

- 将默认培养皿扩大到 `256 x 160`，提前暴露性能、渲染、快照和算法结构问题。
- 将环境拆成静态地形和动态场：elevation、moisture、temperature、fertility、terrainType、resource、trace、pressure、moistureDelta。
- 用自研确定性地形生成形成 ocean、coast、plain、hill、mountain、wetland、desert 等生态位。
- 将环境事件扩展为有生命周期的环境过程，例如 moisture-front，使扰动能生成、移动、扩散、衰减。
- 扩展行为 genome，引入 inertia、riskTolerance、pressureAversion、terrainAffinity、explorationBias，并通过局部规则改善卡边/卡障碍行为。
- 引入 species/clade identifier 雏形，让谱系在多代繁殖后能出现可观察的分化标签。
- 重构 `src/core` 为 config/random/world/life/sim 模块，保留 `Simulation` 简单公开 API。

成功标准：

- 同 seed、同 config、同 tick 的世界、过程、agent 指标可复现。
- 地形和生态位肉眼可读，资源带由地形/湿度/压力共同塑造。
- 环境过程不是孤立点，而是能持续影响局部 resource、pressure、trace 或 moisture。
- 行为差异和 species/clade 指标能在 UI 或 snapshot 中观察。
- `npm run check` 和 `npm run build` 通过；必要时进行浏览器人工验证。

当前状态：

- Phase 2.2 已完成并验收。默认世界尺寸为 `256 x 160`，core 已拆分为 config/random/world/life/sim 模块，`ExperimentSnapshot` 为 `schemaVersion: 2`。
- UI 默认使用 terrain base map，并叠加 resource、agent 和 process overlays；pressure 和 lineage 作为可选 overlays。
- 大世界性能基线已记录：#43 优化后默认核心长跑 `step(1000)` 约为优化前的十分之一。

## Phase 3：行为器官与工具边界

核心问题：生命能不能拥有更复杂的“蛋白质”，但仍不越过细胞膜？

目标：

- 引入严格白名单的模拟工具或动作器官。
- 工具只能作用于培养皿内部，不能访问真实网络、文件系统、shell、凭证或外部权限。
- 为工具行为建立成本、预算、拒绝机制、审计日志和异常隔离。

成功标准：

- 工具调用是可观察、可拒绝、可回放的模拟动作。
- 工具优势伴随生态代价。
- 工具系统不会改变不可进化层。

当前状态：

- Phase 3 已完成并验收。
- 行为器官边界规格见 [Phase 3 Behavior Organ Boundaries](07-phase-three-organ-boundaries.md)。
- 验收记录见 [Phase 3 Acceptance Review](08-phase-three-acceptance.md)。
- Phase 3 的“工具”只允许是培养皿内部的模拟器官动作，不允许真实网络、文件系统、shell、凭证、token、外部 API 或浏览器权限。
- 已实现 typed organ actions、预算/拒绝/审计、首个 `trace-mark` 内部器官原型、`organAffinity` / `organStability` genome traits、生态代价、snapshot 和 UI 观测指标。

## Phase 4：记忆、学习与可解释演化

核心问题：生命能不能从历史中形成可遗传的行为结构？

目标：

- 引入环境记忆、个体记忆、策略表达和可解释变异。
- 支持多培养皿对照实验、谱系比较和实验回放。
- 研究策略如何出现、传播、失败或转向。

成功标准：

- 能解释某个谱系为何繁荣或灭亡。
- 能比较不同环境、seed 和策略结构的演化结果。
- 人类干预环境后，系统变化可被记录和解释。

## Phase 5：语义器官

核心问题：有限语义代谢能不能成为生命的一种高级器官？

目标：

- 引入 LLM 作为高成本语义器官，而不是基础生命。
- 第一实现使用 mock adapter，不直接接真实 LLM API。
- LLM 只能读取模拟环境摘要，输出 schema 化意图，并由仿真规则验证执行。

成功标准：

- 语义能力消耗 semantic token，且无预算时退化为非语义行为。
- 每次语义行动都可审计、可拒绝、可回放。
- prompt / policy 变异不能改变沙盒边界或不可进化层。

前置条件：

- 实施前必须重新审核 Phase 1-3 的生态、安全和审计结果。
- 详见 [LLM 语义器官研究线](future/llm-semantic-organ.md)。

## Phase 6：半透膜外部通量

核心问题：培养皿能不能吸收外部世界的“影子”，而不让生命逃出边界？

目标：

- 把互联网视为外部通量，不视为生命领土。
- 外部信息只能经白名单、缓存、摘要、预算、审计后进入培养皿。
- agent 不接触 URL、登录态、cookie、token、密钥、任意网络请求或外部写入权限。

成功标准：

- 外部数据只表现为环境天气、资源波动、压力场或事件。
- 所有外部输入可缓存、可回放、可关闭。
- agent 不能扫描、爬取、传播、发帖、发 PR、发消息或影响真实网络。

前置条件：

- Phase 1-5 的生态、安全、工具和语义审计机制必须稳定。
- 该阶段实施前需要单独安全评审。
