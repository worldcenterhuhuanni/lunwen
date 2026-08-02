# 材料解读助手

基于 WXT + React 的 Chrome 扩展，提供三种分析模式：

- 论文：PDF、网页正文与粘贴文字的专业解读
- GitHub 项目：索引公开仓库默认分支的合规文本源码，按模型通路检索并分析
- 本地工作区：读取用户授权目录，并在 diff 确认后写回现有文本文件

模型通路支持 DeepSeek 网页桥接和 OpenAI-compatible API。API 项目分析由 Pi Agent Core 通过原生工具调用取证；GitHub 网页模式在本地生成预算化源码上下文包，一次请求直接回答，避免高频 JSON 网页往返。本地写回仍使用受约束工具和 diff 确认流程。

## 开发

```bash
pnpm install
pnpm dev
pnpm test
pnpm compile
pnpm build
```

生产扩展输出到 `output/chrome-mv3`。

## 安全边界

- GitHub 首版只读公开仓库
- 默认排除 `.git`、依赖目录、构建产物、二进制和疑似密钥
- 项目达到文件数或文本量硬上限时停止，不静默截断
- 本地目录必须由用户主动授权
- Agent 只能生成候选 patch；重新校验文件版本并取得用户确认后才写入
