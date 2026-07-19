# Artifacts 功能文档

> **状态**：Needs review
>
> **范围**：Artifacts 架构、数据流与扩展方式
>
> **最后核验**：未记录；使用文件行号和实现细节前请与当前代码核对
>
> FurryChatbot 的富内容生成与编辑系统。当 AI 需要生成大量内容时，在聊天界面右侧弹出独立面板，实时流式渲染内容，支持在线编辑、版本历史、代码执行等功能。

---

## 目录

1. [架构总览](#1-架构总览)
2. [文件清单](#2-文件清单)
3. [数据库设计](#3-数据库设计)
4. [核心类型与抽象](#4-核心类型与抽象)
5. [数据流详解](#5-数据流详解)
6. [四种 Artifact 类型](#6-四种-artifact-类型)
7. [UI 渲染层级](#7-ui-渲染层级)
8. [API 接口](#8-api-接口)
9. [状态管理](#9-状态管理)
10. [AI 行为约束](#10-ai-行为约束)
11. [扩展指南](#11-扩展指南)

---

## 1. 架构总览

```
┌──────────────────────────────────────────────────────────┐
│                      AI SDK Layer                          │
│   createDocument / updateDocument / requestSuggestions      │
│   (注册在 /api/chat/route.ts 的 AI tools)                    │
└───────────────────────┬──────────────────────────────────┘
                        │ 调用
┌───────────────────────▼──────────────────────────────────┐
│               DocumentHandler (策略模式)                    │
│   lib/artifacts/server.ts — createDocumentHandler()        │
│   ┌───────────┬───────────┬───────────┐                   │
│   │   text    │   code    │   sheet   │                   │
│   │  handler  │  handler  │  handler  │                   │
│   └───────────┴───────────┴───────────┘                   │
│   每个 handler: streamText / streamObject → 流式生成          │
│   框架层: 内容完成后自动 saveDocument() 写入 PostgreSQL        │
└───────────────────────┬──────────────────────────────────┘
                        │ data-* stream parts (transient)
┌───────────────────────▼──────────────────────────────────┐
│              Client Data Stream Pipeline                    │
│   DataStreamHandler → per-kind onStreamPart                 │
│   → useArtifact (SWR global state)                          │
└───────────────────────┬──────────────────────────────────┘
                        │ 渲染
┌───────────────────────▼──────────────────────────────────┐
│                     UI Layer                                │
│   DocumentPreview (inline) / Artifact Panel (overlay)       │
│   ┌──────────┬───────────┬───────────┬──────────┐         │
│   │  Editor  │ CodeEditor│ Spread-   │  Image   │         │
│   │  (text)  │ + Pyodide │  sheet    │ Editor   │         │
│   └──────────┴───────────┴───────────┴──────────┘         │
└──────────────────────────────────────────────────────────┘
```

**设计核心思想**：聊天界面是线性、对话式的，不适合展示长内容或进行持续编辑。Artifacts 将"文档"从"对话"中分离出来，形成独立的工作区。AI 负责生成，用户可以编辑、执行、查看历史版本，修改后的内容通过对话再次交给 AI 迭代。

---

## 2. 文件清单

### 核心库

| 文件 | 作用 |
|------|------|
| `lib/artifacts/server.ts` | `DocumentHandler` 类型定义、`createDocumentHandler()` 工厂、注册表 `documentHandlersByArtifactKind` |
| `lib/ai/prompts/sections/artifacts.ts` | 写入 system prompt 的 `<artifacts>` 指令块 |
| `lib/ai/prompts/sections/tools.ts` | 工具使用指南（提及 document 类工具） |
| `lib/ai/prompts/builder.ts` | 组装完整 system prompt，包含 artifacts 部分 |

### 数据库

| 文件 | 作用 |
|------|------|
| `lib/db/schema.ts` (行 109-156) | `document` 表和 `suggestion` 表的 Drizzle ORM schema |
| `lib/db/queries.ts` (行 336-445) | `saveDocument`、`getDocumentsById`、`getDocumentById`、`deleteDocumentsByIdAfterTimestamp`、`saveSuggestions`、`getSuggestionsByDocumentId` |

### AI Tools（服务端）

| 文件 | 作用 |
|------|------|
| `lib/ai/tools/artifacts/create-document.ts` | `createDocument` tool：生成 UUID、写入 stream parts、调度 DocumentHandler |
| `lib/ai/tools/artifacts/update-document.ts` | `updateDocument` tool：获取已有文档、调用 handler 重新生成 |
| `lib/ai/tools/artifacts/request-suggestions.ts` | `requestSuggestions` tool：AI 生成最多 5 条修改建议 |

### AI Provider

| 文件 | 行号 | 作用 |
|------|------|------|
| `lib/ai/providers.ts` | 127-132 | `getArtifactModel(userId)`：获取 artifact 专用的 AI 模型 |

### 各 Artifact 类型实现

| 类型 | 服务端 handler | 客户端 class |
|------|---------------|-------------|
| text | `artifacts/text/server.ts` | `artifacts/text/client.tsx` |
| code | `artifacts/code/server.ts` | `artifacts/code/client.tsx` |
| sheet | `artifacts/sheet/server.ts` | `artifacts/sheet/client.tsx` |
| image | 使用独立 `generateImage` tool | `artifacts/image/client.tsx` |

### React 组件

| 文件 | 作用 |
|------|------|
| `components/artifact.tsx` | 主 `PureArtifact` 覆层面板，定义 `artifactDefinitions` 数组和 `UIArtifact` 类型 |
| `components/create-artifact.tsx` | `Artifact` 类定义及配置类型 |
| `components/artifact-actions.tsx` | 渲染操作按钮（版本导航、复制、运行等） |
| `components/artifact-messages.tsx` | 面板侧边栏中的聊天消息 |
| `components/artifact-close-button.tsx` | 面板关闭按钮 |
| `components/ai-elements/artifact.tsx` | 底层展示组件（Header、Title、Actions 等） |
| `components/document.tsx` | `DocumentToolCall`（加载中动画）和 `DocumentToolResult`（完成按钮） |
| `components/document-preview.tsx` | 聊天消息中的内嵌文档预览卡片 |
| `components/document-skeleton.tsx` | Artifact 加载骨架屏 |
| `components/data-stream-handler.tsx` | 客户端处理 `data-*` stream parts 的核心逻辑 |
| `components/data-stream-provider.tsx` | `DataStreamContext` React context |
| `components/toolbar.tsx` | 右下角浮动工具栏（per-kind 快捷操作） |
| `components/version-footer.tsx` | 查看非最新版本时的版本导航底部栏 |
| `components/diffview.tsx` | Text 类型的 diff 对比视图 |
| `components/suggestion.tsx` | 渲染 text 文档的 AI 修改建议 |
| `components/console.tsx` | Code 类型的 Pyodide 执行控制台 |
| `components/chat.tsx` | 主 Chat 组件，渲染 `<Artifact />` 覆层 |
| `components/messages.tsx` | 消息面板 |
| `components/message.tsx` | 消息渲染，包含 `DocumentPreview`、`DocumentToolCall`、`DocumentToolResult` |

### API 路由

| 文件 | 方法 | 作用 |
|------|------|------|
| `app/(chat)/api/chat/route.ts` | POST | 注册 `createDocument`、`updateDocument`、`requestSuggestions` 为 AI tools |
| `app/(chat)/api/document/route.ts` | GET/POST/DELETE | 文档 CRUD（获取版本列表、保存新版本、删除） |

### Hooks

| 文件 | 作用 |
|------|------|
| `hooks/use-artifact.ts` | `useArtifact()` 和 `useArtifactSelector()`：基于 SWR 的全局 artifact 状态管理 |

---

## 3. 数据库设计

### Document 表

```sql
CREATE TABLE "Document" (
  id          uuid      NOT NULL DEFAULT gen_random_uuid(),
  createdAt   timestamp NOT NULL,
  title       text      NOT NULL,
  content     text,
  kind        varchar   CHECK (kind IN ('text', 'code', 'image', 'sheet'))
                        NOT NULL DEFAULT 'text',
  userId      uuid      NOT NULL REFERENCES "User"(id),
  PRIMARY KEY (id, createdAt)
);
```

**版本化策略**：复合主键 `(id, createdAt)` 采用 append-only 模式。每次保存文档不执行 UPDATE，而是 INSERT 新行（相同 `id`，新的 `createdAt`）。查询最新版本使用 `ORDER BY createdAt DESC LIMIT 1`，查询所有版本使用 `ORDER BY createdAt ASC`。

**为什么不用独立的版本号字段？** 时间戳天然单调递增且不需要事务内自增，避免了并发下的版本号竞争。删除操作删除指定时间戳之后的所有版本，相当于"回滚到某个时间点"。

kinds:
- `text` — 富文本文档（Markdown 支持）
- `code` — 代码（默认 Python）
- `sheet` — CSV 表格
- `image` — Base64 编码的图片

### Suggestion 表

```sql
CREATE TABLE "Suggestion" (
  id                uuid      NOT NULL DEFAULT gen_random_uuid(),
  documentId        uuid      NOT NULL,
  documentCreatedAt timestamp NOT NULL,
  originalText      text      NOT NULL,
  suggestedText     text      NOT NULL,
  description       text,
  isResolved        boolean   NOT NULL DEFAULT false,
  userId            uuid      NOT NULL REFERENCES "User"(id),
  createdAt         timestamp NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (documentId, documentCreatedAt) 
    REFERENCES "Document"(id, createdAt)
);
```

Suggestion 通过外键 `(documentId, documentCreatedAt)` 关联到特定文档的特定版本。每个 suggestion 包含原始句子、建议修改后的句子和描述。`isResolved` 标记是否已被处理（当前实现中默认为 false）。

### 数据库查询函数

```typescript
// lib/db/queries.ts

saveDocument({ id, title, kind, content, userId })       // INSERT 新版本
getDocumentsById({ id })                                  // 获取某文档所有版本 (ASC)
getDocumentById({ id })                                   // 获取最新版本 (DESC LIMIT 1)
deleteDocumentsByIdAfterTimestamp({ id, timestamp })      // 删除某时间后的版本（含关联 suggestions）
saveSuggestions({ suggestions })                          // 批量保存建议
getSuggestionsByDocumentId({ documentId })                // 获取某文档的所有建议
```

---

## 4. 核心类型与抽象

### 4.1 服务端：DocumentHandler

`lib/artifacts/server.ts` 中定义了 handler 的接口和工厂函数：

```typescript
// === 回调参数类型 ===

type CreateDocumentCallbackProps = {
  id: string;                                      // 预生成的 UUID
  title: string;                                   // 用户/AI 给的标题
  dataStream: UIMessageStreamWriter<ChatMessage>;   // 用于写入 stream parts
  session: Session;
};

type UpdateDocumentCallbackProps = {
  document: Document;                              // 已存在的文档
  description: string;                             // 用户要求的修改描述
  dataStream: UIMessageStreamWriter<ChatMessage>;
  session: Session;
};

// === Handler 接口 ===

type DocumentHandler<T = ArtifactKind> = {
  kind: T;
  onCreateDocument: (args: CreateDocumentCallbackProps) => Promise<void>;
  onUpdateDocument: (args: UpdateDocumentCallbackProps) => Promise<void>;
};

// === 工厂函数 ===

function createDocumentHandler<T extends ArtifactKind>(config: {
  kind: T;
  onCreateDocument: (params) => Promise<string>;  // 返回生成的内容
  onUpdateDocument: (params) => Promise<string>;  // 返回更新后的内容
}): DocumentHandler<T>
```

**设计要点**：`createDocumentHandler` 将"流式生成"和"持久化"分离。handler 只需返回内容字符串，框架自动调用 `saveDocument()` 写入数据库。这避免了每个 handler 重复写 DB 代码。

### 4.2 注册表

```typescript
// 所有 handler 注册在此数组中
export const documentHandlersByArtifactKind: DocumentHandler[] = [
  textDocumentHandler,
  codeDocumentHandler,
  sheetDocumentHandler,
  // 注意: image 没有 server-side handler，使用独立的 generateImage tool
];

// AI tool 中用于校验 kind 参数的常量
export const artifactKinds = ["text", "code", "sheet"] as const;
```

### 4.3 客户端：Artifact 类

`components/create-artifact.tsx` 定义了客户端的配置类：

```typescript
class Artifact<T extends string, M = any> {
  readonly kind: T;           // 类型标识符，如 "text" | "code" | "sheet" | "image"
  readonly description: string; // 在 UI 和 AI prompt 中使用的描述
  readonly content: ComponentType<ArtifactContent<M>>; // 主体渲染组件
  readonly actions: ArtifactAction[];    // 版本导航、复制、运行等按钮
  readonly toolbar: ArtifactToolbarItem[]; // 浮动快捷追问按钮
  readonly initialize?: (params) => void; // 首次加载时执行（如拉取 suggestions）
  readonly onStreamPart: (args) => void;  // 处理流式数据块的增量更新
}
```

每个 artifact 类型通过 `new Artifact({...})` 实例化，并在 `components/artifact.tsx` 中注册：

```typescript
export const artifactDefinitions = [
  textArtifact,
  codeArtifact,
  imageArtifact,
  sheetArtifact,
];
export type ArtifactKind = (typeof artifactDefinitions)[number]["kind"];
```

### 4.4 Artifact 内容组件的 Props

编辑器组件接收的完整 props 类型：

```typescript
type ArtifactContent<M = any> = {
  title: string;
  content: string;               // 当前内容
  mode: "edit" | "diff";         // 编辑模式或 diff 对比
  isCurrentVersion: boolean;     // 是否在查看最新版本
  currentVersionIndex: number;   // 当前查看的版本索引
  status: "streaming" | "idle";  // 流式生成中还是空闲
  suggestions: Suggestion[];     // AI 修改建议（仅 text）
  onSaveContent: (updatedContent: string, debounce: boolean) => void;
  isInline: boolean;             // 是否为内嵌预览（非面板模式）
  getDocumentContentById: (index: number) => string; // 获取特定版本内容
  isLoading: boolean;
  metadata: M;                   // per-kind 元数据（如 code 的 console outputs）
  setMetadata: Dispatch<SetStateAction<M>>;
};
```

### 4.5 UIArtifact 全局状态

```typescript
type UIArtifact = {
  title: string;
  documentId: string;
  kind: ArtifactKind;
  content: string;
  isVisible: boolean;        // 面板是否可见
  status: "streaming" | "idle";
  boundingBox: {             // 面板动画起始/结束位置
    top: number;
    left: number;
    width: number;
    height: number;
  };
};
```

---

## 5. 数据流详解

### 5.1 createDocument 完整流程

**第 1 步：AI 触发 `createDocument` tool**

当 AI 判定需要创建文档时（见第 10 节行为约束），调用 `createDocument` tool，传入 `title` 和 `kind` 参数。

**第 2 步：`create-document.ts` 执行**

```typescript
// lib/ai/tools/artifacts/create-document.ts

execute: async ({ title, kind }) => {
  // 1. 生成 document UUID
  const id = generateUUID();

  // 2. 按顺序写入 4 个 transient stream parts
  dataStream.write({ type: "data-kind", data: kind, transient: true });
  dataStream.write({ type: "data-id", data: id, transient: true });
  dataStream.write({ type: "data-title", data: title, transient: true });
  dataStream.write({ type: "data-clear", data: null, transient: true });

  // 3. 查找对应 kind 的 handler
  const documentHandler = documentHandlersByArtifactKind.find(
    (h) => h.kind === kind
  );

  // 4. 调用 handler 的 onCreateDocument（流式生成内容）
  await documentHandler.onCreateDocument({ id, title, dataStream, session });

  // 5. 写入完成信号
  dataStream.write({ type: "data-finish", data: null, transient: true });
}
```

**第 3 步：Handler 流式生成内容**

三种 handler 采用不同的生成策略：

| Handler | AI 方法 | Schema | Delta 类型 |
|---------|--------|--------|-----------|
| text | `streamText` + `smoothStream({ chunking: "word" })` | — | `data-textDelta` |
| code | `streamObject` | `{ code: z.string() }` | `data-codeDelta` |
| sheet | `streamObject` | `{ csv: z.string() }` | `data-sheetDelta` |

- text 使用 `streamText`，逐个 text-delta 写入 `data-textDelta`，并用 `smoothStream` 做词级分块让渲染更流畅
- code 和 sheet 使用 `streamObject` 强制 AI 输出结构化 JSON，整个 object 一次性写入 delta（但也会经过 for-await 增量）

**第 4 步：框架层持久化**

`createDocumentHandler` 工厂在 `onCreateDocument` 完成后自动调用：

```typescript
if (args.session?.user?.id) {
  await saveDocument({
    id: args.id,
    title: args.title,
    content: draftContent,   // handler 返回的完整内容
    kind: config.kind,
    userId: args.session.user.id,
  });
}
```

**第 5 步：客户端 DataStreamHandler 消费**

`components/data-stream-handler.tsx` 从 `DataStreamContext` 读取 stream parts：

```
data-id     → setArtifact({ documentId, status: "streaming" })
data-title  → setArtifact({ title, status: "streaming" })
data-kind   → setArtifact({ kind, status: "streaming" })
data-clear  → setArtifact({ content: "", status: "streaming" })
data-finish → setArtifact({ status: "idle" })
```

per-kind delta 分派给 `artifactDefinition.onStreamPart`：

```typescript
const artifactDefinition = artifactDefinitions.find(
  (def) => def.kind === artifact.kind
);

if (artifactDefinition?.onStreamPart) {
  artifactDefinition.onStreamPart({ streamPart: delta, setArtifact, setMetadata });
}
```

**第 6 步：自动展开逻辑**

每种类型有不同的"自动展开"阈值：

- **text**：当内容在 400-450 字符之间时，`isVisible` 自动变为 `true`
- **code**：当内容在 300-310 字符之间时，`isVisible` 自动变为 `true`
- **sheet / image**：收到第一个 delta 即 `isVisible: true`

阈值设计为窗口（而非单点）是为了避免边界条件下的闪烁。

### 5.2 updateDocument 流程

与 create 类似，但：

1. 从数据库获取已有文档 `getDocumentById({ id })`
2. 写入 `data-clear` 清空客户端内容
3. 调用 `onUpdateDocument`，将原内容和修改描述传给 AI
4. text 类型的 update 使用 `prediction` 优化（OpenAI Predicted Outputs），将原文档作为预测内容以降低延迟和成本
5. 生成完成后 `saveDocument()` 创建新版本（相同 id，新 createdAt）

### 5.3 requestSuggestions 流程

1. 获取文档：`getDocumentById({ id: documentId })`
2. 使用 `streamText` 调用 AI，`output: Output.array({...})` 生成结构化建议数组（最多 5 条）
3. 每条建议实时写入 `data-suggestion` stream part
4. 全部生成后，调用 `saveSuggestions()` 批量写入数据库
5. 客户端的 text artifact `onStreamPart` 将 suggestion 追加到 metadata

### 5.4 用户手动编辑

用户在面板中编辑内容时：

1. 编辑器组件 debounce 2000ms 后触发 `onSaveContent(updatedContent, true)`
2. `PureArtifact` 中的 `handleSaveContent` 调用 `POST /api/document?id=xxx`
3. API 调用 `saveDocument()` 创建新版本
4. 前端通过 SWR revalidate 拉取更新后的版本列表

### 5.5 Stream Parts 类型总结

| Part Type | 来源 | 含义 | 客户端处理 |
|-----------|------|------|-----------|
| `data-kind` | createDocument | 文档类型 | setArtifact: kind |
| `data-id` | createDocument | 文档 UUID | setArtifact: documentId |
| `data-title` | createDocument | 文档标题 | setArtifact: title |
| `data-clear` | createDocument / updateDocument | 清空旧内容 | setArtifact: content="" |
| `data-finish` | createDocument / updateDocument | 流式生成完成 | setArtifact: status="idle" |
| `data-textDelta` | textDocumentHandler | 文本增量 | onStreamPart: 追加到 content |
| `data-codeDelta` | codeDocumentHandler | 代码内容（整体覆盖） | onStreamPart: 设置 content |
| `data-sheetDelta` | sheetDocumentHandler | CSV 内容（整体覆盖） | onStreamPart: 设置 content |
| `data-imageDelta` | generateImage tool | Base64 图片数据 | onStreamPart: 设置 content |
| `data-suggestion` | requestSuggestions | AI 修改建议 | onStreamPart: 追加到 metadata |

**关键设计**：stream parts 都是 `transient: true`，不会持久化到消息数据库中，仅在当前流式会话中传递。

---

## 6. 四种 Artifact 类型

### 6.1 Text

**服务端** (`artifacts/text/server.ts`)：
- 使用 `streamText` + `smoothStream({ chunking: "word" })` 逐词流式输出
- 支持 Markdown 格式
- 更新时使用 OpenAI Predicted Outputs（`prediction.type: "content"`）

**客户端** (`artifacts/text/client.tsx`)：
- 编辑器：`Editor` 组件（富文本编辑）
- Diff 模式：`DiffView` 组件对比两个版本
- Suggestion：`Editor` 渲染内联修改建议
- 自动展开：内容 > 400 字符

**操作按钮**：
- 查看修改（toggle diff/当前版本切换）
- 上一版本 / 下一版本
- 复制到剪贴板

**快捷追问**：
- "Add final polish" — 语法检查 + 添加章节标题
- "Request suggestions" — 请求 AI 修改建议

### 6.2 Code

**服务端** (`artifacts/code/server.ts`)：
- 使用 `streamObject` + Zod schema `{ code: z.string() }`
- system prompt 来自 `codePrompt`

**客户端** (`artifacts/code/client.tsx`)：
- 编辑器：`CodeEditor` 组件
- **Pyodide 在线执行**：加载 Pyodide v0.23.4 在浏览器中运行 Python
  - 自动检测 matplotlib 并配置 base64 图片输出
  - 通过 `loadPackagesFromImports` 自动安装依赖
  - 输出显示在 `Console` 组件中（支持 text 和 image 两种输出类型）
- 自动展开：内容 > 300 字符

**操作按钮**：
- **Run** — 使用 Pyodide 执行代码
- 上一版本 / 下一版本
- 复制代码到剪贴板

**快捷追问**：
- "Add comments" — 添加注释
- "Add logs" — 添加调试日志

### 6.3 Sheet

**服务端** (`artifacts/sheet/server.ts`)：
- 使用 `streamObject` + Zod schema `{ csv: z.string().describe("CSV data") }`
- system prompt 来自 `sheetPrompt`

**客户端** (`artifacts/sheet/client.tsx`)：
- 编辑器：`SpreadsheetEditor` 组件
- 复制时使用 `papaparse` 解析 CSV，过滤空行后再序列化，保证数据整洁
- 自动展开：收到第一个 delta 即展开

**操作按钮**：
- 上一版本 / 下一版本
- 复制为 CSV（经 papaparse 清洗）

**快捷追问**：
- "Format and clean data" — 格式化和清理数据
- "Analyze and visualize data" — 建议创建新的 code artifact 进行数据分析和可视化

### 6.4 Image

**服务端**：无独立 DocumentHandler。图片生成使用独立的 `generateImage` AI tool，写入 `data-imageDelta` stream part。

**客户端** (`artifacts/image/client.tsx`)：
- 编辑器：`ImageEditor` 组件（展示 Base64 解码后的图片）
- 简化版 actions：只有版本导航和复制图片到剪贴板（使用 Canvas API）
- 无 toolbar

**注意**：`artifactKinds` 常量数组中不包含 `"image"`，这意味着 AI 的 `createDocument` tool 不接受 `kind: "image"`。Image 的存储路径与 text/code/sheet 不同（走独立的 generateImage 流程）。

### 6.5 四种类型对比

| 特性 | Text | Code | Sheet | Image |
|------|------|------|-------|-------|
| **AI 生成方法** | `streamText` | `streamObject` | `streamObject` | 独立 tool |
| **结构化输出** | 否 | `{code}` | `{csv}` | — |
| **编辑器** | 富文本 Editor | CodeEditor | SpreadsheetEditor | ImageEditor |
| **特殊能力** | AI 修改建议、diff 视图 | Pyodide Python 执行 | CSV 清洗复制 | Base64 图片复制 |
| **自动展开阈值** | 400-450 字符 | 300-310 字符 | 立即 | 立即 |
| **版本 diff** | 支持 | 不支持 | 不支持 | 不支持 |
| **流式增量** | 逐词追加 | 整体覆盖 | 整体覆盖 | 整体覆盖 |

---

## 7. UI 渲染层级

### 7.1 在聊天消息中的展示

```
聊天消息组件 (message.tsx)
│
├── [文档创建中] DocumentToolCall
│   └── 显示 spinner + "Creating "文档标题"" 文案
│
├── [文档创建完成] DocumentToolResult
│   └── 显示图标 + "Created "文档标题"" 可点击按钮
│
└── [内嵌预览] DocumentPreview
    ├── HitboxLayer — 透明全屏热区（点击打开面板）
    ├── DocumentHeader — 标题栏（图标 + 标题 + 全屏按钮）
    └── DocumentContent — 根据 kind 渲染对应的编辑器（高度 257px 的卡片）
```

### 7.2 全屏面板 (Artifact Panel)

```
Artifact 组件 (artifact.tsx — PureArtifact)
│
├── AnimatePresence 包裹的动画层
│   ├── 背景遮罩 (motion.div)
│   └── 面板主体
│       │
│       ├── 左侧 400px 固定宽度
│       │   ├── ArtifactCloseButton
│       │   └── ArtifactMessages — 聊天对话（可滚动）
│       │       ├── 每条消息
│       │       └── MultimodalInput — 输入框
│       │
│       └── 右侧主体 (flex-1)
│           ├── ArtifactHeader
│           │   ├── ArtifactTitle
│           │   ├── 最后更新时间 (formatDistance)
│           │   └── ArtifactActions — 操作按钮
│           │
│           ├── artifactDefinition.content — 具体编辑器
│           │
│           └── VersionFooter — 版本导航（查看旧版本时显示）
│
└── Toolbar — 右下角浮动快捷操作
```

### 7.3 面板打开动画

面板使用 `framer-motion` 的 `AnimatePresence` 实现从消息卡片位置"展开"到全屏的动画：

1. 点击 `DocumentPreview` 或 `DocumentToolResult` 时，记录按钮的 `boundingBox`（屏幕坐标和尺寸）
2. `setArtifact({ isVisible: true, boundingBox })` 触发动画
3. 面板从 `boundingBox` 位置/大小过渡到全屏面板位置/大小
4. 关闭时反向动画（缩回到 `boundingBox`）

### 7.4 关闭行为

- **流式生成中** (`status === "streaming"`)：面板保留但 `isVisible` 变为 `false`，不能真正关闭（防止打断生成）
- **空闲状态** (`status === "idle"`)：面板正常关闭，回到纯聊天视图
- 关闭后一段时间（`ARTIFACT_CLOSE_ANIMATION_DURATION`），状态重置为 `initialArtifactData`

---

## 8. API 接口

### 8.1 `POST /api/chat` — 聊天接口（注册 AI Tools）

```typescript
// app/(chat)/api/chat/route.ts (行 ~450-452)
const tools = {
  createDocument: createDocument({ session, dataStream }),
  updateDocument: updateDocument({ session, dataStream }),
  requestSuggestions: requestSuggestions({ session, dataStream }),
  // ... 其他 tools
};
```

### 8.2 `GET /api/document?id=xxx` — 获取文档所有版本

```typescript
// app/(chat)/api/document/route.ts
// 返回: Document[] (按 createdAt ASC 排序)
// 错误: 401 (未登录), 403 (非所有者), 404 (不存在)
```

### 8.3 `POST /api/document?id=xxx` — 保存文档新版本

```typescript
// Body: { content: string, title: string, kind: ArtifactKind }
// 注意: 即使 id 对应的文档不存在（create 时 AI tool 先返回 id 但可能还未写入 DB），也允许创建
// 权限: 如果文档已存在，仅所有者可更新
// 返回: 新创建的 Document 行
```

### 8.4 `DELETE /api/document?id=xxx&timestamp=xxx` — 删除指定时间点之后的版本

```typescript
// 删除 document.createdAt > timestamp 的所有 document 行
// 同时删除关联的 suggestion 行
// 权限: 仅所有者可删除
```

---

## 9. 状态管理

### 9.1 全局状态：SWR

使用 SWR 管理 artifact 的全局状态，key 为 `"artifact"`。

```typescript
// hooks/use-artifact.ts

function useArtifact() {
  // 主状态
  const { data: localArtifact, mutate: setLocalArtifact } = useSWR<UIArtifact>(
    "artifact", null, { fallbackData: initialArtifactData }
  );

  // per-document metadata（如 code 的 console outputs、text 的 suggestions）
  const { data: localArtifactMetadata, mutate: setLocalArtifactMetadata } = useSWR<any>(
    () => artifact.documentId ? `artifact-metadata-${artifact.documentId}` : null,
    null, { fallbackData: null }
  );

  return { artifact, setArtifact, metadata, setMetadata };
}

// 选择器模式（只订阅部分状态避免不必要的重渲染）
function useArtifactSelector<Selected>(selector: (state: UIArtifact) => Selected): Selected
```

**初始状态**：

```typescript
const initialArtifactData: UIArtifact = {
  documentId: "init", content: "", kind: "text", title: "",
  status: "idle", isVisible: false,
  boundingBox: { top: 0, left: 0, width: 0, height: 0 },
};
```

### 9.2 SWR 全局 key 的限制

`key = "artifact"` 是全局唯一的，这意味着同一时间只支持**一个活跃 artifact**。如需同时展示多个 artifact，需要重构为按 documentId 分 key 的状态管理。

---

## 10. AI 行为约束

System prompt 中通过 `<artifacts>` 标签注入以下规则（`lib/ai/prompts/sections/artifacts.ts`）：

### 何时使用 `createDocument`

- 内容超过 10 行
- 用户可能保存/复用的内容（邮件、代码、论文等）
- 用户明确要求创建文档
- 内容包含代码片段（**默认语言：Python**，不支持其他语言）

### 何时不使用

- 纯信息性/解释性内容
- 对话式回复
- 用户要求保留在聊天中

### updateDocument 规则

- 主要修改用全文档重写
- 仅在特定、隔离的修改时使用目标性更新
- **禁止**在创建后立即更新（等用户反馈）

### requestSuggestions 规则

- **仅**当用户明确要求改进现有文档时使用
- 需要已创建文档的有效 document ID
- 不用于一般问题或信息请求

---

## 11. 扩展指南

### 11.1 添加新的 Artifact 类型

假设要添加 `diagram` 类型：

**第 1 步：创建服务端 handler**

```typescript
// artifacts/diagram/server.ts
import { streamObject } from "ai";
import { z } from "zod";
import { createDocumentHandler } from "@/lib/artifacts/server";
import { getArtifactModel } from "@/lib/ai/providers";

export const diagramDocumentHandler = createDocumentHandler<"diagram">({
  kind: "diagram",
  onCreateDocument: async ({ title, dataStream, session }) => {
    let draftContent = "";
    const { fullStream } = streamObject({
      model: await getArtifactModel(session.user?.id),
      system: "Generate a Mermaid.js diagram based on the description.",
      prompt: title,
      schema: z.object({ mermaid: z.string() }),
    });
    for await (const delta of fullStream) {
      if (delta.type === "object" && delta.object?.mermaid) {
        dataStream.write({ type: "data-diagramDelta", data: delta.object.mermaid, transient: true });
        draftContent = delta.object.mermaid;
      }
    }
    return draftContent;
  },
  onUpdateDocument: async ({ document, description, dataStream, session }) => {
    // ... 类似实现
  },
});
```

**第 2 步：注册 handler**

```typescript
// lib/artifacts/server.ts
import { diagramDocumentHandler } from "@/artifacts/diagram/server";

export const documentHandlersByArtifactKind: DocumentHandler[] = [
  textDocumentHandler,
  codeDocumentHandler,
  sheetDocumentHandler,
  diagramDocumentHandler,  // 新增
];

export const artifactKinds = ["text", "code", "sheet", "diagram"] as const;
```

**第 3 步：创建客户端 class**

```typescript
// artifacts/diagram/client.tsx
export const diagramArtifact = new Artifact<"diagram">({
  kind: "diagram",
  description: "Useful for diagrams and flowcharts",
  onStreamPart: ({ streamPart, setArtifact }) => {
    if (streamPart.type === "data-diagramDelta") {
      setArtifact((draft) => ({ ...draft, content: streamPart.data, status: "streaming", isVisible: true }));
    }
  },
  content: ({ content }) => <MermaidRenderer code={content} />,
  actions: [/* ... */],
  toolbar: [/* ... */],
});
```

**第 4 步：注册客户端 class**

```typescript
// components/artifact.tsx
import { diagramArtifact } from "@/artifacts/diagram/client";

export const artifactDefinitions = [
  textArtifact, codeArtifact, imageArtifact, sheetArtifact,
  diagramArtifact,  // 新增
];
```

**第 5 步：更新数据库 schema**

```typescript
// lib/db/schema.ts
kind: varchar("text", { enum: ["text", "code", "image", "sheet", "diagram"] })
```

然后运行 `pnpm db:generate && pnpm db:migrate`。

**第 6 步（可选）：更新 AI prompt**

在 `lib/ai/prompts/sections/artifacts.ts` 中添加新类型的描述，帮助 AI 理解何时使用。

### 11.2 支持代码多语言

当前 code artifact 硬编码为 Python（Pyodide + system prompt 中的限制）。要支持多语言：

1. 在 `createDocument` 的 inputSchema 中增加 `language` 参数
2. 修改 `codePrompt` 指定语言
3. CodeEditor 根据语言切换语法高亮
4. 仅 Python 启用 Pyodide 执行（其他语言仅编辑）

### 11.3 注意事项

- 添加新类型必须在 `documentHandlersByArtifactKind`（服务端）和 `artifactDefinitions`（客户端）**同时注册**
- `artifactKinds` 常量决定 AI tool `createDocument` 的 Zod enum，遗漏将导致 AI 无法创建该类型
- 数据库 `kind` CHECK 约束也需同步更新
- stream part type（如 `data-diagramDelta`）在前端 `DataStreamHandler` 中需要对应处理
