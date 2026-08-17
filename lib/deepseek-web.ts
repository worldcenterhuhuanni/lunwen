// DeepSeek 网页桥接客户端:找到已登录的 chat.deepseek.com 标签页,
// 经 Port 让 content script 填框/发送/轮询回复,对外暴露与 streamChat 一致的异步文本流。
import { browser } from 'wxt/browser';
import { arrayBufferToBase64 } from './bytes';
import { throwIfAborted } from './abort';

export const DEEPSEEK_CHAT_URL = 'https://chat.deepseek.com/';
const TAB_URL_PATTERNS = ['https://chat.deepseek.com/*', 'http://chat.deepseek.com/*'];
const CONTENT_SCRIPT_FILE = '/content-scripts/deepseek.js' as const;
const PORT_NAME = 'deepseek-web';
const PING_TIMEOUT_MS = 20_000;
const ASK_IDLE_TIMEOUT_MS = 180_000;
const ASK_HARD_TIMEOUT_MS = 600_000;

export type DsWebPortMsg =
  | { type: 'ready' }
  | { type: 'progress'; message: string }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'status'; loggedIn: boolean; hasInput: boolean };

/** Port 传输用 Base64,避免 ArrayBuffer 克隆失败变成 15B 假文件 */
export type DsWebFileWire = {
  name: string;
  mime: string;
  dataBase64: string;
  byteLength: number;
};

type DsWebAskCmd = {
  type: 'ask';
  prompt: string;
  newChat: boolean;
  file?: DsWebFileWire;
};
type DsWebCancelCmd = { type: 'cancel' };
type DsWebPingCmd = { type: 'ping' };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitTabComplete(
  tabId: number,
  timeoutMs = PING_TIMEOUT_MS,
  signal?: AbortSignal,
) {
  const start = Date.now();
  for (;;) {
    throwIfAborted(signal);
    const tab = await browser.tabs.get(tabId);
    if (tab.status === 'complete') return;
    if (Date.now() - start > timeoutMs) {
      throw new Error('DeepSeek 页面加载超时,请手动打开 chat.deepseek.com 后重试。');
    }
    await sleep(200);
  }
}

/** 探测 content script 是否已注入并响应。失败时带回具体原因便于排查。 */
async function pingTab(tabId: number): Promise<{ ok: true; msg: DsWebPortMsg } | { ok: false; reason: string }> {
  try {
    const res = (await browser.tabs.sendMessage(tabId, { type: 'ping' } satisfies DsWebPingCmd)) as
      | DsWebPortMsg
      | undefined;
    if (res?.type === 'status' || res?.type === 'ready') return { ok: true, msg: res };
    return { ok: false, reason: `页面脚本响应异常: ${JSON.stringify(res)}` };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || String(e) };
  }
}

/** 静态 content_scripts 未注入时(或扩展刚重载),用 scripting 强制注入一次。 */
async function injectBridgeScript(tabId: number): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });
  } catch (e) {
    throw new Error(
      `无法注入 DeepSeek 页面脚本: ${(e as Error).message}\n` +
        '请确认加载的是生产包目录 output/chrome-mv3（manifest 里应有 content_scripts），不是旧的 chrome-mv3-dev。',
    );
  }
}

async function waitContentReady(
  tabId: number,
  timeoutMs = PING_TIMEOUT_MS,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  // 先 ping;失败则强制注入再等
  let lastReason = '';
  const first = await pingTab(tabId);
  if (first.ok) return;
  lastReason = first.reason;

  await injectBridgeScript(tabId);
  await sleep(200);

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    throwIfAborted(signal);
    const r = await pingTab(tabId);
    if (r.ok) return;
    lastReason = r.reason;
    await sleep(300);
  }

  const tab = await browser.tabs.get(tabId);
  throw new Error(
    `无法连接 DeepSeek 页面脚本。\n` +
      `当前标签: ${tab.url || '(未知)'}\n` +
      `原因: ${lastReason}\n\n` +
      `请按顺序操作:\n` +
      `1. chrome://extensions 移除旧扩展\n` +
      `2.「加载已解压的扩展程序」选 output/chrome-mv3（不要选 chrome-mv3-dev）\n` +
      `3. 打开并刷新 https://chat.deepseek.com\n` +
      `4. 再点「检测网页连接」`,
  );
}

