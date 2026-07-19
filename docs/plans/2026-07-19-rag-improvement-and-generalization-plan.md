# RAG 可靠性与通用化改进计划

> **状态**：Proposed
>
> **范围**：文档生命周期、摄取可靠性、检索质量、通用模块边界、评测与可观测性
>
> **最后核验**：2026-07-19

## 1. 背景与结论

当前 RAG 已具备完整的聊天文档问答链路：文档上传后经 LlamaCloud 解析、Markdown 切块、智谱 Embedding，写入 PostgreSQL/pgvector；查询通过向量与 PostgreSQL lexical 检索召回，经 RRF 融合和可选 rerank 后供主动检索与 `retrieveDocuments` 工具共同使用。

现有实现适合单个会话内少量文档的局部事实问答，但还不适合作为可复用的知识库模块。主要限制不在于缺少更多检索算法，而在于：文档与会话绑定过早、摄取任务不可恢复、供应商和 `chatId` 深入核心模块、检索没有拒答阈值、引用元数据不稳定，以及真实基线尚未建立。

本计划采用“先可测、再可靠、后抽象、最后优化质量”的顺序，避免在没有基线时同时替换多个组件，导致效果变化无法归因。

## 2. 当前基线

### 2.1 当前数据流

```text
上传文件
  → Vercel Blob
  → DocumentResource(pending, chatId)
  → Next.js after()
      → LlamaCloud Parse
      → MarkdownNodeParser
      → Zhipu embedding-3 / 1024 维
      → DocumentChunk + pgvector
      → ready/error

用户查询
  → retrieveDocumentChunks
      → vector + lexical
      → RRF
      → DashScope 或启发式 rerank
      → top-k chunks
```

### 2.2 已具备的良好基础

- 主动检索和模型工具共用 `lib/rag/retrieve.ts`，避免两条检索链路继续漂移。
- `RetrievedChunk` 已包含稳定的 chunk/resource 标识和分阶段分数。
- RRF、检索编排、指标、数据适配器和路由边界已有离线测试。
- `evals/` 已能生成 Recall@K、MRR、NDCG、false-retrieval rate 和延迟报告。

### 2.3 已确认的问题

| 优先级 | 问题 | 当前影响 |
| --- | --- | --- |
| P0 | 上传即绑定 chat，移除附件不撤销资源 | 未发送或已移除的文档仍可能参与后续检索 |
| P0 | `after()` 承担完整摄取任务 | 任务中断后可能长期 pending，无法自动恢复 |
| P0 | 文档使用公开 Blob，状态接口未校验资源归属 | 不满足敏感文档和严格多租户场景 |
| P0 | 检索无相关性阈值 | 不可回答问题也会返回“最不差”的内容 |
| P1 | 单 chunk Embedding 无上限并发 | 大文档容易触发限流、内存和成本问题 |
| P1 | 字符数切块、无 overlap，超长单段不会继续拆分 | chunk 大小不稳定，跨边界证据容易丢失 |
| P1 | 中文查询分词与 PostgreSQL `simple` 索引不对称 | lexical 分支对中文召回不稳定 |
| P1 | 无 Key 时启发式 rerank 会重新排序 | 未经评测的回退可能降低 RRF 结果质量 |
| P1 | `chatId`、环境变量和供应商写入核心流程 | 难以支持知识库、跨会话复用和替换供应商 |
| P2 | 缺少真实检索和答案质量基线 | 无法证明优化提升，也无法设置发布门槛 |

## 3. 目标与非目标

### 3.1 目标

1. 用户对上传、移除、发送和删除文档的认知与系统行为一致。
2. 摄取任务可重试、可恢复、可观测、幂等，并对并发和成本有明确上限。
3. RAG 核心以 collection/scope 为边界，不依赖 Next.js、chat 或具体供应商。
4. 对事实问答、摘要和多文档比较采用不同的检索策略。
5. 没有可靠证据时返回空结果，并让模型明确说明证据不足。
6. 页面、章节、sheet、slide 等引用信息可追溯到原文。
7. 每个质量和架构改动都能用固定语料、指标和版本信息比较。

### 3.2 本轮非目标

- 不在建立真实基线前更换 PostgreSQL/pgvector。
- 不同时替换解析、Embedding、lexical 引擎和 reranker。
- 不为了“通用”设计未被当前场景验证的插件系统。
- 不将 LLM judge 作为唯一或首要质量指标。

## 4. 目标架构

### 4.1 模块边界

