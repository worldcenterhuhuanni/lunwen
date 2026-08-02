# material-analysis Specification

## Purpose
TBD - created by archiving change multi-mode-analysis. Update Purpose after archive.
## Requirements
### Requirement: 三种分析模式

系统 SHALL 提供论文、GitHub 项目和本地工作区三种明确模式，并为每种模式保留独立的来源入口和默认模板。

#### Scenario: 切换模式
- WHEN 用户切换分析模式
- THEN 系统 SHALL 展示该模式的来源入口，且不得自动读取或发送另一模式的材料

#### Scenario: 论文回归
- WHEN 用户在论文模式读取 PDF、网页或粘贴正文
- THEN 系统 SHALL 继续使用现有 PDF/HTML 提取、附件和模板行为

### Requirement: GitHub 全仓源码索引

系统 SHALL 遍历公开 GitHub 仓库默认分支中符合安全规则和资源上限的全部文本源码，并以文件级结构建立本地索引。

#### Scenario: 索引公开仓库
- WHEN 用户提交有效的公开 GitHub 仓库 URL
- THEN 系统 SHALL 显示仓库、版本、已索引文件数、总文本量和排除统计

#### Scenario: 仓库超过上限
- WHEN 下载、文件数或文本量超过硬上限
- THEN 系统 SHALL 停止索引并说明具体上限，不得静默截断后宣称完整

#### Scenario: 敏感或二进制内容
- WHEN 文件命中敏感路径、二进制或默认忽略规则
- THEN 系统 SHALL 跳过内容并计入可见排除统计

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

### Requirement: 本地目录授权

系统 SHALL 只读取用户主动选择并授权的本地目录；平台不支持目录句柄时 SHALL 提供只读目录导入回退。

#### Scenario: 权限已撤销
- WHEN 持久目录句柄不再具有读取权限
- THEN 系统 SHALL 请求用户重新授权，不得绕过浏览器权限模型

#### Scenario: 只读回退
- WHEN 浏览器不支持 File System Access API
- THEN 系统 SHALL 允许一次性只读导入目录，并禁用直接写回

### Requirement: 确认后本地写回

系统 SHALL 在写入本地文件前展示 diff 并取得逐文件确认，同时校验路径和源文件版本。

#### Scenario: 接受修改
- WHEN 用户确认候选 diff 且源文件未变化
- THEN 系统 SHALL 仅写入已确认且位于授权目录内的文件

#### Scenario: 文件已变化
- WHEN 生成 diff 后源文件内容发生变化
- THEN 系统 SHALL 拒绝覆盖并要求重新生成修改

#### Scenario: 路径逃逸
- WHEN 候选修改包含绝对路径、父目录跳转、`.git` 或未授权文件
- THEN 系统 SHALL 拒绝该修改且不得产生磁盘写入

### Requirement: 项目任务必须可取消

系统 SHALL 允许用户在仓库下载、解压、索引、保存及 Agent 分析阶段停止当前任务，并在停止后禁止继续执行后续阶段。

#### Scenario: 用户停止项目任务

- **WHEN** 项目任务处于任一忙碌阶段且用户点击停止
- **THEN** 当前网络请求或 Worker 被取消
- **AND** 索引或分析不再继续
- **AND** 侧栏恢复可操作状态且不显示失败错误

