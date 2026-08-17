# 设计：dsh 网页桥适配器

## 一、已验证（读 dsh 源码得出，无需实测）

| # | 结论 | 证据 |
|---|------|------|
| A1 | `StreamChunk` 由适配器**自己构造**，dsh 不校验来源 | `packages/llm/llm/src/types.ts:291` |
| A2 | `invariant.ts` 只校验语法：block 配对、index 非负、finish 唯一、usage 至多一次 | `packages/llm/llm/src/invariant.ts:36-80` |
| A3 | 文本解析出的 tool-call 与原生 tool call 在 dsh 眼里**不可区分** | A1 + A2 推论 |
| A4 | `reasoning` 是一等 block 类型，网页思考内容可直接映射 | `types.ts:60` |
| A5 | `FinishReason` 五种（stop / tool-calls / max-tokens / aborted / error）均可构造 | `types.ts:116-122` |
| A6 | 适配器注册方式：`export const name` + `inject = ['llm']` + 注册 provider route | `packages/llm/llm-deepseek/src/index.ts:42-47` |
| A7 | 无状态化可行：每轮 `newChat` 重发全量 messages，dsh 保持上下文所有权，compaction 照常生效 | `GenerateOptions.messages` 语义，`types.ts:326-331` |

**A3 是关键**：它推翻了"网页无原生 tool-call 所以接不了 agent loop"的判断。OpenAI 适配器也不过是把 SSE 解析成这些 chunk；我们只是把"解析 SSE"换成"解析网页文本"。

## 二、降级项（不破契约，但有代价）

| 字段 | 处理 | 代价 |
|------|------|------|
| `temperature` / `maxTokens` / `stop` | 忽略 | 调用方若依赖 `stop` 截断会拿到完整输出；agent loop 不依赖 |
| `usage` | 不发，或按 `字符数/4` 估算 | **dsh 的 compaction 触发依赖 token 计数** —— 不发则永不触发，估算则可能早触发或晚触发。阶段 2 需专门决策 |
| `replayState` | 不提供 | dsh 的 replay 能力对本路由失效 |

## 三、架构

```
dsh 进程 (Node)                          你的 Chrome
┌──────────────────┐                    ┌──────────────────┐
│ DsWebAdapter     │   CDP over ws      │ chat.deepseek.com│
│  .stream()       │  127.0.0.1:9222    │  ├ 注入 page-agent│
│   ├ 渲染 prompt  ├───────────────────►│  ├ 填写 / 发送    │
│   ├ 轮询快照     │                    │  └ 轮询回复       │
│   └ 解析 → chunk │  DOM.setFileInput  │                  │
└──────────────────┘                    └──────────────────┘
```

**不依赖任何浏览器扩展。** 插件通过 Chrome DevTools Protocol 直接驱动用户已在运行的 Chrome。

### 为什么是 CDP，不是扩展、也不是 Playwright

原方案要配套一个浏览器扩展（扩展不能监听端口，所以 dsh 侧起 WS server 等它连入）。问题是这让插件变成某个扩展的附属品，装不上扩展就用不了。

三条独立化路径的取舍：

| 方案 | 新依赖 | 登录 | 风控 |
|------|--------|------|------|
| 配套扩展 | 无 | 复用 | 低 | 
| **CDP 连现有 Chrome** | **无（复用已有 `ws`）** | **复用** | **最低（真实指纹）** |
| Playwright 自带浏览器 | playwright + Chromium ~150MB | 需单独登录 | 较高（`navigator.webdriver` 等自动化特征） |

选 CDP：零新增依赖、复用现有登录态、浏览器指纹就是用户真实的那个。代价是 Chrome 必须带 `--remote-debugging-port=9222` 启动，且启动前要完全退出已有实例。

**页面选择器不是新写的**，直接沿用 lunwen-reader content script 里已在生产环境跑通的那套（含多级 fallback），见 `page-agent.ts`。

### 单轮流程

1. dsh 调 `stream(options)`
2. 适配器把 `system` + `messages` + `tools` 渲染成一份 Markdown
3. 短上下文进输入框；长上下文写成 `.md` 走附件（见 V1）
4. 经 WS → offscreen → content script → `newChat` 提交
5. 网页流式吐字回传，适配器边解析边发 chunk：
   - 思考内容 → `reasoning-delta`
   - 正文 → `text-delta`
   - 匹配到工具标记 → `block-start(tool-call)` + `tool-call-delta` + `block-end`
6. 结束 → `finish`（有工具调用则 `tool-calls`，否则 `stop`）

### 工具调用的文本协议

prompt 中注入工具 JSON Schema，约定输出标记。解析失败时重试当轮（不计入 dsh 的轮次）。**没有 schema 层面的保证，只有重试兜底** —— 这是与原生 tool call 的真实差距，但不破 dsh 契约。

## 四、待验证（阶段 0 的全部内容）

### V1 · 附件类型
网页收不收 `.md` / `.txt`。当前扩展写死 PDF，三处需放宽：

- `entrypoints/deepseek.content.ts:339` — `%PDF-` 魔数校验
- `entrypoints/deepseek.content.ts:265` — `findFileInput()` 的 `accept` 过滤
- `entrypoints/deepseek.content.ts:291` — `waitFileParsed()` 的 `.pdf` 文件名匹配

改动量小，但**先手动在网页验证，再改代码**。

### V2 · 限流阈值 ← 致命假设
一个 dsh agent 任务动辄几十轮，每轮全量重发。网页版是给人交互用的。

**测法**：连续提交 15–20 次大附件，记录第几次开始出现限流 / 验证码 / 排队。

**判定**：
- N ≥ 30 → 方案成立，进阶段 1
- 20 ≤ N < 30 → 仅适合短任务，需在适配器里做轮次预算告警
- N < 20 → **终止**，归档为「已评估·不实施」

**这项必须用真实账号跑，且会消耗配额、可能触发风控 —— 由使用者本人执行或明确授权后执行。**

### V3 · 输入框长度上限
V1 不通时的退路。测输入框能接受的最大字符数。

## 五、未决

- `usage` 估算策略（阶段 2 决策，影响 compaction）
- 标签池并发上限（受 V2 结论约束）
- dsh 侧 WS server 用现成 seam 还是直接起 `ws` —— 阶段 1 再定，非致命
