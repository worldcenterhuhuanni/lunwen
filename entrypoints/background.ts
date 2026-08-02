// 唯一职责:点击工具栏图标时打开侧边栏(无 popup,全部逻辑在 sidepanel 内)。
export default defineBackground(() => {
  const sidePanel = (browser as any).sidePanel;
  sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: true })
    .catch((e: unknown) => console.error('setPanelBehavior 失败', e));
});
