# Capture Entry Spec

## ADDED Requirements

### Requirement: 划词解读入口

系统 SHALL 在网页选中文字时提供右键解读入口，打开侧栏并按当前模板解读该段文字。

#### Scenario: 选中文字解读
- WHEN 用户在网页选中文字并使用右键解读菜单
- THEN 系统 SHALL 打开侧栏
- AND 以该段选中文字作为材料按当前默认模板发起解读

#### Scenario: 侧栏尚未打开
- WHEN 触发划词解读时侧栏尚未打开
- THEN 系统 SHALL 先打开侧栏，待其就绪后再消费该段待解读文字，不得丢失该次触发

#### Scenario: 待解读文字只消费一次
- WHEN 侧栏已消费一次待解读文字
- THEN 系统 SHALL 清除该待解读记录，后续打开侧栏不得重复解读

#### Scenario: 忙碌中触发
- WHEN 触发划词解读时侧栏正在执行其他分析任务
- THEN 系统 SHALL 提示当前任务未结束，不得中断进行中的分析
