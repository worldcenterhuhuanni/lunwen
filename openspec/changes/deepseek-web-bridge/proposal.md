# DeepSeek 网页登录桥接

## Why

用户已登录 chat.deepseek.com，希望不填 API Key，直接用网页额度解读论文。

## What

- 新增模型服务：`DeepSeek 网页（已登录）`
- 通过 content script 向已打开的 DeepSeek 聊天页注入提示词、发送、回收回复
- 首轮解读开新对话；追问沿用同一网页会话
- 未打开/未登录时给出明确指引

## Not

- 不逆向 Cookie / 内部 API
- 不接入元宝或其他网页产品
- 不替代现有 API Key 通路

## 验收

1. 设置选「DeepSeek 网页」后无需 API Key 即可解读
2. 已登录的 DeepSeek 标签页存在时可完成首轮解读与追问
3. 无标签页或未登录时错误信息可操作（提示打开并登录）