/** 是否已在某个历史会话 URL(/a/chat/s/...) */
function isConversationUrl(url: string | undefined): boolean {
  return Boolean(url && /\/a\/chat\/s\//i.test(url));
}

/** 是否已在站点根(新对话落点) */
function isChatHomeUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      /(?:^|\.)chat\.deepseek\.com$/i.test(u.hostname) &&
      (u.pathname === '/' || u.pathname === '')
    );
  } catch {
    return false;
  }
}

/**
 * 强制进入空白新对话。
 * 只靠页面点「新对话」不可靠(选择器常失效,失败还静默继续发到旧会话)。
 * 扩展侧导航/刷新更稳,且必须在 Port 连接之前完成(刷新会断 content script)。
 */
async function navigateToNewChat(
  tabId: number,
  onProgress?: (m: string) => void,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const tab = await browser.tabs.get(tabId);
  const url = tab.url || '';
  onProgress?.('正在开启新对话…');

  if (isConversationUrl(url) || !isChatHomeUrl(url)) {
    await browser.tabs.update(tabId, { url: DEEPSEEK_CHAT_URL });
  } else {
    // 已在首页:仍可能残留上一次失败的草稿/附件,刷新清掉
    await browser.tabs.reload(tabId);
  }

  await waitTabComplete(tabId, PING_TIMEOUT_MS, signal);
  await waitContentReady(tabId, PING_TIMEOUT_MS, signal);
  await sleep(600);
  throwIfAborted(signal);
}

/** 复用已有 DeepSeek 标签;没有则新建。autoFocus=false 时不抢前台。 */
export async function ensureDeepSeekTab(opts?: {
  autoFocus?: boolean;
  signal?: AbortSignal;
}): Promise<number> {
  throwIfAborted(opts?.signal);
  const autoFocus = opts?.autoFocus !== false;
  const existing = await browser.tabs.query({ url: TAB_URL_PATTERNS });
  // 优先当前窗口、未丢弃的标签
  const tab =
    existing.find((t) => t.id != null && t.active && !t.discarded) ??
    existing.find((t) => t.id != null && !t.discarded) ??
    existing.find((t) => t.id != null);

  if (tab?.id != null) {
    if (tab.discarded) {
      await browser.tabs.reload(tab.id);
    }
    if (autoFocus) {
      try {
        await browser.tabs.update(tab.id, { active: true });
      } catch {
        /* ignore */
      }
    }
    await waitTabComplete(tab.id, PING_TIMEOUT_MS, opts?.signal);
    await waitContentReady(tab.id, PING_TIMEOUT_MS, opts?.signal);
    return tab.id;
  }

  const created = await browser.tabs.create({ url: DEEPSEEK_CHAT_URL, active: autoFocus });
  if (created.id == null) throw new Error('无法打开 DeepSeek 标签页。');
  await waitTabComplete(created.id, PING_TIMEOUT_MS, opts?.signal);
  await waitContentReady(created.id, PING_TIMEOUT_MS, opts?.signal);
  return created.id;
}

/** 检查登录态(不发送消息)。 */
export async function checkDeepSeekWebStatus(): Promise<{ loggedIn: boolean; hasInput: boolean }> {
  const tabId = await ensureDeepSeekTab();
  const res = await pingTab(tabId);
  if (res.ok && res.msg.type === 'status') {
    return { loggedIn: res.msg.loggedIn, hasInput: res.msg.hasInput };
  }
  // ensure 已保证可 ping;若仍非 status,当作未就绪
  return { loggedIn: false, hasInput: false };
}

