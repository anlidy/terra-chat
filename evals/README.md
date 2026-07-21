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

## 分层真实评测

`.env.local` 配置 `POSTGRES_URL`、`LLAMA_CLOUD_API_KEY`、`ZHIPU_API_KEY`、
`ALIYUN_RERANK_API_KEY` 和 `ALIYUN_RERANK_BASE_URL` 后运行：

```bash
pnpm eval:rag:real
```

默认命令运行适合日常开发的 `quick` profile：英文 FinanceBench 固定选择 5 个 case 和
4 份 PDF，中文 RGB 固定选择 5 个 case 及其 25 个正负例文本，项目场景固定选择 10 个
中英文 case 和 4 份 TXT；默认只运行 hybrid、不启用 rerank。profile 清单位于
`evals/profiles/`，选择是确定性的，不会随机漂移。报告保留在
`evals/results/`；临时 chat、resource、chunk 和用户会在成功或失败后自动清理。

发布前或定时任务运行完整中英文语料和四策略矩阵：

```bash
pnpm eval:rag:full
```

full 英文集包含 35 个 case 和 22 份 PDF；full 中文集包含 15 个 case 和 75 个正负例
文本。TXT 在本地解码，PDF/DOCX/XLSX/PPTX 才调用 LlamaCloud；两类语料仍共用生产
切块、Embedding、写库和检索流程。

真实解析、Embedding 和可选远端 rerank 会产生外部 API 调用。正式执行前可做不连接
数据库、不调用外部 API 的预检：

```bash
pnpm eval:rag:real -- --dry-run
```

可选参数：

- `--profile=quick|full`：默认 `quick`；full 使用完整数据集；
- `--dataset=en|zh|project|all`：默认 `all`；分别选择 FinanceBench、RGB 中文、项目场景或全部；
- `--strategies=vector,lexical,hybrid,hybrid-rerank|all`：默认 `hybrid`；
- `--refresh`：重新拉取上游 cases 和语料，已存在的非空 PDF 不重复下载；
- `--keep-data`：运行结束后保留新建的临时用户和 chat；
- `--ingest-only`：只摄取并保留数据，日志会输出可复用的 chat ID；
- `--reuse-chat=<uuid>`：跳过解析和 Embedding，复用已 ready 的评测 chat。
- `--answer-model=<provider-id>/<model-id>`：用当前账号已配置的模型生成回答并运行同模型 faithfulness judge，同时统计引用、token、外部调用和成本。

摄取与策略评测可以分开，避免每次策略调整都重新解析文档：

```bash
# 首次摄取；也可追加 --profile=full --dataset=all
pnpm eval:rag:ingest

# 使用上一条日志输出的 chat ID，只运行需要比较的策略
pnpm eval:rag:real -- \
  --reuse-chat=<uuid> \
  --profile=quick \
  --dataset=all \
  --strategies=vector,lexical,hybrid
```

复用 chat 时，runner 会确认所选文档均为 ready，并将检索限制到当前 profile 的
resource ID；因此 full chat 可以安全运行 quick profile，不会把 full 的额外文档混入
quick 结果。resource 还记录文件内容、pipeline version 和 Embedding 配置指纹；任何一项
变化都会拒绝复用，避免旧向量被标记为当前 corpus。case set 和 corpus hash 也只基于
当前选择计算。

摄取日志会按文档显示解析、Embedding 批次、写库和总耗时。Embedding-3 按官方上限
每批最多提交 64 个 chunk，并对网络错误、HTTP 408/429 和 5xx 做最多 3 次有限重试；
认证或请求参数错误会立即失败。失败日志包含当前评测阶段、文件名、resource ID、批次和
底层网络错误码，便于区分连接故障、API 拒绝与写库故障。

`eval:rag:real` 会启用 Node 的环境代理支持；设置了 `HTTP_PROXY`、`HTTPS_PROXY` 或
`NO_PROXY` 时，外部解析、Embedding、rerank 和数据下载请求会遵循这些变量。

未同时配置 `ALIYUN_RERANK_API_KEY` 和 `ALIYUN_RERANK_BASE_URL`，或远端调用失败时，
rerank 策略仍会运行；报告会同时记录 `aliyun/qwen3-rerank` 的尝试状态、失败原因和
最终使用的 `heuristic` reranker。命令中断或进程被强制终止时，`finally` 清理无法得到保证；临时
chat 标题以 `RAG evaluation` 开头，便于定位。复用 chat 和 `--ingest-only` 创建的数据
不会自动删除，需要在不再使用时手工删除对应 chat/用户。

