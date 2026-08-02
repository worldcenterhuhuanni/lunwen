# Design: Prompt Template Workbench

## 数据模型

`PromptTemplate` 同时包含 system/user 两段，适用范围为 `pdf | html | both`。内置模板随代码发布且只读；用户模板单独保存在 `local:promptTemplates`。

配置只保存 `defaultPdfTemplateId` 与 `defaultHtmlTemplateId`，不保存模板正文。侧栏的临时选择仅存在当前面板会话。

## 变量

- `{{title}}`：材料标题
- `{{source}}`：来源
- `{{content}}`：智能摘取后的文本；PDF 附件模式为空
- `{{question}}`：本轮追问
- `{{material}}`：推荐变量，自动生成适配 PDF 附件/PDF 文本/HTML 的材料块

渲染器只替换白名单变量，不使用 `eval`。保存前校验未知变量、空提示词和材料变量缺失。

## 执行流

```
本地模板 + PDF/HTML 默认指针
  → 侧栏自动选择或临时覆盖
  → Paper + maxContextChars 生成模板上下文
  → renderPromptTemplate
  → system/user messages
  → DeepSeek 网页桥接或 API
```

DeepSeek 网页 PDF 上传不能再丢弃 system 消息，需将两段模板合并后随附件发送。

## AI 生成

设置页将用户的目标描述与适用类型发送给当前 provider，要求返回固定 JSON。解析、校验成功后只写入编辑草稿；用户点击保存才进入本地模板库。

## 兼容

`local:config` 使用版本迁移补齐两个默认模板 ID；读取时仍与 `DEFAULT_CONFIG` 合并。缺失或已删除的模板 ID 回退到专业默认模板。
