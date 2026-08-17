# Tasks

## 1. 重构打底（不改行为）

- [x] `entrypoints/sidepanel/useAnalysis.ts`：平移 `streamInto` / `readWith` / `analyzeProject` / `importProject` / `ask` / `stopCurrentTask` 与相关 state
- [x] 拆出 `panels/PaperPanel.tsx`、`panels/GitHubPanel.tsx`、`panels/LocalPanel.tsx`，`App.tsx` 只保留布局与条件渲染（910 → 400 行）
- [x] 拆出 `ToolTrace.tsx`，条目支持展开查看参数与结果摘要
- [x] `pnpm compile` + `pnpm test` 确认行为未变

## 2. 会话持久化

- [x] 抽出 `lib/db.ts` 共享 IndexedDB 入口，`DB_VERSION` 升到 2，新增 `sessions` store 与 `updatedAt` / `workspaceId` 索引
- [x] `lib/session/store.ts`：`saveSession` / `listSessions` / `getSession` / `deleteSession`，写入时剥离 `pdf.data`、保留 `pdf.name`
- [x] 历史上限 50 条，超出按 `updatedAt` 淘汰最旧
- [x] 每轮回答结束后落盘；侧栏挂载时恢复最近一条会话与其锁定模板
- [x] 恢复的 PDF 会话在网页模式追问时提示重新选择文件，不静默发送无附件请求
- [x] 单测：落盘剥离附件字节、上限淘汰、按最近更新排序、同 id 更新而非新增
- [x] 单测：恢复的会话追问沿用记录模板（把选择逻辑抽成 `resolveFollowupTemplate` 纯函数后直接测，不引入渲染环境）

## 3. 索引复用与管理

- [x] `store.ts` 新增 `deleteWorkspace(id)`：一个事务内删记录 + 全部 `files` 行 + 关联 sessions
- [x] `github/client.ts`：拿到 commit sha 后先 `getWorkspace(id)`，命中则跳过下载解压直接返回 `Material`
- [x] `local/client.ts`：新增 `reindexLocalWorkspace(workspaceId)`，从持久化 `rootHandle` 出发 `queryPermission` → `requestPermission` → 复用原 id 重建索引；权限被撤销时明确提示重新选择目录
- [x] `RecentMaterials.tsx`：列出历史条目（标题、模式、时间、索引统计），支持恢复会话、复用索引、重索引、删除
- [x] 项目材料头部显示索引时间，本地模式提供「重新索引」按钮
- [x] 单测：GitHub 同 sha 命中缓存不发起归档下载
- [x] 单测：`deleteWorkspace` 级联清理文件行与会话且不误伤其他工作区；重建索引清掉旧文件行

## 4. 划词解读

- [x] `wxt.config.ts` 增加 `contextMenus` 权限
- [x] `background.ts` 注册 `selection` 上下文菜单；`onClicked` 中先 `sidePanel.open()` 保住用户手势，再写 `storage.session` 的 pending capture
- [x] 侧栏挂载与激活时消费 pending capture，走 `extractFromPlainText` 按当前模板解读，消费后清除
- [x] 忙碌中触发划词只提示、不打断正在进行的分析
- [x] 单测：pending capture 消费一次后即清除（mock `#imports` 的 storage）

## 5. 小体验

- [x] 追问框改 `textarea`：Enter 发送、Shift+Enter 换行、随内容自适应高度（上限 116px）
- [x] 工具轨迹展开态样式与键盘可达（用原生 button，天然可聚焦）

## 6. 收尾

- [x] `pnpm test`（39 通过）、`pnpm compile`、`pnpm build`
- [x] 引入 `fake-indexeddb` 作为 devDependency，覆盖 IndexedDB 分支逻辑
- [x] 构建产物 manifest 含 `contextMenus` 权限
- [x] `openspec validate reading-history-and-capture --strict`
- [ ] 按验收清单逐条在 `output/chrome-mv3` 实测（需人工加载扩展）
