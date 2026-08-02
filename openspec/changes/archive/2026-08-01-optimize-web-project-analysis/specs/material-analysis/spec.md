# Material Analysis Delta

## MODIFIED Requirements

### Requirement: 按需项目分析

系统 SHALL 根据模型通路选择项目分析策略：API 模型通过原生工具调用按需取证；DeepSeek 网页分析 GitHub 仓库时，系统 SHALL 从完整安全索引中构建预算化源码上下文包，并通过一次网页请求直接生成最终回答。系统 SHALL 展示最终回答或原始可操作错误。

#### Scenario: API 工具调用

- **WHEN** API 模型请求合法项目工具
- **THEN** 系统在当前工作区执行并把受限结果返回给同一 Agent 会话

#### Scenario: GitHub 网页直接分析

- **WHEN** 用户使用 DeepSeek 网页分析已索引 GitHub 仓库
- **THEN** 系统在本地生成仓库地图和相关源码上下文
- **AND** 只发送一次网页分析请求
- **AND** DeepSeek 直接返回最终 Markdown，不进行 JSON 工具循环

#### Scenario: 上下文超过预算

- **WHEN** 已索引源码超过模型上下文预算
- **THEN** 系统保留完整仓库地图
- **AND** 根据项目结构或用户问题选择相关源码与片段
- **AND** 明确告知模型本次未包含的文件不能据此判定为不存在

#### Scenario: 本地写回

- **WHEN** DeepSeek 网页处理本地可写工作区
- **THEN** 系统继续通过受控工具生成候选 patch
- **AND** 用户确认前不得写入文件

#### Scenario: 网页持续生成

- **WHEN** DeepSeek 持续产生新内容但总生成时间超过三分钟
- **THEN** 系统继续接收输出，直到生成完成或达到硬上限

#### Scenario: 网页传输失败

- **WHEN** DeepSeek 网页桥接失败
- **THEN** 侧栏展示原始可操作错误
