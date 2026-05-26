# 未形 / primordia

> 在信息环境中寻找生命的开始

未形是一个本地安全沙盒中的数字生命培养皿。它探索的不是高智能 agent，也不是无约束扩张，而是在边界内持续存在的低等数字生命：它来自环境，存在于环境，改变环境，并最终成为环境的一部分。

第一阶段目标是在二维信息环境中模拟一群简单 agent。它们消耗 token 能量，感知局部资源，移动、采集、留下痕迹、繁殖、变异，并在环境压力下自然选择。

## 安全原则

未形不研究、实现或鼓励以下行为：

- 真实互联网中的自我传播
- 权限试探、沙盒逃逸或提权
- token、密钥、凭证搜寻
- 资源掠夺或隐蔽持久化

项目只在本地可控环境中模拟生命机制。所有 agent 都是数据结构，不拥有真实网络、文件系统、凭证或系统权限。

## 当前状态

Phase 1 最小生命闭环已经完成到公开部署前的验收阶段：

- TypeScript core 支持 `closed` / `flux` 环境、有限资源通量、代谢、移动、采集、留痕、繁殖、变异、死亡原因和死亡残余回收。
- genome 变异被固定边界收束，高感知、高采集、低繁殖阈值等优势带有生态代价。
- UI 展示 tick、seed、生命数量、谱系数量、总资源、总痕迹、总压力、平均能量、最高世代、出生与死亡原因统计。
- `npm run test` 覆盖 DOM-free core、deterministic replay、closed 灭绝、flux 有界输入、death recovery、genome bounds、population cap 和 UI 指标绑定。
- 公开静态页面：<https://ricewithoutice.github.io/primordia/>

## 当前骨架

```text
primordia/
  ai/                    AI 线程上下文、项目内 skills、协作角色与提示模板
  docs/                  项目理念、边界、规格与路线图
  src/core/              不依赖浏览器的 TypeScript 仿真内核
  src/app/               Vite + Canvas 2D 培养皿界面
  tests/                 Vitest 测试
```

## 快速开始

Windows 一键启动：

```powershell
.\start-dev.bat
```

脚本会在需要时安装依赖，启动本地 Vite 开发服务器，并打开浏览器访问培养皿。

安装依赖：

```powershell
npm install
```

启动本地 Vite 开发服务器：

```powershell
npm run dev
```

然后访问：

```text
http://127.0.0.1:5173/
```

运行检查：

```powershell
npm run check
```

运行测试：

```powershell
npm run test
```

生产构建：

```powershell
npm run build
```

## 复现实验

仿真由 `SimulationConfig.seed` 驱动；同一 seed、同一配置和同一 tick 数应产生同一类演化过程。UI 面板显示当前 seed，点击重置会生成新的 seed。需要固定复现时，在代码或测试中显式传入 seed，例如：

```ts
const sim = new Simulation({ seed: 20260523 });
sim.step(120);
```

当前第一阶段不包含真实 LLM API、真实互联网输入、外部工具生命、shell 行为器官或 agent 侧文件/凭证访问。GitHub Pages 只发布静态 `dist/` 页面。

## 文档入口

- [起源](docs/origin.md)
- [项目愿景](docs/00-vision.md)
- [安全边界](docs/01-safety-boundaries.md)
- [生命映射](docs/02-life-mapping.md)
- [第一阶段规格](docs/03-phase-one-spec.md)
- [路线图](docs/04-roadmap.md)
- [LLM 语义器官研究线](docs/future/llm-semantic-organ.md)
- [AI 工作区](ai/README.md)
