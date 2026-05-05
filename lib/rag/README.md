# RAG 混合检索实现

## 概述

实现了 **BM25 + 向量检索** 的混合检索，使用 **Reciprocal Rank Fusion (RRF)** 算法融合结果。

## 架构

```
用户查询
    ↓
    ├─→ 向量检索 (语义相似) → top 20
    └─→ BM25 检索 (关键词匹配) → top 20
            ↓
        RRF 融合算法
            ↓
        返回 top 5
```

## 核心文件

### 1. `lib/db/schema.ts`
- 添加了 GIN 全文搜索索引：`content_search_idx`
- 使用 PostgreSQL 的 `to_tsvector` 和 `to_tsquery`
- **配置**: `simple` - 支持中英文混合，无停用词过滤

### 2. `lib/db/queries.ts`
- `bm25Search()`: BM25 全文检索
  - 使用 `ts_rank_cd` 计算相关性分数
  - 支持多词查询（AND 逻辑）
  - **语言配置**: `simple` - 兼容多语言

### 3. `lib/rag/hybrid-search.ts`
- `hybridSearch()`: 混合检索主函数
- `reciprocalRankFusion()`: RRF 融合算法

### 4. `lib/ai/tools/rag/retrieve-documents.ts`
- 修改为使用 `hybridSearch()` 替代 `similaritySearch()`

## RRF 算法原理

**公式**: `RRF_score = Σ 1 / (k + rank_i)`

- `k`: 常数，默认 60（平滑参数）
- `rank_i`: 在第 i 个检索列表中的排名

**示例**:
```
查询: "API key"

向量检索结果:
1. doc1 (语义相关)
2. doc2 (包含 "API key")
3. doc3 (配置相关)

BM25 检索结果:
1. doc2 (精确匹配 "API key")
2. doc4 (包含 "key")
3. doc1 (包含 "API")

RRF 分数:
- doc2: 1/(60+2) + 1/(60+1) = 0.0325 ← 最高（两个列表都靠前）
- doc1: 1/(60+1) + 1/(60+3) = 0.0323
- doc3: 1/(60+3) + 0 = 0.0159
- doc4: 0 + 1/(60+2) = 0.0161

最终排序: doc2 > doc1 > doc4 > doc3
```

## 优势

### 向量检索的优势
- ✅ 语义理解（同义词、改写）
- ✅ 跨语言相似性
- ❌ 精确匹配弱
- ❌ 专有名词不准

### BM25 的优势
- ✅ 精确关键词匹配
- ✅ 专有名词、代码、数字
- ❌ 无语义理解
- ❌ 同义词无法匹配

### 混合检索的优势
- ✅ 结合两者优点
- ✅ 精确匹配 + 语义理解
- ✅ 去重（同一文档块只出现一次）
- ✅ 鲁棒性强（一个失败另一个兜底）

## 使用方法

### 基本用法
```typescript
import { hybridSearch } from "@/lib/rag/hybrid-search";
import { embedText } from "@/lib/rag/embed";

const query = "PostgreSQL JSONB 索引";
const embedding = await embedText(query);

const results = await hybridSearch({
  chatId: "chat-123",
  query,
  embedding,
  limit: 5,  // 返回 top 5
});
```

### 高级配置
```typescript
const results = await hybridSearch({
  chatId: "chat-123",
  query,
  embedding,
  limit: 5,          // 最终返回数量
  vectorLimit: 20,   // 向量检索召回数量
  bm25Limit: 20,     // BM25 检索召回数量
});
```

## 数据库迁移

```bash
# 生成迁移文件
pnpm db:generate

# 运行迁移（创建全文搜索索引）
pnpm db:migrate
```

迁移 SQL:
```sql
-- 删除旧索引（如果存在）
DROP INDEX IF EXISTS "content_search_idx";

-- 创建新索引（使用 simple 配置支持多语言）
CREATE INDEX IF NOT EXISTS "content_search_idx" 
ON "DocumentChunk" 
USING gin (to_tsvector('simple', "content"));
```

**为什么用 `simple` 而不是 `english`**:
- ✅ 支持中英文混合内容
- ✅ 不会过滤停用词（保留所有词）
- ✅ 不做词干提取（保持原词）
- ⚠️ 索引稍大（因为不过滤停用词）

## 性能优化

### 索引优化
- GIN 索引适合全文搜索
- 向量索引使用 pgvector 的余弦距离

### 查询优化
- 并行执行向量和 BM25 检索
- 召回阶段取 top 20，融合后取 top 5
- 避免重复计算（去重逻辑）

### 调优参数
```typescript
// 调整召回数量（更多召回 = 更好覆盖，但更慢）
vectorLimit: 20,  // 默认 20
bm25Limit: 20,    // 默认 20

// 调整 RRF 参数（更大的 k = 更平滑的融合）
k: 60  // 默认 60，范围 [10, 100]
```

## 测试

```bash
# 运行测试
pnpm test lib/rag/__tests__/hybrid-search.test.ts
```

## 下一步优化

1. **重排序 (Reranker)**
   - 已集成 DashScope gte-rerank

2. **引用溯源**
   - 添加 `pageNumber` 字段
   - 返回结果包含页码信息

3. **查询改写**
   - 使用 LLM 改写用户查询
   - 生成多个查询变体

4. **缓存优化**
   - 缓存常见查询的 embedding
   - 缓存检索结果

## 参考资料

- [RRF 论文](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)
- [PostgreSQL 全文搜索](https://www.postgresql.org/docs/current/textsearch.html)
- [LangChain Ensemble Retriever](https://python.langchain.com/docs/modules/data_connection/retrievers/ensemble)


## DashScope Rerank 集成

### 快速配置

```bash
# 1. 获取 API Key
# https://dashscope.console.aliyun.com/

# 2. 配置环境变量
echo "DASHSCOPE_API_KEY=your_key" >> .env.local

# 3. 重启应用
pnpm dev
```

### 自动降级

- ✅ 有 `DASHSCOPE_API_KEY`: 使用 DashScope gte-rerank（高精度）
- ⚠️ 无 API Key: 使用启发式重排序（免费）

### 测试

```bash
npx tsx lib/rag/__tests__/test-rerank.ts
```

## 效果对比

| 功能 | 精度 | 速度 | 成本 |
|------|------|------|------|
| 纯向量检索 | ⭐⭐⭐ | ⚡⚡⚡ | 免费 |
| 混合检索 | ⭐⭐⭐⭐ | ⚡⚡ | 免费 |
| + Rerank (DashScope) | ⭐⭐⭐⭐⭐ | ⚡⚡ | 按量付费 |
