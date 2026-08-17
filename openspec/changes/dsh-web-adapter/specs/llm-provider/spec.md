# llm-provider Spec

## ADDED Requirements

### Requirement: dsh 可经网页桥使用 DeepSeek 网页会话

系统 SHALL 让 DeepSeek Harness 把已登录的 chat.deepseek.com 网页会话当作一条模型通路使用，不需要 API Key，且该通路对 dsh 表现为与官方 API route 并列可选的普通 provider route。

#### Scenario: 无工具的单轮问答

- WHEN 使用者在 dsh 中选择网页通路并发出一次不含工具的提问
- THEN 系统 SHALL 向 dsh 输出流式文本增量，可观察行为与 API 通路一致
- AND dsh 的流协议校验 SHALL 全程不产生 failure

#### Scenario: 上下文所有权归 dsh

- WHEN dsh 发起任意一轮请求
- THEN 该轮携带的完整对话历史 SHALL 由 dsh 决定
- AND 网页侧 SHALL NOT 复用上一轮的会话历史
- AND dsh 的上下文压缩行为 SHALL NOT 因走网页通路而失效

#### Scenario: 模型请求工具调用

- WHEN 请求携带工具定义且模型决定调用某个工具
- THEN 系统 SHALL 向 dsh 输出与原生工具调用同构的工具调用块
- AND 本轮结束原因 SHALL 为「需要调用工具」

#### Scenario: 网页侧不可用

- WHEN 网页未登录、被限流，或桥接链路断开
- THEN 系统 SHALL 向 dsh 输出明确的失败结束原因，不得是空回复或静默挂起
- AND 失败信息 SHALL 指出属于登录、限流还是链路问题

#### Scenario: 扩展自用路径不受影响

- WHEN dsh 适配器未运行或未连接
- THEN 扩展侧栏自身的网页模式解读功能行为 SHALL 保持不变
