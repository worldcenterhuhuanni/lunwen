// 统一 LLM 客户端:
// - API provider → OpenAI 兼容 /chat/completions + SSE
// - deepseek-web → 已登录网页 DOM 桥接(可附带 PDF 文件)
import type { AppConfig } from './config';
import { isWebBridgeProvider } from './config';
import type { PdfAttachment } from './extract';
import { messagesToWebPrompt, streamDeepSeekWeb } from './deepseek-web';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChatOptions {
  signal?: AbortSignal;
  /** PDF 线 · 网页模式:上传附件 */
  file?: PdfAttachment;
  onProgress?: (message: string) => void;
  /** 网页模式:是否新开 DeepSeek 会话 */
  newChat?: boolean;
}

// baseURL 可能带/不带末尾斜杠(如 Gemini 带、OpenAI 不带),统一拼接。
export function joinURL(baseURL: string, path: string): string {
  return baseURL.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

// 解析单行 SSE,返回增量文本;非内容行(空行、注释、[DONE]、解析失败)返回 null。
export function parseSSELine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const data = trimmed.slice(5).trim();
  if (data === '[DONE]') return null;
  try {
    const json = JSON.parse(data);
    return json.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

// 把任意分块的字符串流(SSE)解析为增量文本流,处理跨 chunk 的半行。
export async function* parseSSEStream(
  chunks: AsyncIterable<string>,
): AsyncGenerator<string> {
  let buf = '';
  for await (const chunk of chunks) {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      const delta = parseSSELine(line);
      if (delta) yield delta;
    }
  }
  const delta = parseSSELine(buf);
  if (delta) yield delta;
}

// 把 fetch 响应体(字节流)转成字符串块流。
async function* readBytesAsText(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

// 流式对话:逐段 yield 模型输出的文本增量。
export async function* streamChat(
  cfg: AppConfig,
  messages: ChatMessage[],
  opts?: StreamChatOptions | AbortSignal,
): AsyncGenerator<string> {
  // 兼容旧签名 streamChat(cfg, messages, signal)
  const options: StreamChatOptions =
    opts && typeof opts === 'object' && 'aborted' in opts ? { signal: opts as AbortSignal } : (opts as StreamChatOptions) || {};

  if (isWebBridgeProvider(cfg.provider)) {
    // PDF 附件也必须携带模板 system 指令，否则自定义角色、证据纪律会被静默丢弃。
    const prompt = messagesToWebPrompt(messages);
    const newChat = options.newChat ?? cfg.webSessionMode !== 'multi';
    yield* streamDeepSeekWeb(prompt, {
      newChat,
      signal: options.signal,
      file: newChat ? options.file : undefined,
      onProgress: options.onProgress,
      autoFocus: cfg.autoFocusDeepSeek !== false,
    });
    return;
  }

  if (!cfg.baseURL) throw new Error('未配置 baseURL,请先到设置里选择模型服务。');
  if (!cfg.apiKey) throw new Error('未配置 API Key,请先到设置里填写。');

  const res = await fetch(joinURL(cfg.baseURL, 'chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, messages, stream: true }),
    signal: options.signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`模型请求失败 (${res.status}): ${errText.slice(0, 300)}`);
  }

  yield* parseSSEStream(readBytesAsText(res.body));
}