export async function* streamDeepSeekWeb(
  prompt: string,
  opts: {
    newChat: boolean;
    signal?: AbortSignal;
    file?: { name: string; mime: string; data: ArrayBuffer };
    onProgress?: (message: string) => void;
    /** 是否自动聚焦 DeepSeek 标签；默认 true */
    autoFocus?: boolean;
  },
): AsyncGenerator<string> {
  const text = prompt.trim();
  if (!text) throw new Error('提示词为空。');
  const autoFocus = opts.autoFocus !== false;

  opts.onProgress?.('正在连接 DeepSeek 页面…');
  const tabId = await ensureDeepSeekTab({ autoFocus, signal: opts.signal });

  // 新会话必须在连 Port 前导航:content script 里点按钮经常点空,消息会落到旧对话
  if (opts.newChat) {
    await navigateToNewChat(tabId, opts.onProgress, opts.signal);
  }

  if (autoFocus) {
    try {
      await browser.tabs.update(tabId, { active: true });
    } catch {
      /* ignore */
    }
  }

  const port = browser.tabs.connect(tabId, { name: PORT_NAME });

  let last = '';
  let settled = false;
  let fail: Error | null = null;
  const startedAt = Date.now();
  let lastActivityAt = startedAt;
  const queue: string[] = [];
  let wake: (() => void) | null = null;

  const kick = () => {
    wake?.();
    wake = null;
  };

  const onMessage = (msg: DsWebPortMsg) => {
    if (msg.type === 'progress') {
      lastActivityAt = Date.now();
      opts.onProgress?.(msg.message);
    } else if (msg.type === 'delta') {
      const full = msg.text ?? '';
      if (full.length >= last.length) {
        const delta = full.slice(last.length);
        last = full;
        if (delta) {
          lastActivityAt = Date.now();
          queue.push(delta);
          kick();
        }
      }
    } else if (msg.type === 'done') {
      settled = true;
      kick();
    } else if (msg.type === 'error') {
      fail = new Error(msg.message || 'DeepSeek 网页桥接失败');
      settled = true;
      kick();
    }
  };

  port.onMessage.addListener(onMessage as (m: unknown) => void);
  const onDisconnect = () => {
    if (!settled) {
      fail = new Error('与 DeepSeek 页面的连接已断开,请保持该标签页打开。');
      settled = true;
      kick();
    }
  };
  port.onDisconnect.addListener(onDisconnect);

  const onAbort = () => {
    try {
      port.postMessage({ type: 'cancel' } satisfies DsWebCancelCmd);
    } catch {
      /* ignore */
    }
    fail = new DOMException('Aborted', 'AbortError');
    settled = true;
    kick();
    try {
      port.disconnect();
    } catch {
      /* ignore */
    }
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    let wireFile: DsWebFileWire | undefined;
    if (opts.file) {
      const n = opts.file.data.byteLength;
      if (n < 1024) throw new Error(`PDF 数据异常(${n}B),拒绝上传。`);
      opts.onProgress?.(`正在编码 PDF(${(n / 1024 / 1024).toFixed(1)}MB)…`);
      wireFile = {
        name: opts.file.name,
        mime: opts.file.mime || 'application/pdf',
        dataBase64: arrayBufferToBase64(opts.file.data),
        byteLength: n,
      };
      opts.onProgress?.(`正在把 PDF(${(n / 1024 / 1024).toFixed(1)}MB)交给网页…`);
    } else {
      opts.onProgress?.(opts.newChat ? '正在新开会话并发送…' : '正在当前会话发送…');
    }

    const cmd: DsWebAskCmd = {
      type: 'ask',
      prompt: text,
      newChat: opts.newChat,
      ...(wireFile ? { file: wireFile } : {}),
    };
    port.postMessage(cmd);

    while (!settled || queue.length) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (fail) throw fail;
      if (queue.length) {
        yield queue.shift()!;
        continue;
      }
      if (settled) break;
      const now = Date.now();
      if (now - lastActivityAt > ASK_IDLE_TIMEOUT_MS) {
        // 页面正在生成时 content script 会定期报活，所以走到这里意味着页面真的没动静。
        throw new Error(
          'DeepSeek 页面 3 分钟没有任何动静：既没有在生成，也没有新内容。请到聊天页确认是否卡在登录、风控或排队。',
        );
      }
      if (now - startedAt > ASK_HARD_TIMEOUT_MS) {
        throw new Error('DeepSeek 单次回复超过 10 分钟，已停止等待。');
      }
      await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, 400);
      });
    }
    if (fail) throw fail;
    if (!last.trim()) throw new Error('DeepSeek 没有返回内容。请确认网页已登录且未触发风控。');
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    port.onMessage.removeListener(onMessage as (m: unknown) => void);
    port.onDisconnect.removeListener(onDisconnect);
    try {
      port.disconnect();
    } catch {
      /* ignore */
    }
  }
}

/** 压成网页单次发送的 prompt。 */
export function messagesToWebPrompt(messages: { role: string; content: string }[]): string {
  const users = messages.filter((m) => m.role === 'user');
  const lastUser = users[users.length - 1]?.content?.trim() ?? '';
  const system = messages.find((m) => m.role === 'system')?.content?.trim() ?? '';
  // 多轮追问通常只发最后一条 user;首轮带上 system
  if (users.length <= 1 && system && lastUser) return `${system}\n\n---\n\n${lastUser}`;
  return lastUser || system;
}
