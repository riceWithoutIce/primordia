# AI 工作区

`ai/` 是未形给后续 AI 线程留下的工作区。这里的文件不是隐藏指令，也不是不可审计的魔法；它们是普通 Markdown，用来保存项目记忆、协作方式和可复用工作法。

## 新线程读取顺序

1. `docs/origin.md`
2. `README.md`
3. `docs/01-safety-boundaries.md`
4. `docs/03-phase-one-spec.md`
5. `ai/context/project-brief.md`

## 目录

```text
ai/
  context/       项目简报、词汇表和交接上下文
  skills/        项目内技能说明，稳定后可抽成 Codex skill
  agents/        多 agent 协作角色和分工
  prompts/       交接、实验和复盘模板
```

## 维护原则

- 先沉积，再抽象。重要讨论先记录到 `docs/origin.md` 或 `ai/context/`。
- 先普通文档，再自动化。项目内 skill 稳定后再考虑迁移到全局 skill。
- 文档、prompt、skill 和 agent 说明中使用仓库相对路径，不写机器硬路径。
- 所有 AI 协作都必须服从 `docs/01-safety-boundaries.md`。
- 复杂任务先向用户请示是否释放多 agent 协作。
