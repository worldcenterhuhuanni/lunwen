# llm-provider Specification

## Purpose
定义模型通路的选择与行为边界：OpenAI-compatible API 与已登录 DeepSeek 网页桥接两条通路，包括会话策略、附件上传和失败时的可操作反馈。
## Requirements
### Requirement: DeepSeek 网页桥接

系统 SHALL 支持在用户已登录 `chat.deepseek.com` 的前提下，通过页面 DOM 桥接完成论文解读，无需 API Key。

#### Scenario: 网页模式无需 Key

- WHEN 用户在设置中选择「DeepSeek 网页（已登录）」
- THEN 侧栏 SHALL 视为已配置，允许发起解读

#### Scenario: 缺少登录页

- WHEN 发起解读且不存在可用的 DeepSeek 聊天标签页或页面未登录
- THEN 系统 SHALL 返回可操作的错误提示（打开并登录 chat.deepseek.com）

#### Scenario: 首轮与追问

- WHEN 用户首次解读一篇论文
- THEN 系统 SHALL 尽量在新对话中发送合并后的系统提示与论文正文
- WHEN 用户就同一篇论文追问
- THEN 系统 SHALL 仅向当前网页会话发送追问内容

