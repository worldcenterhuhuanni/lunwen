# Design: Large Reader Windows

## 窗口策略

Chrome 侧栏不能把自身 DOM 覆盖到浏览器主视口。设置页之所以“看起来在窗口中间”，是因为 `options_ui` 由浏览器托管；该容器尺寸不可控，且仅服务设置页。

统一方案：`browser.windows.create({ type: 'popup' })` 打开扩展自有页面，按当前浏览器窗口居中并限制在可用屏幕内。

- 设置：`/options.html`，约 1100×860
- 阅读：`/reader.html?id=…`，约 1180×900
- 创建失败时回退：`openOptionsPage()` / 报错提示

需要 `windows` 权限。

## 临时数据

长 Markdown 不进 URL。打开阅读前写入 `chrome.storage.session`：

```ts
{ id, title, source?, content, createdAt }
```

阅读页按 `id` 读取；`pagehide` / 关闭时删除。缺失则展示“内容已失效，请回侧栏重新放大”。

## 悬浮操作

`.tutor-actions` 改为卡片内 `position: sticky`，贴在阅读区顶部；仅 hover / focus-within 显示，触屏常显。点击后打开独立阅读窗口，移除侧栏内 `MarkdownModal`。

## 视觉

阅读窗与设置页沿用燕麦米黄、胡桃木、暗朱砂、旧金；宽纸页、固定题头、正文独立滚动。
