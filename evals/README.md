# RAG 检索评测

`evals/` 提供无需外部服务的 smoke 验证，以及针对真实聊天文档语料的可重复检索
基准。评测只衡量检索，不使用 LLM judge，也不衡量最终回答的忠实度。

## 快速开始

离线验证指标、fixture 和报告生成：

```bash
pnpm test:unit
pnpm eval:rag:smoke
```

smoke 报告固定写入 `evals/results/smoke-latest.json` 和
`evals/results/smoke-latest.md`。生成的报告被 Git 忽略。

显式下载公开数据和语料：

```bash
pnpm eval:rag:download
```

下载不会由安装、单元测试或 smoke 命令触发。产物位于被忽略的 `evals/data/`：

- 30 个 FinanceBench 可回答样本；
- 从未下载对应语料的后续文档派生 5 个不可回答样本；
- 15 个 RGB 中文样本，每题最多保留 2 个正例和 3 个负例段落；
- 所选 FinanceBench PDF 与 RGB 文本语料。

将下载的评测语料上传到同一个聊天并等待处理完成，然后运行真实检索：

```bash
EVAL_CHAT_ID=<uuid> pnpm eval:rag:retrieval -- \
  --cases=evals/data/normalized/financebench.jsonl \
  --strategy=hybrid \
  --rerank=true
```

`EVAL_CHAT_ID` 或 `--cases` 缺失时命令会失败，不会退回 smoke fixture。单个样本
检索失败会写入该 case 的 `error`，其余样本继续执行。

## 数据来源与使用限制

### FinanceBench

- 上游：[Patronus AI FinanceBench](https://github.com/patronus-ai/financebench)
- 使用其公开的 150-case 样本和文档清单。
- 上游仓库未发布明确的仓库级 license；使用或再分发前应核对上游条款，并保留
  来源与归属链接。
- `evidence_page_num` 按上游值原样保留，采用**零基页码**；评测不会自行加一。
- 选择规则：按 `financebench_id` 排序，并跨 `question_reasoning` 轮询选取 30 题。

### RGB 中文数据

- 上游：[Retrieval-Augmented Generation Benchmark (RGB)](https://github.com/chen700564/RGB)
- 许可：CC BY-NC-SA 4.0；仅限非商业使用，要求署名并以相同方式共享。
- 选择规则：按数字 `id` 排序取前 15 题，保留有限数量的正负段落。

更精确的 URL 和选择说明记录在 `evals/datasets/*.manifest.json`。

## 规范化格式

问题文件使用 JSONL，每行结构为：

```typescript
type RagEvalCase = {
  id: string;
  query: string;
  expectedAnswer: string;
  relevantDocumentIds: string[];
  evidenceTexts: string[];
  evidencePages: number[];
  category: string;
  language: "en" | "zh";
  answerable: boolean;
};
```

答案样本必须至少有一个 `relevantDocumentIds`。相关结果必须先匹配 `resourceId`
或去除最终扩展名后的 `fileName`，再匹配 gold 页码或规范化 evidence 文本。

## 指标口径

- `Recall@5`：前 5 个结果是否至少命中一条相关证据；只以可回答样本为分母。
- `MRR`：首个相关结果排名的倒数；只以可回答样本为分母。
- `NDCG@5`：前 5 个二元相关性排名的归一化折损累计增益；只以可回答样本为分母。
- `False-retrieval rate`：不可回答样本中返回任意结果的比例；只以不可回答样本为分母。
- `Latency P50/P95`：所有 case 墙钟检索耗时的 nearest-rank 百分位。

JSON 报告保留每个 case 的相关排名、召回数量、耗时和错误，便于检查聚合值背后的
失败模式。

## 策略对比

对同一个 `EVAL_CHAT_ID` 和 cases 文件分别运行：

```bash
EVAL_CHAT_ID=<uuid> pnpm eval:rag:retrieval -- --cases=evals/data/normalized/financebench.jsonl --strategy=vector --rerank=false
EVAL_CHAT_ID=<uuid> pnpm eval:rag:retrieval -- --cases=evals/data/normalized/financebench.jsonl --strategy=lexical --rerank=false
EVAL_CHAT_ID=<uuid> pnpm eval:rag:retrieval -- --cases=evals/data/normalized/financebench.jsonl --strategy=hybrid --rerank=false
EVAL_CHAT_ID=<uuid> pnpm eval:rag:retrieval -- --cases=evals/data/normalized/financebench.jsonl --strategy=hybrid --rerank=true
```

runner 使用 strategy、rerank 模式和时间戳命名 JSON/Markdown，因此四次运行会分别
保留。比较时以 JSON 为机器可读基线，并同时记录代码提交、chat ID 对应的语料版本、
embedding 模型和是否配置 `DASHSCOPE_API_KEY`；不要把 smoke fixture 分数当成真实
语料质量。
