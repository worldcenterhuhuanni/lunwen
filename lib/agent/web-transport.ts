import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  ToolCall,
} from '@earendil-works/pi-ai';
import { streamDeepSeekWeb } from '../deepseek-web';

type WebAction =
  | { action: 'list_files'; pathPrefix?: string }
  | { action: 'search_text'; query: string }
  | { action: 'read_file'; path: string; startLine?: number; endLine?: number }
  | { action: 'propose_patch'; path: string; content: string }
  | { action: 'final'; answer: string };

const PROTOCOL = `你可以使用项目工具，但网页没有原生 function calling。你的每次回复必须且只能在一个 \`\`\`json 代码围栏中放一个 JSON 对象，不要围栏外解释。代码围栏用于防止网页 Markdown 渲染破坏 JSON 转义：
{"action":"list_files","pathPrefix":"可选目录前缀"}
{"action":"search_text","query":"要搜索的文本"}
{"action":"read_file","path":"相对路径","startLine":1,"endLine":200}
{"action":"propose_patch","path":"相对路径","content":"完整候选文件内容"}
{"action":"final","answer":"最终 Markdown 回答"}
先检索证据再 final。每轮只选一个 action。`;

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

class BrowserAssistantStream implements AsyncIterable<AssistantMessageEvent> {
  private queue: AssistantMessageEvent[] = [];
  private waiters: Array<() => void> = [];
  private completed = false;
  private final?: AssistantMessage;
  private readonly finalPromise: Promise<AssistantMessage>;
  private resolveFinal!: (message: AssistantMessage) => void;

  constructor() {
    this.finalPromise = new Promise((resolve) => {
      this.resolveFinal = resolve;
    });
  }

  push(event: AssistantMessageEvent) {
    this.queue.push(event);
    if (event.type === 'done') {
      this.completed = true;
      this.final = event.message;
      this.resolveFinal(event.message);
    } else if (event.type === 'error') {
      this.completed = true;
      this.final = event.error;
      this.resolveFinal(event.error);
    }
    this.waiters.splice(0).forEach((wake) => wake());
  }

  result(): Promise<AssistantMessage> {
    return this.final ? Promise.resolve(this.final) : this.finalPromise;
  }

  [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    return {
      next: async () => {
        while (!this.queue.length && !this.completed) {
          await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
        const value = this.queue.shift();
        return value ? { value, done: false } : { value: undefined, done: true };
      },
    };
  }
}

function createBrowserAssistantStream(): AssistantMessageEventStream {
  return new BrowserAssistantStream() as unknown as AssistantMessageEventStream;
}

function baseMessage(model: Model<string>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: ZERO_USAGE,
    stopReason: 'pending',
    timestamp: Date.now(),
  };
}

function messageText(message: Context['messages'][number]): string {
  if (message.role === 'user') {
    return typeof message.content === 'string'
      ? message.content
      : message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  }
  if (message.role === 'toolResult') {
    return `工具 ${message.toolName} 返回：\n${message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')}`;
  }
  return message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n');
}

export function parseWebAction(raw: string): WebAction {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('DeepSeek 没有返回 JSON action。');
  const value = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const action = String(value.action || '');
  if (action === 'final' && typeof value.answer === 'string') {
    return { action, answer: value.answer };
  }
  if (action === 'list_files') {
    return { action, pathPrefix: typeof value.pathPrefix === 'string' ? value.pathPrefix : undefined };
  }
  if (action === 'search_text' && typeof value.query === 'string') {
    return { action, query: value.query };
  }
  if (action === 'read_file' && typeof value.path === 'string') {
    return {
      action,
      path: value.path,
      startLine: typeof value.startLine === 'number' ? value.startLine : undefined,
      endLine: typeof value.endLine === 'number' ? value.endLine : undefined,
    };
  }
  if (action === 'propose_patch' && typeof value.path === 'string' && typeof value.content === 'string') {
    return { action, path: value.path, content: value.content };
  }
  throw new Error(`DeepSeek 返回了不支持的 action：${action || '空'}`);
}

export function createDeepSeekWebStream(
  options: {
    autoFocus: boolean;
    onProgress?: (message: string) => void;
  },
): StreamFunction<string, SimpleStreamOptions> {
  let firstTurn = true;
  return (model, context, streamOptions) => {
    const stream = createBrowserAssistantStream();
    void (async () => {
      const initial = baseMessage(model);
      stream.push({ type: 'start', partial: initial });
      try {
        const last = context.messages[context.messages.length - 1];
        let prompt = firstTurn
          ? `${context.systemPrompt || ''}\n\n${last ? messageText(last) : ''}\n\n${PROTOCOL}`
          : `${last ? messageText(last) : '请继续。'}\n\n${PROTOCOL}`;
        let action: WebAction | null = null;
        let parseError: Error | null = null;
        for (let attempt = 0; attempt < 2 && !action; attempt += 1) {
          let raw = '';
          for await (const delta of streamDeepSeekWeb(prompt, {
            newChat: firstTurn,
            signal: streamOptions?.signal,
            autoFocus: options.autoFocus,
            onProgress: options.onProgress,
          })) raw += delta;
          firstTurn = false;
          try {
            action = parseWebAction(raw);
          } catch (error) {
            parseError = error as Error;
            prompt = `上一条回复无法作为工具 action 解析：${parseError.message}\n请严格按协议只返回一个 JSON 对象。\n\n${PROTOCOL}`;
          }
        }
        if (!action) throw parseError ?? new Error('DeepSeek 工具 action 解析失败。');
        if (action.action === 'final') {
          const message: AssistantMessage = {
            ...initial,
            content: [{ type: 'text', text: action.answer }],
            stopReason: 'stop',
          };
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: action.answer, partial: message });
          stream.push({ type: 'text_end', contentIndex: 0, content: action.answer, partial: message });
          stream.push({ type: 'done', reason: 'stop', message });
          return;
        }
        const { action: name, ...argumentsValue } = action;
        const toolCall: ToolCall = {
          type: 'toolCall',
          id: crypto.randomUUID(),
          name,
          arguments: argumentsValue,
        };
        const message: AssistantMessage = {
          ...initial,
          content: [toolCall],
          stopReason: 'toolUse',
        };
        stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
        stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
        stream.push({ type: 'done', reason: 'toolUse', message });
      } catch (error) {
        const aborted = (error as Error).name === 'AbortError';
        const failed: AssistantMessage = {
          ...initial,
          stopReason: aborted ? 'aborted' : 'error',
          errorMessage: (error as Error).message,
        };
        stream.push({ type: 'error', reason: aborted ? 'aborted' : 'error', error: failed });
      }
    })();
    return stream;
  };
}
