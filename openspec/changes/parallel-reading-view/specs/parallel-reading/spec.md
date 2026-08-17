# Parallel Reading Spec

## ADDED Requirements

### Requirement: 原文与分析同屏对照

系统 SHALL 提供全宽的对照视图，在同一屏内左侧展示材料原文、右侧展示 AI 分析。

#### Scenario: 进入对照视图

- WHEN 用户对一条论文解读点击放大
- THEN 系统 SHALL 打开全宽对照视图
- AND 左侧 SHALL 展示该材料原文，右侧 SHALL 展示已有分析

#### Scenario: PDF 原样排版

- WHEN 材料是 PDF
- THEN 左侧 SHALL 按原文件排版渲染，保留图表、公式与分栏
- AND 正文文字 SHALL 可以选中

#### Scenario: 原文不可用

- WHEN 对照视图取不到该材料的原文数据
- THEN 系统 SHALL 展示可操作的提示，说明需要回侧栏重新打开
- AND 不得展示空白页面

### Requirement: 选中原文发起追问

系统 SHALL 允许用户选中一段原文并就该片段追问，且请求只携带该片段而非整篇材料。

#### Scenario: 就选中片段提问

- WHEN 用户选中一段原文并发起追问
- THEN 系统 SHALL 把该片段原文与问题一起发送
- AND 不得重新上传整篇 PDF

#### Scenario: 追问结果并入同一会话

- WHEN 对照视图中产生了新的问答
- THEN 该轮次 SHALL 写入与侧栏相同的会话记录
- AND 侧栏的历史列表 SHALL 能看到这些轮次

### Requirement: 分析与原文双向定位

系统 SHALL 记录每条分析所引用的原文片段，并支持在分析与原文之间双向定位。

#### Scenario: 从分析定位原文

- WHEN 用户点击一条引用了原文片段的分析
- THEN 左侧 SHALL 滚动到该片段所在位置并高亮它

#### Scenario: 从原文定位分析

- WHEN 用户点击原文中已被追问过的高亮片段
- THEN 右侧 SHALL 滚动到引用该片段的分析

#### Scenario: 关联不依赖模型输出

- WHEN 建立分析与原文的对应关系
- THEN 系统 SHALL 依据用户的选中动作建立关联
- AND 不得依赖模型在回答正文中输出引用标记

#### Scenario: 整篇分析

- WHEN 一条分析不是针对某个具体片段产生的
- THEN 系统 SHALL 将其标示为面向整篇材料，不指向任何高亮

#### Scenario: 重新打开后保持

- WHEN 用户关闭对照视图后再次打开同一材料
- THEN 已有问答与片段高亮 SHALL 保持可用
