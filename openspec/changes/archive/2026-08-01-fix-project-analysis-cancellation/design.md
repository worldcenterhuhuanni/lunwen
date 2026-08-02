# Design

## 最终回答收集

`text_delta` 继续用于实时渲染；`message_end` 作为权威兜底，从最终 assistant message 提取完整文本。若最终消息的 `stopReason` 为 `error`，直接抛出其 `errorMessage`，避免被空回答检查覆盖。

## 统一取消

一次项目任务只创建一个 `AbortController`，依次传入：

1. GitHub API、归档及 raw 文件请求；
2. 归档 Worker（取消时 terminate）；
3. 工作区构建与 IndexedDB 保存；
4. Agent 和工作区搜索工具。

每个阶段在进入下一阶段前检查 signal。扫描和搜索按批次让出事件循环，使停止点击能够被浏览器处理。

## UI 状态

`extracting` 与 `streaming` 都属于可取消 busy 状态。停止按钮在两者中持续可见；点击后立即显示“正在停止…”，最终由任务 `finally` 恢复空闲状态。
