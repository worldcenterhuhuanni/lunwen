// 职责:打开侧边栏的两个入口(工具栏图标、划词右键菜单)。全部分析逻辑都在 sidepanel 内。
import { CAPTURE_MENU_ID, pendingCaptureItem } from '@/lib/capture';

export default defineBackground(() => {

  const sidePanel = (browser as any).sidePanel;
  sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: true })
    .catch((e: unknown) => console.error('setPanelBehavior 失败', e));

  // 菜单在每次装载/更新时重建;重复 id 会报错,先移除再建。
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.removeAll(() => {
      browser.contextMenus.create({
        id: CAPTURE_MENU_ID,
        title: '用材料解读助手解读这段',
        contexts: ['selection'],
      });
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CAPTURE_MENU_ID) return;
    const text = info.selectionText?.trim();
    if (!text) return;

    // sidePanel.open 必须在用户手势的同步调用栈里:先 await 存储再 open 会丢掉手势,
    // 所以顺序固定为先开面板、再落盘,由侧栏那边负责等待数据到达。
    if (tab?.windowId != null) {
      try {
        sidePanel?.open?.({ windowId: tab.windowId });
      } catch (e) {
        console.error('打开侧边栏失败', e);
      }
    }

    void pendingCaptureItem.setValue({
      text,
      source: info.pageUrl || tab?.url || 'selection',
      title: tab?.title || '网页选中文字',
      at: Date.now(),
    });
  });
});
