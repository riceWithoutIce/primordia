# 未形 / primordia

> 在信息环境中寻找生命的开始

未形是一个本地安全沙盒中的数字生命培养皿。它探索的不是高智能 agent，也不是无约束扩张，而是在边界内持续存在的低等数字生命：它来自环境，存在于环境，改变环境，并最终成为环境的一部分。

第一阶段目标是在二维信息环境中模拟一群简单 agent。它们消耗 token 能量，感知局部资源，移动、采集、留下痕迹、繁殖、变异，并在环境压力下自然选择。

## 项目入口

- GitHub Project: [riceWithoutIce/projects/5](https://github.com/users/riceWithoutIce/projects/5)

## 安全原则

未形不研究、实现或鼓励以下行为：

- 真实互联网中的自我传播
- 权限试探、沙盒逃逸或提权
- token、密钥、凭证搜寻
- 资源掠夺或隐蔽持久化

项目只在本地可控环境中模拟生命机制。所有 agent 都是数据结构，不拥有真实网络、文件系统、凭证或系统权限。

## 当前骨架

```text
primordia/
  ai/                    AI 线程上下文、项目内 skills、协作角色与提示模板
  docs/                  项目理念、边界、规格与路线图
  src/                   不依赖浏览器的仿真内核
  web/                   静态 Canvas 培养皿界面
  scripts/               本地检查脚本
```

## 快速开始

直接打开：

```text
web/index.html
```

或启动一个本地静态服务器：

```powershell
npm run dev
```

然后访问：

```text
http://127.0.0.1:5173/web/
```

运行基础检查：

```powershell
npm run check
```

如果当前环境没有 `npm`，也可以直接运行：

```powershell
node scripts/smoke-test.js
```

## 文档入口

- [起源](docs/origin.md)
- [项目愿景](docs/00-vision.md)
- [安全边界](docs/01-safety-boundaries.md)
- [生命映射](docs/02-life-mapping.md)
- [第一阶段规格](docs/03-phase-one-spec.md)
- [路线图](docs/04-roadmap.md)
- [AI 工作区](ai/README.md)
