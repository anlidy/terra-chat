# 项目文档

> **状态**：Active
>
> **范围**：仓库文档目录、职责与生命周期
>
> **最后核验**：2026-07-22

本页是 FurryChatbot 的文档目录。代码和配置是运行行为的最终依据；文档用于解释目标、约束、架构和操作方式。如果两者不一致，应先核对实现，再在同一次变更中修正文档。

## 文档分层

| 类型 | 位置 | 用途 |
| --- | --- | --- |
| 产品入口 | [`README.md`](../README.md) | 功能概览、本地启动、常用命令 |
| 仓库工作约定 | [`AGENTS.md`](../AGENTS.md) | 开发规则、验证要求、文档治理 |
| 长期架构文档 | `docs/*.md` | 跨模块且随当前实现维护的说明 |
| 模块文档 | `<module>/README.md` | 与单一模块共同演进的实现说明 |
| 规格化变更 | `openspec/changes/<change-id>/` | proposal、design、specs 和 tasks |
| 设计与执行记录 | `docs/specs/`、`docs/plans/` | 带日期的阶段性设计和计划，不代表已上线行为 |

## 当前架构文档

| 文档 | 状态 | 说明 |
| --- | --- | --- |
| [产品上下文](../PRODUCT.md) | Active | 用户、产品目标、定位、设计原则与无障碍基线 |
| [界面设计系统](../DESIGN.md) | Active | 产品界面的颜色、排版、布局、组件和响应式规则 |
| [Artifacts 架构](artifacts.md) | Active | 同步 Markdown 解析、流事件批处理、预览/编辑边界、保存与错误恢复、性能基准和扩展方式 |
| [RAG 检索架构](../lib/rag/README.md) | Active | pgvector、PostgreSQL lexical 检索、RRF 与可选 rerank 的当前实现 |

## 变更记录

OpenSpec 目录描述功能变更的意图和实施轨迹，不自动成为当前行为的来源。

| 变更 | 状态 | 备注 |
| --- | --- | --- |
| [`add-multimodal`](../openspec/changes/add-multimodal/proposal.md) | In progress | 仍有未完成任务 |
| [`add-settings-panel`](../openspec/changes/add-settings-panel/proposal.md) | Implemented | 任务已勾选完成；归档前仍需核对实现与文档 |
| [`feat-rag`](../openspec/changes/feat-rag/proposal.md) | Implemented | 规格结构已修复且校验通过，归档前仍需复核模块文档与代码 |
| [`refactor-prompts`](../openspec/changes/refactor-prompts/proposal.md) | In progress | 仍有未完成任务 |
| [`refactor-styles`](../openspec/changes/refactor-styles/proposal.md) | In progress | 剩余 UI smoke check |
| [`refactor-thinking`](../openspec/changes/refactor-thinking/proposal.md) | Implemented | 任务已勾选完成；归档前仍需核对实现 |
| [`add-project-knowledge-base`](../openspec/changes/add-project-knowledge-base/proposal.md) | In progress | 功能与可用自动化验证已完成；聚焦 Playwright/视觉回归因本机浏览器平台不受支持而待 CI 补跑 |

## 设计与计划记录

| 文档 | 状态 | 说明 |
| --- | --- | --- |
| [RAG 可靠性与通用化改进计划](plans/2026-07-19-rag-improvement-and-generalization-plan.md) | In progress | 阶段 0 评测已升级为 35 EN / 30 ZH / 10 project 分层语料，含诊断检索指标、语言/题型切片、答案质量和稳定覆盖式报告；扩展 full 基线待重跑 |
| [RAG Evaluation-First 设计](specs/2026-07-19-rag-evaluation-first-design.md) | Implemented | 评测优先的 RAG 改进设计 |
| [RAG Evaluation-First 实施计划](plans/2026-07-19-rag-evaluation-first.md) | Implemented | 对应设计的分步实施计划 |

## 生命周期

- `Proposed`：已形成方案，尚未成为当前实现。
- `In progress`：正在实施，文档可能只覆盖部分行为。
- `Active`：描述当前行为，并应随代码同步维护。
- `Implemented`：实现和必要验证已完成；归档前仍需核对用户文档与当前代码。
- `Needs review`：可能过时或存在已知偏差，使用前必须核对代码。
- `Superseded`：已被新文档取代，应保留跳转说明而不是继续维护正文。

## 维护检查清单

新增或修改文档时：

1. 确认它属于产品入口、长期说明、模块说明、变更规格或阶段性计划中的哪一类。
2. 在标题后写明状态、范围和最后核验日期；计划类文档至少写明状态。
3. 避免复制环境变量、命令或架构说明，优先链接到唯一维护位置。
4. 使用稳定的文件和符号名称，避免依赖行号。
5. 检查相对链接、命令和代码示例。
6. 功能落地时同步更新对应文档和本目录状态；被替代时标记 `Superseded` 并指向新文档。
