# Design: DeepSeek Web Bridge

## 数据流

```
侧栏 streamChat(cfg, messages)
  → provider === deepseek-web
  → ensureTab(chat.deepseek.com)
  → tabs.connect → content script
  → DOM: 填输入框 → Enter → 轮询助手气泡
  → port 推送 delta / done / error
  → 侧栏流式渲染
```

## 关键决策

1. **DOM 桥接，不用 Cookie API**：合规与可维护性更好；代价是 UI 改版会坏。
2. **首轮 `newChat=true`，追问只发最后一条 user**：网页会话自带上下文，避免重复塞整篇论文。
3. **多选择器兜底 + 稳定轮询**：输入框 / 新对话 / 助手消息用候选选择器；文本连续稳定视为完成。
4. **设置页**：选网页模式时隐藏 baseURL/apiKey/model，展示使用说明。
