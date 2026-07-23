# Artifacts 架构

> **状态**：Active
>
> **范围**：Artifact 生成、流式状态、预览、编辑、版本与保存链路
>
> **最后核验**：2026-07-22

Artifacts 将长文档、代码、表格和图片从线性聊天中分离到独立工作区。生成期间优先保证内容可见和交互响应；生成完成后才加载对应编辑器。服务端协议与文档 API 保持快照语义，客户端负责把高频事件合并成稳定状态。

## 架构边界

```text
AI tool
  → DocumentHandler 生成并保存最终快照
  → UI Message Stream 的 data-* 事件
  → DataStreamProvider 帧队列
  → reduceArtifactStreamBatch 纯 reducer
  → useArtifact / metadata
  → 轻量预览（streaming/error）或延迟编辑器（idle）
```

- `createDocument`、`updateDocument` 和 `requestSuggestions` 是模型侧入口。
- `createDocumentHandler` 封装 text、code、sheet 的生成与最终持久化；图片仍有客户端 Artifact 定义和流式快照分支。
- `DataStreamProvider` 是浏览器流事件的唯一调度边界。
- `reduceArtifactStreamBatch` 统一解释跨类型事件；类型定义只负责渲染、工具栏和类型专属操作。
- `Artifact` 是双栏/全屏工作区，`DocumentPreview` 是聊天消息内的轻量入口。

数据库 schema、`/api/document` 的请求/响应形状以及服务端 Artifact 类型协议不由本层重新定义。数据库与服务端生成行为以 `lib/db/schema.ts`、`lib/artifacts/server.ts` 和 `lib/ai/tools/artifacts/` 为准。

## 同步 Markdown 解析

文本编辑器和版本 Diff 共用 `parseMarkdownToDocument`。它通过 `prosemirror-markdown` 的同步 parser 直接生成 ProseMirror document，并复用 `documentSchema`；不再把 Streamdown 的 React 输出同步 SSR 成 HTML。

这条边界很重要：Streamdown 的 streaming 模式会在 effect 中建立 block，同步 `renderToString` 只能得到空容器。把该空 HTML 交给 ProseMirror 会让已持久化文本和 Diff 看起来都是空白。

同步 parser 当前覆盖：

- 标题、段落、强调、链接和有序/无序列表；
- fenced code block；
- 中文、英文和混合 Markdown；
- 空字符串，结果是合法的空 ProseMirror 文档。

Streamdown 只用于轻量只读预览，不参与编辑器 document 或 Diff 的构造。

## 流事件批处理

### 稳定接口

`useDataStream()` 暴露四个稳定回调：

- `appendDataPart(part)`：将事件加入 ref 队列；
- `flushDataParts()`：立即按顺序提交当前队列；
- `failDataStream(message)`：先提交部分内容，再进入错误态；
- `subscribeDataParts(listener)`：订阅批次，不公开可变数组。

正常流每个 animation frame 最多提交一次。收到 finish、chat finish、停止或错误时会主动 flush，防止尾部事件遗失。

### 压缩与 reducer

`compactArtifactStreamParts` 在单批次内执行两种安全压缩：

- 相邻 `data-textDelta` 合并后追加；
- `data-codeDelta`、`data-sheetDelta`、`data-imageDelta` 只保留各自最新快照。

`reduceArtifactStreamBatch` 是纯函数，一批事件只产生一次 Artifact 状态和一次 suggestions metadata 更新。事件仍按协议顺序解释：

| 事件 | 状态变化 |
| --- | --- |
| `data-id` | 切到新文档，清空旧正文、建议、错误和自动打开标记 |
| `data-title` / `data-kind` | 更新标题或类型并进入 `streaming` |
| `data-clear` | 清空正文但保留当前文档身份 |
| `data-textDelta` | 追加文本；首次跨过 400 字时自动打开一次 |
| code/sheet/image delta | 用最新快照覆盖正文并首次自动打开 |
| `data-suggestion` | 追加建议到当前文档 metadata |
| `data-finish` | 强制清空队列后进入 `idle` |
| stream failure/stop | 保留部分正文并进入 `error` |

用户在生成中主动关闭后会设置 `wasDismissed`。同一文档的后续 delta 不会再次弹出工作区；新 `data-id` 才重置该意图。

## UI 状态机

`UIArtifact.status` 有三个值：

- `streaming`：显示只读实时预览和 Generating 状态；
- `idle`：生成或读取完成，可以加载编辑器、版本和操作；
- `error`：保留已到达的正文，显示失败原因以及关闭/重试入口。

错误与停止不会把工作区永久留在 loading。Retry 使用当前聊天的 regenerate 路径重新发起生成；Close 会 flush 尚未提交的保存并尊重用户关闭意图。

## 渲染与加载策略

### 聊天内预览

`DocumentPreview` 不挂载 ProseMirror、CodeMirror 或 DataGrid：

- text 使用 Streamdown 的 static 只读渲染；
- code 和 sheet 使用轻量 `pre`；
- image 使用 Next Image；
- 当前流式内容优先于仍在返回中的持久化 GET。

历史消息因此不会按消息数创建编辑器实例。

### Artifact 工作区

生成期间同样只显示轻量预览。进入 `idle` 后按类型动态导入重组件：

- text：ProseMirror Editor；只有 Diff 模式才加载 DiffView；
- code：CodeMirror 编辑器；
- sheet：DataGrid 编辑器；
- image：ImageEditor。

