# FurryChatbot

一个基于 Next.js 16 和 AI SDK 构建的ai chatbot应用，支持自定义配置多模型、流式对话、文档解析、RAG 检索增强生成和代码沙箱等功能。

## 技术栈

- **框架**: [Next.js 16](https://nextjs.org) (App Router, React 19, RSC, Server Actions)
- **AI**: [AI SDK 6](https://ai-sdk.dev) 统一接入多种大模型，支持流式输出和工具调用
- **UI**: [shadcn/ui](https://ui.shadcn.com) + [Radix UI](https://radix-ui.com) + [Tailwind CSS 4](https://tailwindcss.com)
- **认证**: [Auth.js 5](https://authjs.dev)
- **数据库**: PostgreSQL + [Drizzle ORM](https://orm.drizzle.team)，支持 pgvector 向量检索
- **存储**: [Vercel Blob](https://vercel.com/storage/blob) 文件存储
- **测试**: [Playwright](https://playwright.dev) E2E 测试

## 功能特性

- **多模型支持**: 通过 AI SDK 接入 OpenAI、Anthropic 等多家模型提供商
- **流式对话**: 实时流式聊天，支持 markdown 渲染和代码高亮
- **Artifacts**: 实时预览文档、代码、表格和图片，完成后按需加载编辑器，并支持版本 Diff、保存状态与流错误恢复
- **RAG 检索增强生成**: 支持文档上传解析（PDF/DOCX/XLSX/PPTX/TXT），pgvector 与 PostgreSQL lexical 检索经 RRF 融合，并可用阿里云百炼 Qwen3-Rerank 重排序
- **项目知识库**: 一个项目可包含多个会话和共享文件库，项目会话自动检索项目资料，同时保留会话自己的附件
- **网络搜索**: 集成 Tavily 搜索引擎，实时获取网络信息
- **图片生成**: 支持 AI 图片生成（SiliconFlow FLUX）
- **多模态输入**: 支持文本和文件混合输入
- **代码编辑器**: 内嵌 CodeMirror，支持语法高亮和编辑
- **主题切换**: 支持亮色/暗色主题
- **对话管理**: 对话历史持久化，支持公开/私密设置

## 本地运行

需要配置以下环境变量（参考 [.env.example](.env.example)）：

- `AUTH_SECRET` — 认证密钥，用于加密会话
- `BLOB_READ_WRITE_TOKEN` — 公开图片附件使用的 Vercel Blob 存储 Token
- `PRIVATE_BLOB_READ_WRITE_TOKEN` — 项目知识文件使用的独立私有 Vercel Blob 存储 Token
- `POSTGRES_URL` — PostgreSQL 数据库连接串
- `ENCRYPTION_KEY` — API Key 加密密钥（AES-256-GCM）

可选的功能 Key：

- `LLAMA_CLOUD_API_KEY` — 文档解析（LlamaCloud）
- `IMAGE_GEN_API_KEY` — AI 图片生成（SiliconFlow）
- `ZHIPU_API_KEY` — 文本嵌入模型（智谱 Embedding-3）
- `ALIYUN_RERANK_API_KEY` — 阿里云百炼工作空间 API Key（Qwen3-Rerank）
- `ALIYUN_RERANK_BASE_URL` — 百炼工作空间 API 基址，包含 `/api/v1`
- `TAVILY_API_KEY` — 网络搜索（Tavily）

```bash
# 安装依赖
pnpm install

# 初始化数据库
pnpm db:migrate

# 启动开发服务器
pnpm dev
```

应用将在 [localhost:3000](http://localhost:3000) 启动。

## 常用命令

```bash
pnpm dev          # 开发模式
pnpm build        # 构建生产版本
pnpm start        # 启动生产服务
pnpm lint         # 代码检查
pnpm format       # 代码格式化
pnpm test         # 运行 E2E 测试
pnpm test:unit    # 运行单元测试与 RAG 评测契约测试
pnpm test:artifacts # 运行 Artifact Markdown 与流状态单测
pnpm perf:artifacts # 运行本地 Artifact 固定压力基准
pnpm eval:rag:smoke # 运行离线 RAG smoke 评测
pnpm eval:rag:real  # 运行 quick 中英文及项目场景真实评测
pnpm eval:rag:full  # 运行完整中英文四策略评测
pnpm db:generate  # 生成数据库迁移文件
pnpm db:migrate   # 执行数据库迁移
pnpm db:studio    # 打开 Drizzle Studio
```

## Playwright 浏览器测试

仓库包含可运行的 Playwright 端到端用例，但能否直接在本机执行取决于操作系统支持和浏览器动态库。Playwright 1.51 **不支持 Ubuntu 26.04**；在该系统上运行下面的标准安装命令会失败，不要把 fallback 提示当成安装成功：

```bash
# 仅适用于 Playwright 1.51 支持的 Linux 版本；Ubuntu 26.04 不可用
pnpm exec playwright install --with-deps chromium
```

`playwright.config.ts` 会自动启动 `pnpm dev`，并等待 `/ping` 可用；如果本地已经启动开发服务器，则直接复用。运行前仍需按本页“本地运行”章节准备 `.env.local`、PostgreSQL 和认证所需配置。

```bash
# 运行全部 Playwright E2E 测试
pnpm test

# 只运行 Artifact 桌面与移动端回归（当前 7 个场景）
pnpm exec playwright test tests/e2e/artifacts.test.ts --project=e2e

# 打开最近一次 HTML 报告
pnpm exec playwright show-report
```

Artifact 浏览器用例会在浏览器内 mock timed `ReadableStream` 和文档 API，覆盖 text、code、sheet、image 的流式预览、完成态编辑器、关闭响应、空文档保存失败和错误恢复。`pnpm test:artifacts` 是 Markdown parser 与 stream reducer 的快速单元测试，不会启动浏览器。

### Ubuntu 26.04

仓库当前锁定的 Playwright 1.51 安装器不支持 Ubuntu 26.04，因此不要运行 `install --with-deps`。在 WSL2 Ubuntu 26.04 上，若 Chromium 启动时报缺少 `libnss3.so`、`libnssutil3.so` 或 `libnspr4.so`，安装以下两个系统包即可：

```bash
sudo apt-get update
sudo apt-get install -y libnss3 libnspr4
```

如果 `~/.cache/ms-playwright` 中还没有 Chromium，再用 Ubuntu 24.04 fallback 下载浏览器；已有浏览器缓存时跳过此步：

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 \
  pnpm exec playwright install chromium
```

安装完成后直接运行测试，不需要继续设置 fallback：

```bash
pnpm test

# 只运行项目知识库流程
PLAYWRIGHT=True pnpm exec playwright test tests/e2e/projects.test.ts \
  --project=e2e --workers=1
```

如果浏览器仍无法启动，用以下命令检查其他缺失的动态库：

```bash
find ~/.cache/ms-playwright -path "*/chrome-linux/headless_shell" -type f \
  -exec ldd {} \; | grep "not found"
```

上述两包安装完成后，项目知识库聚焦用例已在 WSL2 Ubuntu 26.04 上通过。GitHub Actions 工作流仍会在受支持的 runner 上安装 Chromium 并运行 `pnpm test`。

## 项目结构

```
app/              — Next.js App Router 页面和布局
components/       — React UI 组件 (ui/ 为通用基础组件)
lib/ai/           — 模型/提供商/提示词和工具集成
lib/db/schema.ts  — Drizzle ORM 数据模型定义
lib/rag/          — RAG 检索增强生成相关逻辑
lib/artifacts/    — Artifact 服务端逻辑
tests/e2e/        — Playwright E2E 测试
```

## RAG 检索评测

主动检索和模型工具调用共用同一条流水线：

```text
pgvector 稠密检索 + PostgreSQL lexical 全文检索
→ Reciprocal Rank Fusion
→ 可选阿里云百炼 qwen3-rerank
```

先运行无需数据库或 API Key 的离线校验：

```bash
pnpm eval:rag:smoke
```

配置外部服务后，默认运行中英文与项目场景 quick profile；完整基线使用 `eval:rag:full`：

```bash
pnpm eval:rag:real
pnpm eval:rag:full
```

full profile 当前覆盖 35 个 FinanceBench 英文 case、30 个 RGB 中文 case 和 10 个
中英项目场景，并分别报告文档召回、具体证据召回/覆盖、上下文精确率、拒答误检和延迟。
环境要求、预检、手工单策略运行和完整指标口径见 [`evals/README.md`](evals/README.md)。
首次记录真实基线前不填入推测数值：

| 策略 | Document Recall@5 | Evidence Recall@5 | Context Precision@5 | P95 延迟 |
| --- | --- | --- | --- | --- |
| Vector | Run `pnpm eval:rag:full` | Run `pnpm eval:rag:full` | Run `pnpm eval:rag:full` | Run `pnpm eval:rag:full` |
| Lexical | Run `pnpm eval:rag:full` | Run `pnpm eval:rag:full` | Run `pnpm eval:rag:full` | Run `pnpm eval:rag:full` |
| Hybrid | Run `pnpm eval:rag:full` | Run `pnpm eval:rag:full` | Run `pnpm eval:rag:full` | Run `pnpm eval:rag:full` |
| Hybrid + rerank | Run `pnpm eval:rag:full` | Run `pnpm eval:rag:full` | Run `pnpm eval:rag:full` | Run `pnpm eval:rag:full` |

## 文档与开发约定

- [项目文档目录](docs/README.md) — 架构文档、变更记录、设计计划及其维护状态
- [仓库工作约定](AGENTS.md) — 开发流程、验证要求和文档治理规则
- [OpenSpec 变更记录](openspec/changes/) — 功能 proposal、design、specs 与 tasks

文档描述与代码不一致时，以已验证的代码和配置为准，并在同一次变更中更新相应文档。
