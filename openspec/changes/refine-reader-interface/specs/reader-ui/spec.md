# Reader UI Spec

## ADDED Requirements

### Requirement: 紧凑粘贴入口

系统 SHALL 默认折叠粘贴文字输入，并在展开后保留原有解读能力。

#### Scenario: 默认打开侧栏
- WHEN 用户尚未展开粘贴入口
- THEN 控件 SHALL 只占一行且其他主要入口保持可见

### Requirement: 放大阅读 Markdown

系统 SHALL 为已生成的助手结果提供独立放大阅读操作。

#### Scenario: 打开放大视图
- WHEN 用户点击结果右上角放大按钮
- THEN 系统 SHALL 在弹框中展示同一 Markdown 内容与论文标题

#### Scenario: 关闭弹框
- WHEN 用户点击关闭、遮罩或按 Escape
- THEN 弹框 SHALL 关闭且侧栏原内容保持原位

### Requirement: 安全 Markdown 渲染

系统 SHALL 不依赖原始 HTML 注入地展示常用 Markdown。

#### Scenario: 外部链接
- WHEN Markdown 包含链接
- THEN 链接 SHALL 在新标签页打开并使用安全的 rel 属性
