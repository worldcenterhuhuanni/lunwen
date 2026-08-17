# prompt-template Specification

## Purpose
定义提示词模板的管理与解析规则：内置模板与用户模板的组织、按材料类型的默认选择，以及模板在一次解读过程中的锁定行为。
## Requirements
### Requirement: 本地模板库

系统 SHALL 在浏览器本地保存用户模板，并提供创建、复制、编辑、删除和预览能力。

#### Scenario: 升级旧配置
- WHEN 用户从不含模板字段的版本升级
- THEN 系统 SHALL 保留原模型配置并使用专业内置默认模板

#### Scenario: 编辑内置模板
- WHEN 用户希望修改内置模板
- THEN 系统 SHALL 创建可编辑副本且不修改随代码发布的原模板

### Requirement: 按材料选择模板

系统 SHALL 支持 PDF/HTML 独立默认模板，并允许侧栏对本次解读临时覆盖。

#### Scenario: 自动选择
- WHEN 侧栏模板选择为自动
- THEN 系统 SHALL 按提取结果的 `kind` 使用对应默认模板

#### Scenario: 临时覆盖
- WHEN 用户在侧栏指定兼容模板
- THEN 本次解读及其单轮追问 SHALL 使用该模板，但不修改全局默认值

### Requirement: 安全变量渲染

系统 SHALL 仅替换受支持变量，并在保存或执行前拒绝未知变量与无材料入口的模板。

#### Scenario: PDF 附件
- WHEN DeepSeek 网页模式上传 PDF
- THEN `{{material}}` SHALL 描述已上传附件，且完整 system/user 指令 SHALL 被发送

### Requirement: AI 生成草稿

系统 SHALL 允许用户描述用途并由当前模型生成结构化模板草稿。

#### Scenario: 生成成功
- WHEN 模型返回可解析且有效的模板
- THEN 系统 SHALL 将其放入编辑器但不得自动保存

#### Scenario: 生成失败
- WHEN 返回结果不可解析或变量非法
- THEN 系统 SHALL 保留用户输入并显示可操作错误