```text
lib/rag/
├── domain/
│   └── types.ts
├── ingestion/
│   └── service.ts
├── retrieval/
│   ├── service.ts
│   ├── fusion.ts
│   └── policies.ts
├── ports/
│   ├── parser.ts
│   ├── embedder.ts
│   ├── store.ts
│   ├── reranker.ts
│   └── jobs.ts
└── adapters/
    ├── llamacloud-parser.ts
    ├── zhipu-embedder.ts
    ├── postgres-store.ts
    └── dashscope-reranker.ts
```

核心服务只依赖 ports。Next.js 路由、AI SDK tool、环境变量和供应商 SDK 留在 adapter 或应用层。

建议的通用检索入口：

```ts
type RetrievalRequest = {
  scope: {
    principalId: string;
    collectionIds: string[];
  };
  query: string;
  filters?: {
    resourceIds?: string[];
    mimeTypes?: string[];
    metadata?: Record<string, unknown>;
  };
  policy: {
    strategy: "vector" | "lexical" | "hybrid";
    candidateK: number;
    topK: number;
    minRelevance?: number;
    rerank: boolean;
  };
};
```

应用层负责把当前 chat 映射到 collection；核心检索不再直接接受 `chatId`。

### 4.2 数据模型方向

| 实体 | 责任 |
| --- | --- |
| `KnowledgeCollection` | 会话语料、个人知识库或共享知识库的统一检索范围 |
| `Resource` | 原始文件、URL、纯文本及其 owner、hash、状态和解析版本 |
| `CollectionResource` | Resource 与 collection 的绑定、启用状态和权限 |
| `IngestionJob` | 阶段、attempt、lease、进度、错误和重试时间 |
| `Chunk` | 内容、token 数、章节路径、页码、sheet/slide/bbox 等 metadata |
| `ChunkEmbedding` | embedding provider/model/dimensions/version 与向量 |

初期可以继续使用单一 1024 维向量列，但必须把模型和 pipeline version 写入 Resource/Chunk。只有出现第二种维度的实际需求时，再拆分 `ChunkEmbedding` 或使用模型专属向量表。

## 5. 分阶段实施

### 5.1 阶段 0：建立可信基线

目标：让后续每个改动都能回答“提升了什么、牺牲了什么”。

- [ ] 为评测报告增加 commit、corpus hash、pipeline version、embedding model、reranker 和阈值信息。
- [ ] 将评测语料的创建、摄取、等待 ready、运行和清理自动化，避免手工上传污染结果。
- [ ] 跑出 vector、lexical、hybrid、hybrid + rerank 四组真实基线。
- [ ] 增加项目实际使用场景的中英文测试集：事实问答、摘要、多文档比较、不可回答、表格/幻灯片。
- [ ] 增加答案忠实度、引用正确率、输入/输出 token、外部 API 次数和估算成本。
- [ ] 修正报告未记录实际 reranker 的设计偏差。

验收：相同 corpus/pipeline version 可重复运行；报告足以定位每个失败 case；smoke 分数不再被当作真实质量证明。

### 5.2 阶段 1：修正文档生命周期和摄取可靠性

目标：先保证资料不会“悄悄进入检索”，任务不会无期限卡住。

- [ ] 上传创建 draft resource；发送消息后才绑定 collection/chat。
- [ ] 移除 draft 时取消任务，并清理数据库、chunks 和 Blob。
- [ ] Blob 改为私有访问或短期签名 URL；所有资源接口验证 owner/collection 权限。
- [ ] 引入持久化 `IngestionJob`，状态细分为 queued/parsing/chunking/embedding/indexing/ready/failed/cancelled。
- [ ] 为任务增加 lease、attempt、超时、指数退避和可重试错误分类。
- [ ] 使用内容 hash、pipeline version 和唯一约束保证幂等。
- [ ] Embedding 改为批量请求和有限并发；记录 chunk/批次进度。
- [ ] chunks 在事务内替换，只有完整成功后才把 Resource 标记 ready。
- [ ] 增加摄取状态、取消、重试、删除和 chat 删除清理的集成测试。

验收：重复执行同一任务不会产生重复 chunk；进程在任一阶段终止后可恢复；用户移除的文档不会出现在检索结果中；资源接口不能跨用户读取状态。

### 5.3 阶段 2：抽取通用核心

目标：保持当前功能可用的同时，把 chat 和供应商从核心逻辑移出。

