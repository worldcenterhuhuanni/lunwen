# 设计

## 存储：复用现有 IndexedDB，不新增依赖

`lib/workspace/store.ts` 已有 `material-analysis` 库（`workspaces` / `files` 两个 store）。历史会话加第三个 store `sessions`，走同一次 `DB_VERSION` 升级（1 → 2）。

```ts
interface StoredSession {
  id: string;              // crypto.randomUUID()
  updatedAt: number;       // 列表排序键，建索引
  material: StoredMaterial;// Material 去掉 pdf 字节
  turns: Turn[];
  templateId: string;      // 锁定的模板，恢复后追问不漂移
}
```

**为什么不存 PDF 附件字节**：一篇论文动辄几十 MB，`Material.pdf.data` 是 ArrayBuffer。恢复历史会话只用于*读*已生成的解读；一旦用户在恢复的 PDF 会话里追问，网页模式需要重新上传附件——此时提示用户重新选择文件，而不是把几十 MB 塞进 IndexedDB 换一个低频场景。`StoredMaterial` 保留 `pdf.name` 以便提示。

写入时机：每次 assistant 轮次结束（`finally` 里）落一次盘，而不是每个 token。流式过程中崩溃最多丢失未完成的一轮。

## 索引复用：GitHub 靠 id 天然去重

`workspaceId = github:${full_name}:${sha}` 已经是内容寻址。导入流程在拿到 commit sha 之后、下载归档之前插一次 `getWorkspace(id)`：命中就直接用已存记录构造 `Material` 返回，省掉整个下载 + 解压 + 索引链路。

本地目录不能这样做——`local:${uuid}` 每次导入都是新 id。复用走另一条路：从 `WorkspaceRecord.rootHandle`（已持久化的目录句柄）出发，`queryPermission` → 必要时 `requestPermission` → 复用原 `workspaceId` 重新走一遍 `buildWorkspace` + `saveWorkspace`。这同时就是「重新索引」功能，两个入口一套代码。

句柄权限被撤销时不静默失败：明确提示需要重新选择目录。

## 删除：补上缺失的 deleteWorkspace

现有 store 只有写和读。加 `deleteWorkspace(id)`：一个事务里删 `workspaces` 记录 + 按 `workspaceId` 索引游标删全部 `files` 行 + 删除引用它的 `sessions`。不做引用计数，因为一个 workspace 只属于一条导入记录。

## 划词解读：background 注册菜单，侧栏消费

```
contextMenus.onClicked → 存 pending capture 到 storage.session
                       → sidePanel.open({ windowId })
                       → 侧栏挂载/激活时读取并消费 pending
```

**为什么经 storage 而不是直接 sendMessage**：侧栏可能尚未打开，没有接收方，消息会丢。`storage.session` 让"侧栏还没起来"和"侧栏已经在跑"两种情况走同一条路径——侧栏起来后主动取一次，取完即清。

`sidePanel.open()` 必须在用户手势的同步调用栈里，`contextMenus.onClicked` 满足这个条件；先 await 存储再 open 会丢失手势，所以顺序是先 open 再落盘。

需要新增 `contextMenus` 权限。选中文字走已有的 `extractFromPlainText` 管线，不新增提取逻辑。

## 拆分：状态机与视图分离

`App.tsx` 910 行里真正复杂的是一台状态机：`status × mode × provider` 决定走 `streamInto` / `runProjectAgent` / `runWebGitHubAnalysis` 三条路径之一。

```
entrypoints/sidepanel/
  App.tsx                 // 组装：布局 + 三个面板的条件渲染
  useAnalysis.ts          // 全部分析状态与动作（含历史读写、划词消费）
  panels/PaperPanel.tsx
  panels/GitHubPanel.tsx
  panels/LocalPanel.tsx
  RecentMaterials.tsx
  ToolTrace.tsx
```

平移原则：先不改行为，`useAnalysis` 的导出签名对齐现有函数名（`readWith` / `analyzeProject` / `ask` / `stopCurrentTask`），靠 `pnpm compile` 与现有测试兜底，再在其上加历史功能。

**原计划的 `useSession.ts` 最终没有拆出来。** 历史恢复、复用索引、重新索引都要读写同一批状态（`paperRef`、`sessionIdRef`、`activeTemplateRef`、`status`），拆成两个 hook 就得把十来个状态和 setter 当参数传来传去，耦合没减少只是换了地方。`useAnalysis` 是一台完整的状态机，按分区注释组织比强行切成两个文件更好维护。

## 落盘时机的陷阱

不能在 `finally` 里同步读 `turns` 再落盘：`setTurns` 的 updater 是异步执行的，同步读到的是上一轮快照。也不能靠 `useEffect([turns])`——最后一轮清理占位气泡时若无需改动会返回同一个数组引用，React 直接 bail out，effect 根本不触发。

正确做法是打一个自增 `persistTick`：它和 `setTurns` 在同一批更新里合并，effect 依赖 `persistTick` 触发时，闭包里的 `turns` 已是最新值。

## 取舍

- 历史条数上限 50，超出按 `updatedAt` 淘汰最旧。避免无限增长又不必做分页。
- 不做全文搜索历史。50 条以内肉眼可扫。
