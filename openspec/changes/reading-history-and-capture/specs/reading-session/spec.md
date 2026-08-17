# Reading Session Spec

## ADDED Requirements

### Requirement: 解读会话持久化

系统 SHALL 把材料元信息与全部对话轮次持久化到本机，并在侧栏重新打开时恢复最近一次会话。

#### Scenario: 侧栏重开
- WHEN 用户关闭侧栏后重新打开
- THEN 系统 SHALL 恢复最近一次会话的材料信息与全部已完成轮次
- AND 恢复的会话 SHALL 沿用该会话锁定的提示词模板

#### Scenario: 轮次落盘时机
- WHEN 一次助手回答结束、失败或被用户中断
- THEN 系统 SHALL 持久化当前会话的已完成轮次

#### Scenario: 附件不入库
- WHEN 会话材料包含 PDF 附件字节
- THEN 系统 SHALL 只持久化附件文件名与元信息，不写入附件字节

#### Scenario: 恢复后追问 PDF 会话
- WHEN 用户在恢复的 PDF 网页模式会话中追问
- THEN 系统 SHALL 提示重新选择该 PDF 文件，不得发送缺失附件的请求

### Requirement: 历史材料列表

系统 SHALL 提供历史材料列表，展示标题、分析模式、时间与索引统计，并支持恢复、复用与删除。

#### Scenario: 恢复历史会话
- WHEN 用户从列表中选择一条历史记录
- THEN 系统 SHALL 载入该会话的材料与全部轮次，且不重新请求模型

#### Scenario: 删除历史记录
- WHEN 用户删除一条历史记录
- THEN 系统 SHALL 同时移除该记录与其关联的索引文件行，不留孤儿数据

#### Scenario: 数量上限
- WHEN 历史记录超过上限
- THEN 系统 SHALL 按最近更新时间淘汰最旧记录

### Requirement: 已建索引可复用

系统 SHALL 在重复导入同一项目时复用已建立的本地索引，避免重复下载与解析。

#### Scenario: 同一 GitHub 提交
- WHEN 用户导入的 GitHub 仓库与已存索引属于同一提交
- THEN 系统 SHALL 直接使用已存索引进入分析
- AND 不得发起归档下载或源码读取请求

#### Scenario: 复用本地已授权目录
- WHEN 用户对历史本地工作区触发复用或重新索引且目录句柄仍有效
- THEN 系统 SHALL 在取得读取权限后复用原工作区标识重建索引

#### Scenario: 目录权限已失效
- WHEN 持久化目录句柄不再具有读取权限且用户拒绝重新授权
- THEN 系统 SHALL 提示重新选择目录，不得静默返回过期索引

### Requirement: 索引新鲜度可见

系统 SHALL 展示项目索引的建立时间，并允许用户主动重新索引本地工作区。

#### Scenario: 展示索引时间
- WHEN 当前材料是 GitHub 或本地工作区
- THEN 系统 SHALL 显示该索引的建立时间

#### Scenario: 重新索引
- WHEN 用户对本地工作区触发重新索引
- THEN 系统 SHALL 重建索引并更新统计数字与索引时间
