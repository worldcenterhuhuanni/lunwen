# Design: Multi-mode Analysis

## 分层

三种入口统一产出 `Material`。论文材料继续携带正文或 PDF 附件；项目材料携带 `WorkspaceSource`，源码内容保存在 IndexedDB，由工具按需访问。

```text
source adapter -> material/workspace -> prompt or agent -> provider transport -> result
```

`sidepanel/App.tsx` 只负责编排和展示，不直接实现 GitHub、文件系统、索引或 patch 算法。

## 工作区

`ProjectIndex` 保存来源、版本、文件元数据、统计与缓存键。工作区统一提供：

- `list_files`：按路径前缀列出文件
- `search_text`：在已索引文本中搜索并返回带路径/行号的片段
- `read_file`：读取指定文本文件或行区间
- `propose_patch`：生成候选文件内容和 unified diff，不直接写入

默认排除版本库元数据、依赖、构建产物、二进制、密钥文件与超限文件。所有排除均进入统计，不能静默声称“完整分析”。

## GitHub

首版只处理 `github.com/{owner}/{repo}` 公开仓库默认分支。中小仓优先下载 tarball，以减少未认证 API 请求；下载、gzip 解压、tar 遍历和索引在 Worker 中执行。归档或解压后内容超过硬上限时终止并说明原因。远程来源只读。

## 本地文件系统

Chromium 在用户点击事件内调用 `showDirectoryPicker`。目录句柄可结构化克隆到 IndexedDB，重访前必须检查权限。缺少 File System Access API 时使用目录文件 input 只读导入，不能写回。

写回流程固定为：记录源文件指纹 -> 生成候选内容 -> 展示 diff -> 用户逐文件确认 -> 重新读取并校验指纹 -> 创建 writable -> 写入。拒绝绝对路径、`..`、`.git`、二进制、敏感路径及未索引文件。

## Agent 与模型传输

使用 `@earendil-works/pi-agent-core` 管理消息、工具循环、事件、取消和最大步数，使用 `@earendil-works/pi-ai` 适配现有 OpenAI-compatible API 配置。

DeepSeek 网页模式没有原生工具调用。适配器向模型发送固定 JSON action schema，将合法 action 转换为 Agent 工具调用，并把工具结果发回同一网页会话。每轮只允许一个动作，设置步数、响应大小和解析重试上限；最终回答也必须使用明确 action。

论文模式继续走原有 `streamChat`，避免为现有路径引入 Agent 回归。

## 存储

- `chrome.storage.local`：配置和模板
- `chrome.storage.session`：阅读/diff 大窗口临时载荷
- IndexedDB：项目索引、文件文本、目录句柄和版本元数据

索引键由来源 ID 与版本组成。GitHub 使用默认分支提交 SHA；本地使用目录 ID 与文件修改时间/大小指纹。

## UI

侧栏顶部使用论文、GitHub、本地三态模式轨道。项目模式显示来源身份、索引进度、文件/字节/排除统计、工具轨迹与回答。文件详情和 diff 使用独立大窗口，避免侧栏过载。
