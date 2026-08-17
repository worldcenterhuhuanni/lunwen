# Reader Windows Spec

## MODIFIED Requirements

### Requirement: 独立放大阅读窗口

系统 SHALL 在离开侧栏宽度的独立视图中展示被放大的内容：论文解读进入原文对照视图，候选修改仍进入 diff 审阅视图。

#### Scenario: 打开放大阅读
- WHEN 用户点击某条完整论文解读的放大按钮
- THEN 系统 SHALL 打开对照视图，展示该材料原文与已有分析

#### Scenario: 审阅候选修改
- WHEN 系统产生候选修改且用户开启了独立大窗口
- THEN 系统 SHALL 在独立窗口中展示该候选 diff 与确认操作

#### Scenario: 临时数据失效
- WHEN 阅读页无法读取对应会话内容
- THEN 系统 SHALL 展示可操作的失效提示，且不得依赖 URL 携带全文

### Requirement: 窗口与 DeepSeek 跳转可配置

系统 SHALL 提供独立大窗口与 DeepSeek 自动跳转两项配置，并采用安全默认值。

#### Scenario: 默认标签页
- WHEN `preferLargeWindows` 为 false（默认）
- THEN 对照视图 SHALL 在新标签页中以全宽展示，设置 SHALL 走系统 options 页

#### Scenario: 开启独立大窗口
- WHEN 用户开启 `preferLargeWindows` 并保存
- THEN 设置与对照视图 SHALL 打开居中独立扩展窗口

#### Scenario: 关闭 DeepSeek 跳转
- WHEN `autoFocusDeepSeek` 为 false 且使用网页模式解读
- THEN 系统 SHALL 继续桥接 DeepSeek，但不得强制把该标签页切到前台
