# Material Analysis Spec

## ADDED Requirements

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

系统 SHALL 允许模型通过文件列表、文本搜索和按需读文件工具分析项目，而不是把全部源码放入单个提示词。

#### Scenario: API 工具调用
- WHEN API 模型请求合法项目工具
- THEN 系统 SHALL 在当前工作区执行并把受限结果返回给同一 Agent 会话

#### Scenario: DeepSeek 网页工具协议
- WHEN DeepSeek 网页返回合法 JSON action
- THEN 系统 SHALL 执行动作并在同一网页会话继续，直到最终回答或达到步数上限

#### Scenario: 非法动作
- WHEN 模型动作无法解析、参数越界或访问其他工作区
- THEN 系统 SHALL 拒绝执行并提供可诊断错误

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