Artifact 工作区本身也只在可见时由聊天页动态加载。消息正文和 reasoning renderer 采用动态边界，使空聊天页初始入口不携带 Streamdown/Shiki 和编辑器依赖。加载期间保留现有 skeleton、键盘和响应式工作区结构。

## 持久化、版本与并发

### 读取和切换

- 只有 `idle` 的已知 documentId 才读取版本；生成中和错误态不会由 SWR 重新校准。
- 持久化响应只有在 documentId 与当前工作区一致时才能应用。
- 切换文档会重置当前版本、模式、metadata 和保存状态，并取消旧 debounce。
- 异步 initialize、GET 和保存响应都校验当前 documentId；迟到响应不能覆盖新文档或新流。
- finish 后只接受同一 documentId 的持久化快照作为最终校准。

### 保存

编辑器变化进入 2 秒 debounce，切换版本等显式操作可立即保存，关闭时 flush。保存链路：

1. 允许 `content: ""`，空文档是合法状态；
2. POST `/api/document` 并校验非 2xx；
3. 成功后用返回快照更新最新版本基线和 SWR cache，不触发无条件 revalidate；
4. 用请求序号和 documentId 忽略旧响应；
5. UI 显示 `Saving…`、`Saved` 或 `Save failed`。

保存失败不会伪造成功基线，用户的本地编辑内容仍留在编辑器中。

## 渲染隔离

- Data stream Context 的值与回调保持稳定；队列变化不触发 provider 子树重渲染。
- Artifact reducer 每批只提交一次状态，不让每个 token 直接推动多层 React state。
- `Artifact` memo 比较消息、votes、附件和模型引用；`ArtifactMessages` 只关心实际影响它的消息尾部与状态。
- 文档读取不再每次 render 无条件 revalidate。
- 聊天输入、消息正文、Artifact shell 和类型正文通过动态边界与 memo 分离。

## 扩展 Artifact 类型

新增类型时按以下顺序工作：

1. 若需要模型生成和版本持久化，在 `artifacts/<kind>/server.ts` 定义 `DocumentHandler`，并注册到 `lib/artifacts/server.ts`。
2. 在 `lib/types.ts` 声明对应 `data-*` part 和内容类型。
3. 在 `lib/artifacts/stream-reducer.ts` 定义它是追加 delta 还是完整快照；不要在客户端类型定义中重新实现事件分发。
4. 在 `artifacts/<kind>/client.tsx` 定义完成态 content、actions 和 toolbar。
5. 为 streaming/error 提供无需重编辑器的只读表示，并在 `DocumentPreview` 增加轻量 inline 表示。
6. 为 reducer 顺序、失败收口、持久化重开、完成态编辑器和移动端关闭补测试。

不要重新引入公开可变 stream 数组、per-kind `onStreamPart`，也不要用异步 React renderer 的同步 SSR 输出构建编辑器 document。

## 测试与性能

```bash
pnpm test:artifacts
pnpm exec playwright test tests/e2e/artifacts.test.ts --project=e2e
pnpm perf:artifacts
```

`test:artifacts` 覆盖 Markdown 可见性/往返和 reducer 事件语义。Playwright 使用浏览器内 timed `ReadableStream` 重放 text delta，覆盖生成中预览、完成态编辑、关闭后不重开、空文档保存失败、流错误和移动端交互。

`perf:artifacts` 固定运行 5 次本地合成 CPU 压力场景：800 个文本 delta、每批 16 个；同时读取最新生产构建 manifest。2026-07-22 同机结果：

| 指标 | 逐 delta 基线 | 批处理实现 | 变化 |
| --- | ---: | ---: | ---: |
| 每轮正文提交 | 800 | 50 | -93.8% |
| 总处理 P50 | 130.701 ms | 7.950 ms | -93.9% |
| 总处理 P95 | 158.454 ms | 8.578 ms | -94.6% |
| 单批任务 P95 | 0.349 ms | 0.304 ms | -12.9% |
| ≥200 ms 长任务 | 0 | 0 | 持平 |
| 空聊天入口 JS | 3,923,308 B | 994,239 B | -74.7% |

批处理侧没有 ≥50 ms 或 ≥200 ms 的单批任务，编辑器依赖未出现在空聊天入口 chunk 中。浏览器回归还要求生成中关闭可见响应低于 200 ms。

这些数字来自固定的本地合成压力场景和 production manifest，不是线上 INP、Core Web Vitals、DAU 或 QPS。换硬件、Node 版本、依赖或构建配置后必须重跑，不能沿用表内数字。

## 排障

- **文本或 Diff 空白**：先运行 Markdown 单测，确认没有重新使用 Streamdown SSR；再检查存储 content 是否为空。
- **生成结束仍 loading**：确认 chat `onFinish`、stop 和 error 分支调用 flush/fail，且 `data-finish` 到达 reducer。
- **关闭后重新弹出**：检查同一 documentId 是否保留 `wasDismissed`，以及是否意外把后续 delta 当成新文档。
- **旧内容覆盖新流**：检查 GET/POST/initialize 应用结果前的 documentId 与请求序号守卫。
- **显示 Saved 但请求失败**：确认保存逻辑检查 `response.ok`，且没有在 catch 前更新版本基线。
- **首包重新变大**：生产构建后运行 `pnpm perf:artifacts`，检查 `editorDependenciesInEntry` 和入口字节数。
- **性能数据不可比较**：保留相同 Node、production build、deltaCount、batchSize 和运行次数，并区分合成 CPU 指标与浏览器交互指标。