- [ ] 定义 `Parser`、`Chunker`、`Embedder`、`RetrievalStore`、`Reranker` 和 `JobQueue` ports。
- [ ] 将当前 LlamaCloud、Zhipu、PostgreSQL、DashScope 实现迁移为 adapters。
- [ ] 新建 collection/scope 查询边界和权限校验入口。
- [ ] 保留 `retrieveDocumentChunks({ chatId, ... })` 兼容包装器，内部映射到新服务。
- [ ] 将 AI SDK tools 和 proactive retrieval 继续路由到同一应用服务。
- [ ] 用 contract tests 验证不同 adapter 的输入、输出、错误和 metadata 语义一致。
- [ ] 在一个真实替代实现出现前，不为每个 port 增加复杂注册表或动态插件发现。

验收：核心 domain/retrieval/ingestion 代码不读取 `process.env`，不导入 `next/server`，也不出现供应商 API URL；旧 chat 行为通过兼容层保持。

### 5.4 阶段 3：优化检索与回答质量

目标：依据阶段 0 的失败样本做有针对性的改进。

- [ ] 修复超长单段切块，改用 tokenizer 限制并加入小比例 overlap。
- [ ] 保留标题层级、页码、sheet、slide、表格范围和可选 bbox。
- [ ] 对召回结果增加相邻 chunk 扩展和每文档候选配额。
- [ ] 对中文 lexical 检索比较 trigram/ngram、统一 tokenizer 或外部检索引擎；只采用真实基线更好的方案。
- [ ] 无远端 reranker 时默认保持 RRF 顺序，而不是使用未经验证的启发式重排。
- [ ] 根据 answerable/unanswerable score 分布校准拒答阈值。
- [ ] 引入查询重写，解决“它的收入呢”之类依赖历史上下文的问题。
- [ ] 区分事实问答、全文摘要和多文档比较：摘要采用章节覆盖/分层总结，比较采用每文档配额。
- [ ] 统一主动检索和工具调用的引用格式，并在 UI 展示文件、页码/章节和原文片段。
- [ ] 将检索上下文标记为不可信数据，明确禁止执行文档中的指令。

验收建议：在固定领域集上 Recall@5 不低于基线，false-retrieval rate 控制在 10% 以下，引用定位正确率达到 95%，P95 检索延迟不超过基线 1.2 倍；若目标冲突，应记录 Pareto 对比而不是只报告单一最佳分数。

### 5.5 阶段 4：灰度迁移与可观测性

- [ ] 新旧检索服务支持 shadow run，记录结果差异但只使用旧结果回答。
- [ ] 对 ingest/retrieve/rerank 建立 trace，携带 resource、pipeline version 和 strategy。
- [ ] 记录每阶段耗时、候选数、空结果率、拒答率、API 错误率和成本。
- [ ] 按用户或 conversation 灰度切换，确认指标后再移除旧表字段和兼容层。
- [ ] 编写数据回填、回滚和孤儿 Blob 清理脚本，并先提供 dry-run。

## 6. 测试策略

| 层级 | 覆盖重点 |
| --- | --- |
| 单元测试 | token 切块边界、RRF、阈值、状态机、幂等键、策略选择 |
| Contract tests | Parser/Embedder/Store/Reranker adapters 的统一语义 |
| PostgreSQL 集成测试 | 权限过滤、事务替换、vector/lexical 查询、唯一约束 |
| 路由测试 | 上传、取消、发送绑定、状态归属、删除与重试 |
| 离线评测 | 召回、排序、不可回答、引用、语言和文档类型 |
| E2E | 用户上传到得到带引用答案的完整流程 |

每个阶段都应保存改动前后的同语料报告。任何声称“效果提升”的提交都必须能链接到报告和具体失败 case，而不是只依赖主观示例。

## 7. 风险与决策约束

- 引入 job 系统会增加运行组件；如果当前部署没有队列，可先用 PostgreSQL job table + worker，保留以后替换队列的 port。
- collection/schema 迁移涉及历史 chat 数据，必须先双写和回填，不能一次性删除 `chatId`。
- 阈值会降低错误召回，也可能降低 Recall；应同时观察 answerable coverage 和 false-retrieval rate。
- 结构化 chunk 会增加 metadata 和索引体积，应基于真实 XLSX/PPTX 用例决定粒度。
- 第三方供应商替换不是目标本身；只有成本、隐私、延迟或质量基线支持时才切换。

## 8. 完成定义

计划只有在以下条件都满足时才能标记 Implemented：

1. 当前聊天文档流程通过权限、取消、重试、删除和恢复测试。
2. 通用核心不依赖 Next.js、chatId、环境变量或具体供应商。
3. 真实评测报告包含可复现版本信息和至少一组改进前后对比。
4. 不可回答问题可以返回空检索结果，回答层能明确拒答。
5. 引用可回到原文件的页码、章节、sheet 或 slide。
6. 文档目录、模块 README、环境变量和迁移说明与实现同步。
