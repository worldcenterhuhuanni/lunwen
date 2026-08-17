// DeepSeek 网页桥接 content script:
// 关键修复:等 PDF「上传/解析」真正完成后再发送,避免官网提示「解析失败,消息未能发送」。
// 填框用 execCommand/InputEvent 推 React 状态;优先点发送按钮并校验输入是否清空。
import { browser } from 'wxt/browser';

export default defineContentScript({
  matches: ['https://chat.deepseek.com/*'],
  runAt: 'document_idle',
  main() {
    const INPUT_SELECTORS = [
      'textarea[placeholder*="Message DeepSeek"]',
      'textarea[placeholder*="给 DeepSeek"]',
      'textarea[placeholder*="DeepSeek"]',
      'textarea[placeholder*="发送"]',
      'textarea[name="search"]',
      '#chat-input',
      'textarea',
    ];
    const SEND_SELECTORS = [
      'button[aria-label*="发送"]',
      'button[aria-label*="Send"]',
      'button[type="submit"]',
      'div[role="button"][aria-label*="发送"]',
      'div[role="button"][aria-label*="Send"]',
    ];
    const NEW_CHAT_SELECTORS = [
      'button[aria-label*="新对话"]',
      'button[aria-label*="New chat"]',
      'button[aria-label*="New Chat"]',
      'div[role="button"][aria-label*="新对话"]',
      'div[role="button"][aria-label*="New chat"]',
      'a[aria-label*="新对话"]',
      'a[aria-label*="New chat"]',
    ];
    const ASSISTANT_SELECTORS = ['.ds-markdown', '.markdown-body', '[class*="markdown"]'];
    const LOGIN_HINT = /登录|sign in|log in|驗證|验证码/i;
    const FAIL_HINT = /解析失败|未能发送|发送失败|upload failed|parse failed/i;
    const BUSY_HINT = /解析中|上传中|处理中|Uploading|Parsing|Loading/i;

    let cancelled = false;
    let busy = false;

    function sleep(ms: number) {
      return new Promise((r) => setTimeout(r, ms));
    }

    function qs<T extends Element>(selectors: string[]): T | null {
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el) return el as T;
      }
      return null;
    }

    function findInput(): HTMLTextAreaElement | null {
      for (const s of INPUT_SELECTORS) {
        const el = document.querySelector(s);
        if (el instanceof HTMLTextAreaElement) return el;
      }
      return null;
    }

    function isLoggedIn(): boolean {
      if (findInput()) return true;
      const body = document.body?.innerText?.slice(0, 2000) ?? '';
      if (LOGIN_HINT.test(body)) return false;
      if (document.querySelector('input[type="password"], .ds-sign-in-form__main, .ds-auth-form-wrapper')) {
        return false;
      }
      return Boolean(findInput());
    }

    function status() {
      return { type: 'status' as const, loggedIn: isLoggedIn(), hasInput: Boolean(findInput()) };
    }

    function throwIfPageError() {
      const body = document.body?.innerText || '';
      if (FAIL_HINT.test(body)) {
        throw new Error(
          'DeepSeek 提示「解析失败/未能发送」。常见原因:PDF 还在解析就点了发送,或附件未真正挂上。请刷新聊天页后重试;若仍失败,可先在网页手动上传同一 PDF 验证。',
        );
      }
    }

    /** 写入 React 受控 textarea:focus → selectAll → insertText → InputEvent 兜底 */
    async function fillInput(text: string) {
      const el = findInput();
      if (!el) throw new Error('找不到 DeepSeek 输入框。请刷新 chat.deepseek.com 后重试。');

      el.focus();
      await sleep(50);
      el.select();
      el.setSelectionRange(0, el.value.length);

      let ok = false;
      try {
        ok = document.execCommand('insertText', false, text);
      } catch {
        ok = false;
      }

      if (!ok || el.value.trim().length < Math.min(8, text.trim().length)) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(el, text);
        el.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: text,
          }),
        );
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // 再派发一次 beforeinput/input,提高 React 19 兼容性
      el.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        }),
      );

      await sleep(120);
      if (!el.value.trim()) {
        throw new Error('未能把文字写入 DeepSeek 输入框(页面可能改版)。请刷新后重试。');
      }
      return el;
    }

    function findSendButton(): HTMLElement | null {
      for (const s of SEND_SELECTORS) {
        const el = document.querySelector(s);
        if (el instanceof HTMLElement && !(el as HTMLButtonElement).disabled) return el;
      }
      // 输入框附近的可点按钮(常见纸飞机/箭头)
      const input = findInput();
      const root = input?.closest('form') || input?.parentElement?.parentElement || document.body;
      const buttons = Array.from(root.querySelectorAll('button, div[role="button"]')) as HTMLElement[];
      const byLabel = buttons.find((b) => {
        const t = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`;
        return /发送|Send|提交/i.test(t) && !(b as HTMLButtonElement).disabled;
      });
      if (byLabel) return byLabel;
      // 最后一个未禁用按钮往往是发送
      const enabled = buttons.filter((b) => !(b as HTMLButtonElement).disabled && b.offsetParent !== null);
      return enabled[enabled.length - 1] || null;
    }

    async function submitMessage(el: HTMLTextAreaElement) {
      const before = el.value;
      const btn = findSendButton();
      if (btn) {
        btn.click();
        await sleep(400);
        // 发送成功时输入框通常会清空
        if (!findInput()?.value.trim() || findInput()!.value !== before) return;
      }

      // Enter 回退(带完整键盘属性)
      const opts: KeyboardEventInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
      };
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', opts));
      el.dispatchEvent(new KeyboardEvent('keypress', opts));
      el.dispatchEvent(new KeyboardEvent('keyup', opts));
      await sleep(400);

      // 仍未清空则再点一次发送
      const again = findSendButton();
      again?.click();
      await sleep(300);
    }

    function isOnConversationPage(): boolean {
      return /\/a\/chat\/s\//i.test(location.pathname);
    }

    /** 当前是否像空白新对话(无历史回复气泡) */
    function looksLikeEmptyChat(): boolean {
      if (isOnConversationPage()) return false;
      return getAssistantTexts().length === 0;
    }

    function normalizeLabel(el: Element): string {
      return `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`
        .replace(/\s+/g, ' ')
        .trim();
    }

    function isVisible(el: HTMLElement): boolean {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    /**
     * DeepSeek 当前按钮文案是「开启新对话」。
     * 优先精确匹配最小的可点击节点，避免宽泛的「新对话」命中侧栏容器。
     */
    function clickNewChat() {
      for (const s of NEW_CHAT_SELECTORS) {
        const el = document.querySelector(s);
        if (el instanceof HTMLElement && isVisible(el)) {
          el.click();
          return true;
        }
      }

      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('button, a, [role="button"], [tabindex="0"]'),
      )
        .filter(isVisible)
        .map((el) => ({ el, label: normalizeLabel(el) }))
        .filter(({ label }) =>
          /^(?:开启新对话|新对话|New chat)(?:\s|⌘|Ctrl|Command|$)/i.test(label),
        )
        .sort((a, b) => a.label.length - b.label.length);

      const hit = candidates[0]?.el;
      if (hit) {
        hit.scrollIntoView({ block: 'center', inline: 'center' });
        hit.click();
        return true;
      }
      return false;
    }

    /** 确保在新会话;失败直接抛错,禁止静默发到旧会话 */
    async function ensureNewChat(post: (msg: unknown) => void) {
      if (looksLikeEmptyChat()) return;

      post({ type: 'progress', message: '正在开启新对话…' });
      let clicked = clickNewChat();
      await sleep(1000);

      if (looksLikeEmptyChat()) return;

      // 首次点击可能被侧栏动画吞掉，再按准确文案重试一次。
      clicked = clickNewChat() || clicked;
      if (clicked) {
        await sleep(1000);
      }

      if (!looksLikeEmptyChat()) {
        throw new Error(
          '未能点击 DeepSeek 左侧的「开启新对话」，已停止发送，避免消息落到旧会话。请刷新 DeepSeek 页面后重试。',
        );
      }
    }

    function findFileInput(): HTMLInputElement | null {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
      return (
        inputs.find((i) => !i.disabled && (i.accept === '' || /pdf|text|md|\*/i.test(i.accept))) ??
        inputs[0] ??
        null
      );
    }

    function clickAttachButton() {
      const labeled = document.querySelector(
        'button[aria-label*="Upload"], button[aria-label*="上传"], button[aria-label*="Attach"], button[aria-label*="附件"], button[aria-label*="file" i]',
      );
      if (labeled instanceof HTMLElement) {
        labeled.click();
        return true;
      }
      const hit = Array.from(document.querySelectorAll('button')).find((b) =>
        /上传|附件|Attach|Upload|文件/i.test(b.getAttribute('aria-label') || b.textContent || ''),
      );
      if (hit instanceof HTMLElement) {
        hit.click();
        return true;
      }
      return false;
    }

    /** 等文件出现且不再「解析中/上传中」;若出现解析失败立即抛错 */
    async function waitFileParsed(fileName: string, post: (msg: unknown) => void) {
      const hint = fileName.replace(/\.[a-z0-9]+$/i, '').slice(0, 18);
      const start = Date.now();
      let sawChip = false;
      post({ type: 'progress', message: '等待 DeepSeek 解析附件…' });

      while (Date.now() - start < 120_000) {
        if (cancelled) throw new DOMException('Aborted', 'AbortError');
        throwIfPageError();

        const body = document.body?.innerText || '';
        if (body.includes(fileName) || (hint.length >= 6 && body.includes(hint))) {
          sawChip = true;
        }
        // 常见附件 chip
        if (document.querySelector('[class*="file"], [class*="attach"], [class*="upload"]')) {
          sawChip = true;
        }

        const stillBusy = BUSY_HINT.test(body);
        if (sawChip && !stillBusy) {
          // 再确认稳定 1.2s
          await sleep(1200);
          throwIfPageError();
          if (!BUSY_HINT.test(document.body?.innerText || '')) {
            post({ type: 'progress', message: '附件已就绪,准备发送…' });
            return;
          }
        }
        await sleep(400);
      }

      if (!sawChip) {
        throw new Error(
          '未检测到附件已挂到 DeepSeek。页面附件控件可能改版,请刷新后重试,或改用侧栏「上传 PDF」。',
        );
      }
      throw new Error('等待 DeepSeek 解析附件超时(2 分钟)。请到网页查看附件是否仍在转圈。');
    }

    /** PDF 有魔数可校验;文本类附件(dsh 上下文走 .md)只能校验非空与长度一致。 */
    function isPdfAttachment(meta: { name: string; mime: string }): boolean {
      return /pdf/i.test(meta.mime) || /\.pdf$/i.test(meta.name);
    }

    async function attachFile(
      fileMeta: { name: string; mime: string; dataBase64: string; byteLength: number },
      post: (msg: unknown) => void,
    ) {
      const isPdf = isPdfAttachment(fileMeta);
      // PDF 有 1KB 下限;.md 上下文可能只有几百字节,只要求非空。
      const minBytes = isPdf ? 1024 : 1;
      if (!fileMeta.dataBase64 || fileMeta.byteLength < minBytes) {
        throw new Error(`收到的附件数据异常(${fileMeta.byteLength || 0}B)。传输失败,请重试。`);
      }
      const binary = atob(fileMeta.dataBase64);
      // 魔数校验只对 PDF 有意义,但必须保留:它拦的是 "[object Object]" 那类 15B 假文件。
      if (isPdf && (binary.length < 1024 || binary.slice(0, 5) !== '%PDF-')) {
        throw new Error(`PDF 解码后无效(大小=${binary.length},头=${JSON.stringify(binary.slice(0, 8))})。`);
      }
      if (binary.length < minBytes) {
        throw new Error(`附件解码后为空(声明 ${fileMeta.byteLength}B)。`);
      }
      if (Math.abs(binary.length - fileMeta.byteLength) > 16) {
        throw new Error(`附件大小不一致:声明 ${fileMeta.byteLength}B,解码 ${binary.length}B。`);
      }
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const file = new File([bytes], fileMeta.name, {
        type: fileMeta.mime || (isPdf ? 'application/pdf' : 'text/markdown'),
      });
      if (file.size < minBytes) {
        throw new Error(`挂载前 File.size=${file.size}B,异常。`);
      }

      post({ type: 'progress', message: `正在挂载附件(${(file.size / 1024).toFixed(0)}KB)…` });

      let input = findFileInput();
      if (!input) {
        clickAttachButton();
        await sleep(400);
        input = findFileInput();
      }
      if (!input) {
        clickAttachButton();
        await sleep(600);
        input = findFileInput();
      }
      if (!input) {
        throw new Error(
          '找不到 DeepSeek 的文件上传控件。请确认网页左下角有附件按钮,或手动点一次附件后再试。',
        );
      }

      // 只走 file input,不再额外 drop(避免重复挂两个附件)
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      await waitFileParsed(file.name, post);
    }

    function getAssistantTexts(): string[] {
      const out: string[] = [];
      for (const sel of ASSISTANT_SELECTORS) {
        document.querySelectorAll(sel).forEach((n) => {
          const t = (n as HTMLElement).innerText?.trim();
          if (t) out.push(t);
        });
        if (out.length) break;
      }
      const seen = new Set<string>();
      return out.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
    }

    function latestAssistant(): string {
      const all = getAssistantTexts();
      return all[all.length - 1] ?? '';
    }

    function isGenerating(): boolean {
      if (document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"], button[aria-label*="stop" i]')) {
        return true;
      }
      return Array.from(document.querySelectorAll('button')).some((b) =>
        /停止|Stop generating|停止生成/i.test(b.getAttribute('aria-label') || b.textContent || ''),
      );
    }

    async function waitReply(before: string, beforeCount: number, post: (msg: unknown) => void) {
      post({ type: 'progress', message: '等待 DeepSeek 回复…' });
      const start = Date.now();
      let sawChange = false;
      let last = '';
      let stableTicks = 0;
      let lastBeatAt = Date.now();
      const STABLE_NEED = 5;
      /** 心跳间隔要远小于扩展侧 3 分钟的空闲判死阈值。 */
      const HEARTBEAT_MS = 15_000;

      while (Date.now() - start < 600_000) {
        if (cancelled) throw new DOMException('Aborted', 'AbortError');
        throwIfPageError();
        await sleep(400);

        const cur = latestAssistant();
        const count = getAssistantTexts().length;
        const growing = Boolean(cur && cur !== before && (count > beforeCount || cur.length > before.length + 10));
        if (growing) {
          sawChange = true;
          if (cur !== last) {
            last = cur;
            stableTicks = 0;
            lastBeatAt = Date.now();
            post({ type: 'delta', text: cur });
          } else if (!isGenerating()) {
            stableTicks += 1;
          } else {
            stableTicks = 0;
          }
          if (stableTicks >= STABLE_NEED) {
            post({ type: 'done' });
            return;
          }
        } else if (sawChange && !isGenerating() && last) {
          stableTicks += 1;
          if (stableTicks >= STABLE_NEED) {
            post({ type: 'done' });
            return;
          }
        }

        // 深度思考阶段回复容器还是空的，一个 delta 都发不出来；此时页面确实在生成，
        // 必须定期报活，否则扩展侧会按「3 分钟没有新内容」把还在思考的请求判死。
        // 反过来，页面既没在生成又没有变化时故意不报活，让那条超时如实触发。
        if (!growing && isGenerating() && Date.now() - lastBeatAt >= HEARTBEAT_MS) {
          lastBeatAt = Date.now();
          post({
            type: 'progress',
            message: `DeepSeek 正在思考…已等待 ${Math.round((Date.now() - start) / 1000)} 秒`,
          });
        }
      }
      if (last) {
        post({ type: 'done' });
        return;
      }
      throw new Error('等待 DeepSeek 回复超过 10 分钟。请到网页确认是否卡在思考/联网/风控。');
    }

    async function ask(
      prompt: string,
      newChat: boolean,
      file: { name: string; mime: string; dataBase64: string; byteLength: number } | undefined,
      post: (msg: unknown) => void,
    ) {
      if (busy) throw new Error('上一次网页请求还在进行中,请稍后再试。');
      busy = true;
      cancelled = false;
      try {
        if (!isLoggedIn()) {
          throw new Error('DeepSeek 尚未登录。请在打开的标签页完成登录后重试。');
        }
        throwIfPageError();

        if (newChat) {
          await ensureNewChat(post);
          throwIfPageError();
        }

        if (file?.dataBase64) {
          await attachFile(file, post);
        }

        const before = latestAssistant();
        const beforeCount = getAssistantTexts().length;
        post({ type: 'progress', message: '正在填入提示并发送…' });
        const input = await fillInput(prompt);
        await submitMessage(input);
        await sleep(500);
        throwIfPageError();
        await waitReply(before, beforeCount, post);
      } finally {
        busy = false;
      }
    }

    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'ping') {
        sendResponse(status());
        return true;
      }
      return false;
    });

    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== 'deepseek-web') return;
      port.postMessage({ type: 'ready' });
      port.onMessage.addListener((msg) => {
        const m = msg as {
          type?: string;
          prompt?: string;
          newChat?: boolean;
          file?: { name: string; mime: string; dataBase64: string; byteLength: number };
        };
        if (m.type === 'cancel') {
          cancelled = true;
          return;
        }
        if (m.type !== 'ask' || !m.prompt) return;
        void ask(m.prompt, Boolean(m.newChat), m.file, (out) => {
          try {
            port.postMessage(out);
          } catch {
            /* ignore */
          }
        }).catch((e: unknown) => {
          const err = e as Error;
          try {
            port.postMessage({
              type: 'error',
              message: err?.name === 'AbortError' ? '已停止' : err?.message || String(e),
            });
          } catch {
            /* ignore */
          }
        });
      });
    });
  },
});
