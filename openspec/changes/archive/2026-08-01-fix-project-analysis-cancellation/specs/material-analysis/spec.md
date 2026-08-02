# Material Analysis Delta

## MODIFIED Requirements

### Requirement: 按需项目分析

系统 SHALL 允许模型通过文件列表、文本搜索和按需读文件工具分析项目，而不是把全部源码放入单个提示词。系统 SHALL 在模型返回最终回答时展示该回答；若网页桥接或 Agent 失败，系统 SHALL 展示原始可操作错误，不得以空回答错误覆盖真实原因。

#### Scenario: API 工具调用

- **WHEN** API 模型请求合法项目工具
- **THEN** 系统在当前工作区执行并把受限结果返回给同一 Agent 会话

#### Scenario: DeepSeek 网页工具协议

- **WHEN** DeepSeek 网页返回合法 JSON action
- **THEN** 系统执行动作并在同一网页会话继续，直到最终回答或达到步数上限

#### Scenario: 非法动作

- **WHEN** 模型动作无法解析、参数越界或访问其他工作区
- **THEN** 系统拒绝执行并提供可诊断错误

#### Scenario: DeepSeek 返回 final action

- **WHEN** DeepSeek 网页返回包含 Markdown 的合法 `final` JSON action
- **THEN** 侧栏展示该 Markdown 回答

#### Scenario: 网页传输失败

- **WHEN** DeepSeek 网页桥接产生带错误信息的最终 assistant message
- **THEN** 侧栏展示该错误信息

## ADDED Requirements

### Requirement: 项目任务必须可取消

系统 SHALL 允许用户在仓库下载、解压、索引、保存及 Agent 分析阶段停止当前任务，并在停止后禁止继续执行后续阶段。

#### Scenario: 用户停止项目任务

- **WHEN** 项目任务处于任一忙碌阶段且用户点击停止
- **THEN** 当前网络请求或 Worker 被取消
- **AND** 索引或分析不再继续
- **AND** 侧栏恢复可操作状态且不显示失败错误
