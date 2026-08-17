# 设计

## 承载：复用 reader 入口，只换打开方式

`reader.html` 已经具备加载、失效提示、关闭的骨架。对照视图作为它的第三种 `kind`（现有 `reader` / `patch`），通过查询参数区分。

```
preferLargeWindows = false → tabs.create(reader.html?session=<id>&view=parallel)   // 新标签页，全宽
preferLargeWindows = true  → windows.create(...)                                    // 独立窗口，同一页面
```

两条路同一份代码，配置项的语义从「侧栏内 / 独立窗口」变成「标签页 / 独立窗口」。侧栏内的窄弹框 `MarkdownModal` 在论文模式下不再使用（项目模式的候选 diff 审阅仍保留原路径）。

## PDF 字节怎么到对照页

`storage.session` 配额约 10MB，装不下论文 PDF。`URL.createObjectURL` 跨扩展页面可用，但侧栏一关 blob 就失效，对照页正读着就断了。

所以在 IndexedDB 加一个 `documents` store，只存**当前对照文档**：

```ts
interface StoredDocument {
  sessionId: string;      // 与会话同键，天然一一对应
  name: string;
  mime: string;
  data: ArrayBuffer;
  updatedAt: number;
}
```

这不违反上一个变更「PDF 字节不入库」的决定——那条针对的是历史列表里几十条 × 几十 MB 常驻；这里只保留最近打开过对照的少数几篇（上限 3 篇，按 `updatedAt` 淘汰），且删除会话时一并清理。`DB_VERSION` 2 → 3。

## 左栏渲染

pdfjs-dist 已在依赖里，但目前只用于抽文本。对照视图用它的渲染路径：

```
page.getViewport({ scale })
  → canvas 按 devicePixelRatio 放大，page.render({ canvasContext, transform, viewport })
  → new TextLayer({ textContentSource: page.streamTextContent(), container, viewport }).render()
```

`TextLayer` 是当前公开 API（旧的 `renderTextLayer` 函数已被它取代）。它把每个文本片段渲染成绝对定位的透明 `<span>` 盖在 canvas 上，于是**浏览器原生选中直接可用**，不需要自己实现选区逻辑。配套 CSS 只取 textLayer 必需的那几条，不引入整个 `pdf_viewer.css`。

按需渲染：只渲染视口附近的页，滚出去的页释放 canvas，避免长文档吃满内存。

## 关联：由选中动作产生，不依赖模型输出

这是本设计最关键的一点。让模型在回答里输出引用标记（`[[p3:...]]`）看似省事，实则把整条链的可靠性押在模型听不听话上——网页桥接下尤其不可靠，解析一失败关联就断，而且失败是静默的。

改成关联由用户的动作产生，全程确定性：

```
选中 → Excerpt { id, page, text, rects[] } → 附在这轮提问上 → 回答记下 excerptId
```

```ts
interface Excerpt {
  id: string;
  page: number;
  text: string;
  /** 归一化到 0-1 的页内矩形，缩放和窗口宽度变化后依然对得上 */
  rects: Array<{ x: number; y: number; w: number; h: number }>;
}
```

矩形取自 `range.getClientRects()`，减去页容器的位置再除以页面宽高得到归一化坐标。高亮就是按这些坐标画绝对定位的 div，与缩放无关。

`Turn` 加一个可选 `excerptId`，`StoredSession` 加一个可选 `excerpts`。都是可选字段，旧历史照常读。首轮整篇解读没有 `excerptId`，显示为「全文分析」。

双向定位因此是白送的：卡片 → `excerptId` → 找到 excerpt → 滚到 `page` 并高亮；点高亮 → 反查引用它的轮次 → 滚到那张卡片。

## 分析由对照页自己发起

对照页不把请求转发给侧栏。理由：真正的分析逻辑本来就在 lib 层（`streamChat`、`renderPromptTemplate`、`resolveFollowupTemplate`），`useAnalysis` 只是一台 UI 状态机；对照页写一个精简状态机即可，不构成复制。而且对照阅读是专注模式，不该因为侧栏被关掉就失效。

**片段追问不重传 PDF**：用户已经指明了要问哪一段，把这段原文连同问题发过去比整篇更精准，也避免每次几十 MB 的上传等待。网页模式下这类追问一律新开会话，prompt 自包含。

两边写同一条 `StoredSession`（同 `id`），谁先结束一轮谁落盘。并发写的窗口极小（同一时刻用户只会在一处提问），不加锁；`saveSession` 本身是整条覆盖，最坏情况是丢一条并发轮次，不会写坏结构。

## 取舍

- 左栏暂不做搜索、目录、缩放控件，先把对照和关联跑通
- HTML 材料左栏用纯文本流兜底，excerpt 用字符区间而非矩形，同一套关联机制
- 不做虚拟滚动，只做视口附近页的渲染/释放，几百页的论文足够