## 手工运行单组策略

仅需补齐本地公开数据时可以运行：

```bash
pnpm eval:rag:download
```

下载不会由安装、单元测试或 smoke 命令触发。产物位于被忽略的 `evals/data/`：

- 30 个 FinanceBench 可回答样本；
- 从未下载对应语料的后续文档派生 5 个不可回答样本；
- 15 个 RGB 中文样本，每题最多保留 2 个正例和 3 个负例段落；
- 所选 FinanceBench PDF 与 RGB 文本语料。

也可以将下载的评测语料手工上传到同一个聊天并等待处理完成，然后运行单组真实检索：

```bash
EVAL_CHAT_ID=<uuid> pnpm eval:rag:retrieval -- \
  --cases=evals/data/normalized/financebench.jsonl \
  --corpus=evals/data/corpus/financebench \
  --strategy=hybrid \
  --rerank=true
```

`EVAL_CHAT_ID`、`--cases` 或 `--corpus` 缺失时命令会失败，不会退回 smoke
fixture。`--corpus` 必须指向本次实际上传的完整语料文件或目录；runner 会基于相对
文件名和内容计算稳定 SHA-256。单个样本检索失败会写入该 case 的 `error`，其余样本
继续执行。

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

### Project scenarios

- 语料和 cases 位于 `evals/fixtures/project/`，随代码版本管理，不依赖外部下载。
- 10 个中英文 case 覆盖事实、摘要、多文档比较、不可回答、Markdown 表格和 slide 结构内容。
- 语料使用 TXT 以复用本地确定性解析；这里只验证表格/幻灯片内容形态，不代表已验证真实 XLSX/PPTX 解析或页码、sheet、slide metadata。

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

JSON 报告保留每个 case 的相关排名、召回数量、耗时、错误，以及 top-k 的
chunk/resource、文件、页码、内容预览、gold 相关性和各阶段分数。Markdown 失败表
直接列出 top-k 文件位置与分数，便于检查聚合值背后的失败模式。JSON 和 Markdown
还会记录 Git revision（有未提交修改时带 `-dirty`）、
case set/corpus SHA-256、pipeline version、embedding model、远端 reranker 尝试及失败原因、
实际使用过的 reranker 以及最小相关性阈值。当前检索未启用阈值，因此记录为
`null`/`disabled`。

启用 `--answer-model` 时会额外生成 answer JSON 报告。引用正确率由 gold document
确定性核验；faithfulness 由指定模型根据检索上下文评分。当前 answer 与 judge 使用同一
模型，报告以 `judgeIndependence: same-model` 明示其偏乐观风险。DeepSeek V4 Flash
成本按官方每百万 token 价格计算：缓存命中输入 USD 0.0028、未命中输入 USD 0.14、
输出 USD 0.28；实际 cache token 明细来自模型 usage。

## 策略对比

对同一个 `EVAL_CHAT_ID` 和 cases 文件分别运行：

```bash
EVAL_CHAT_ID=<uuid> pnpm eval:rag:retrieval -- --cases=evals/data/normalized/financebench.jsonl --corpus=evals/data/corpus/financebench --strategy=vector --rerank=false
EVAL_CHAT_ID=<uuid> pnpm eval:rag:retrieval -- --cases=evals/data/normalized/financebench.jsonl --corpus=evals/data/corpus/financebench --strategy=lexical --rerank=false
EVAL_CHAT_ID=<uuid> pnpm eval:rag:retrieval -- --cases=evals/data/normalized/financebench.jsonl --corpus=evals/data/corpus/financebench --strategy=hybrid --rerank=false
EVAL_CHAT_ID=<uuid> pnpm eval:rag:retrieval -- --cases=evals/data/normalized/financebench.jsonl --corpus=evals/data/corpus/financebench --strategy=hybrid --rerank=true
```

runner 使用 dataset/profile、strategy、rerank 模式和时间戳命名 JSON/Markdown，
因此中英文与各策略报告会分别保留。比较时以 JSON 为机器可读基线；报告中的
`rerankers` 记录实际执行结果，包括远端失败后的回退，而不是根据
环境变量推测。不要把 quick 或 smoke 分数与 full 基线混为一组。

检索日志中的 `[Lexical Search Error]` 表示 lexical 分支已回退为空结果；hybrid 仍可由
vector 分支完成 case，因此报告的 `Errors` 可能仍为 0。出现该日志时不能把报告视为
有效的 hybrid 基线，应先修复查询或数据库问题，再用相同 chat、profile 和策略重跑。
