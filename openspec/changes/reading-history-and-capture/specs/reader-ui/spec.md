# Reader UI Spec

## ADDED Requirements

### Requirement: 多行追问输入

系统 SHALL 允许在追问输入中换行，并保持回车发送的习惯。

#### Scenario: 换行与发送
- WHEN 用户在追问输入中按 Shift+Enter
- THEN 系统 SHALL 插入换行且不发送
- AND 单独按 Enter 时 SHALL 发送当前内容

#### Scenario: 高度自适应
- WHEN 追问内容超过一行
- THEN 输入框 SHALL 随内容增高至上限后内部滚动，不遮挡对话区

### Requirement: 工具轨迹可展开

系统 SHALL 允许查看项目分析中每一次工具调用的参数与结果摘要。

#### Scenario: 展开单条轨迹
- WHEN 用户展开一条工具轨迹
- THEN 系统 SHALL 显示该次调用的参数与结果摘要

#### Scenario: 键盘可达
- WHEN 用户使用键盘聚焦到轨迹条目
- THEN 该条目 SHALL 可通过键盘展开与收起
