# RAG 检索架构

> **状态**：Active
>
> **范围**：`lib/rag/` 的检索、融合与重排序
>
> **最后核验**：2026-07-19

## 检索流水线

应用中的主动检索和 `retrieveDocuments` 工具共用同一个入口：

```text
pgvector 稠密向量检索 + PostgreSQL lexical 全文检索
→ Reciprocal Rank Fusion（RRF）
→ 可选 DashScope gte-rerank（无 Key 时使用确定性启发式回退）
```

PostgreSQL 分支使用 `to_tsvector('simple', ...)`、`to_tsquery` 和
`ts_rank_cd`。这是 PostgreSQL 原生 lexical/full-text ranking，**不是 BM25**。

## 代码边界

- `lib/rag/retrieve.ts`：应用级统一入口，负责查询校验和生成一次 embedding。
- `lib/rag/hybrid-search.ts`：按 `vector`、`lexical` 或 `hybrid` 策略调度检索。
- `lib/rag/fusion.ts`：纯 RRF；按数据库 `chunkId` 去重。
- `lib/rag/rerank.ts`：保留检索元数据并增加 `rerankScore`。
- `lib/db/queries.ts`：只负责独立的向量查询和 lexical 查询。
- `evals/`：离线 smoke 与真实语料检索基准，详见 [`evals/README.md`](../../evals/README.md)。

标准结果包含 `chunkId`、`resourceId`、文件名、块号、页码，以及可用的
`vectorDistance`、`lexicalRank`、`fusionScore`、`rerankScore`。

## 使用方法

调用方应使用统一服务，不直接组合 embedding 与数据库查询：

```typescript
import { retrieveDocumentChunks } from "@/lib/rag/retrieve";

const chunks = await retrieveDocumentChunks({
  chatId: "chat-uuid",
  query: "PostgreSQL JSONB 索引",
  limit: 5,
  strategy: "hybrid",
  useRerank: true,
});
```

策略语义：

- `vector`：仅 pgvector；会生成 query embedding。
- `lexical`：仅 PostgreSQL 全文检索；不会生成 embedding。
- `hybrid`：两路并行召回后使用 RRF。

## 排序与回退

RRF 使用 `Σ 1 / (k + rank)`，默认 `k = 60`。一路没有结果时，另一路仍会
按 RRF 的单列表分数返回；两路都为空时返回空数组。开启 rerank 时，候选结果
由 DashScope `gte-rerank` 排序；没有 `DASHSCOPE_API_KEY` 或远端调用失败时，
使用本地启发式排序。

## 数据库索引

`DocumentChunk.content` 使用 `simple` 配置的 GIN 全文索引，以保留中英文混合
内容中的原始词项。向量检索使用 pgvector 余弦距离。数据库迁移命令：

```bash
pnpm db:generate
pnpm db:migrate
```

## 验证

```bash
pnpm test:unit
pnpm eval:rag:smoke
```

真实语料的下载、导入和策略对比命令见 [`evals/README.md`](../../evals/README.md)。
