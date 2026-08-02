import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // 开发模式不自动弹专用 Chrome:pnpm dev 只起 HMR server,你在自己的 Chrome 里
  // 手动加载 output/chrome-mv3-dev(保持 dev server 终端开着)。
  // 生产包:pnpm build → 加载 output/chrome-mv3(目录内应有 content-scripts/)。
  webExt: { disabled: true },
  // dev server 强制走 IPv4 127.0.0.1:默认 'localhost' 在 macOS 上只绑 IPv6 [::1],
  // 而 Chrome 常把 localhost 解析成 IPv4 → 连不上 → 脚本加载失败 → 侧边栏黑屏。
  // host + origin 同时钉死 127.0.0.1,消除 IPv4/IPv6 歧义。
  dev: {
    server: { host: '127.0.0.1', port: 3000, origin: 'http://127.0.0.1:3000' },
  },
  // 产出到 output/;build → output/chrome-mv3,dev → output/chrome-mv3-dev
  outDir: 'output',
  manifest: {
    name: '材料解读助手',
    description:
      '分析论文、GitHub 公开仓库和本地工作区；支持受控源码检索、Diff 确认写回与多种模型通路。',
    // sidePanel 由 sidepanel 入口自动配置;这里补齐运行所需权限。
    permissions: ['storage', 'tabs', 'scripting', 'sidePanel', 'windows'],
    host_permissions: ['<all_urls>', 'https://chat.deepseek.com/*'],
    action: {}, // 工具栏图标,点击打开侧边栏
  },
});
