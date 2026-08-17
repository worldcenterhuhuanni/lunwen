# Reader Windows Spec

## ADDED Requirements

### Requirement: 居中扩展设置窗口

系统 SHALL 从侧栏以居中扩展窗口打开设置页，且窗口尺寸足以展示模板工作台。

#### Scenario: 打开设置
- WHEN 用户点击侧栏设置或模板管理
- THEN 系统 SHALL 打开独立扩展窗口展示设置内容，而不是困在侧栏宽度内

### Requirement: 独立放大阅读窗口

系统 SHALL 在独立扩展窗口中展示被放大的论文解读 Markdown。

#### Scenario: 打开放大阅读
- WHEN 用户点击某条完整解读的放大按钮
- THEN 系统 SHALL 在居中扩展窗口中展示该条标题、来源与 Markdown 内容

#### Scenario: 临时数据失效
- WHEN 阅读页无法读取对应会话内容
- THEN 系统 SHALL 展示可操作的失效提示，且不得依赖 URL 携带全文

### Requirement: 窗口与 DeepSeek 跳转可配置

系统 SHALL 提供独立大窗口与 DeepSeek 自动跳转两项配置，并采用安全默认值。

#### Scenario: 默认小窗口
- WHEN `preferLargeWindows` 为 false（默认）
- THEN 放大阅读 SHALL 在侧栏内展示，设置 SHALL 走系统 options 页

#### Scenario: 开启独立大窗口
- WHEN 用户开启 `preferLargeWindows` 并保存
- THEN 设置与放大阅读 SHALL 打开居中独立扩展窗口

#### Scenario: 关闭 DeepSeek 跳转
- WHEN `autoFocusDeepSeek` 为 false 且使用网页模式解读
- THEN 系统 SHALL 继续桥接 DeepSeek，但不得强制把该标签页切到前台

