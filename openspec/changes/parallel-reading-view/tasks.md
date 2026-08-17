# Tasks

## 1. 存储与数据结构

- [x] `lib/db.ts`：`DB_VERSION` 2 → 3，新增 `documents` store（keyPath `sessionId`，`updatedAt` 索引）
- [x] `lib/session/document-store.ts`：`putDocument` / `getDocument` / `deleteDocument`，保留上限 3 篇按 `updatedAt` 淘汰
- [x] `deleteWorkspace` / `deleteSession` 时一并清理对应文档
- [x] `lib/session/types.ts`：新增 `Excerpt`；`Turn` 加可选 `excerptId`，`StoredSession` 加可选 `excerpts`
- [x] 单测：文档上限淘汰、删除会话连带清理、旧会话（无 excerpts 字段）仍能正常读出

## 2. PDF 渲染

- [x] `lib/pdf-render.ts`：加载文档、按页取 viewport、canvas 按 devicePixelRatio 渲染
- [x] `entrypoints/reader/PdfPane.tsx`：分页容器、只渲染视口附近的页并释放滚出去的 canvas
- [x] 用 `TextLayer` 渲染可选中文本层，补最小必需 CSS（不引整份 `pdf_viewer.css`）
- [x] 单测：归一化矩形换算（页内坐标 ↔ 0-1）双向一致，并把几何函数与 pdfjs 拆开（pdfjs 在 node 下无法导入）

## 3. 选区与关联

- [x] 选中文本后浮出「问 AI」按钮，取 `range.getClientRects()` 归一化成 `Excerpt`
- [x] 高亮层：按归一化矩形绘制，缩放与窗口宽度变化后仍对齐
- [x] 点分析卡片 → 滚动到对应页并高亮该片段
- [x] 点原文高亮 → 滚动到引用它的分析卡片
- [x] 无 `excerptId` 的轮次显示为「全文分析」

## 4. 对照页面

- [x] `entrypoints/reader/ParallelView.tsx`：左右分栏布局、可拖拽分隔条
- [x] `reader/App.tsx` 按 `view=parallel` 分支到对照视图，保留现有 `reader` / `patch` 两种形态
- [x] `useReaderAnalysis.ts`：对照页自己的精简分析状态机，片段追问只发片段原文、不重传 PDF
- [x] 追问结果写回同一条 `StoredSession`（含 `excerptId` 与 `excerpts`）
- [x] PDF 字节缺失时给可操作提示（回侧栏重新打开），不白屏

## 5. 入口与配置

- [x] `lib/extension-windows.ts`：新增 `openParallelReader`，`preferLargeWindows` 为 false 走 `tabs.create`，为 true 走现有居中窗口
- [x] 侧栏放大按钮在论文模式改为进入对照视图；候选 diff 审阅路径保持不变
- [x] 打开对照前把当前 PDF 字节写入 `documents`
- [x] 设置页 `preferLargeWindows` 的文案改为描述「标签页 / 独立窗口」

## 6. 收尾

- [x] `pnpm test`、`pnpm compile`、`pnpm build`
- [x] `openspec validate parallel-reading-view --strict`
- [ ] 人工实测：一篇带图表公式的论文走完选中→追问→双向定位→关闭重开
