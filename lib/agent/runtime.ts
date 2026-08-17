import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import { streamSimple as streamOpenAICompatible } from '@earendil-works/pi-ai/api/openai-completions';
import { Type } from 'typebox';
import type { AppConfig } from '../config';
import { isWebBridgeProvider } from '../config';
import { createCandidatePatch, type CandidatePatch } from '../patch/local-patch';
import { normalizeWorkspacePath } from '../workspace/filters';
import {
  getWorkspace,
  listWorkspaceFiles,
  readWorkspaceFile,
  searchWorkspace,
} from '../workspace/store';
import { createDeepSeekWebStream } from './web-transport';

export interface ProjectAgentCallbacks {
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onFinal?: (text: string) => void;
  onTool?: (event: {
    /** 用工具调用自身的 id 配对起止事件；并行执行时按工具名配对会错位。 */
    id: string;
    name: string;
    status: 'running' | 'done' | 'error';
    args?: unknown;
    result?: unknown;
  }) => void;
  onPatch?: (patch: CandidatePatch) => void;
  onProgress?: (message: string) => void;
  onContext?: (summary: { includedFiles: number; totalFiles: number; chars: number }) => void;
}

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: 'text' as const, text }], details };
}

function createWorkspaceTools(
  workspaceId: string,
  callbacks: ProjectAgentCallbacks,
): AgentTool[] {
  const listFiles: AgentTool = {
    name: 'list_files',
    label: '列出文件',
    description: '列出当前项目索引中的相对文件路径，可按目录前缀过滤。',
    parameters: Type.Object({
      pathPrefix: Type.Optional(Type.String()),
    }),
    execute: async (_id, rawParams) => {
      const params = rawParams as { pathPrefix?: string };
      const prefix = params.pathPrefix ? normalizeWorkspacePath(params.pathPrefix) : '';
      const files = (await listWorkspaceFiles(workspaceId))
        .filter((file) => !prefix || file.path.startsWith(prefix))
        .slice(0, 500);
      return textResult(files.map((file) => `${file.path}\t${file.language}\t${file.size}B`).join('\n'), {
        count: files.length,
      });
    },
  };

  const searchText: AgentTool = {
    name: 'search_text',
    label: '搜索源码',
    description: '在当前项目全部已索引文本中搜索普通文本，返回路径、行号和匹配行。',
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 200 }),
    }),
    execute: async (_id, rawParams) => {
      const params = rawParams as { query: string };
      const matches = await searchWorkspace(workspaceId, params.query, 50, callbacks.signal);
      return textResult(
        matches.length
          ? matches.map((match) => `${match.path}:${match.line}: ${match.text}`).join('\n')
          : '没有匹配结果。',
        { count: matches.length },
      );
    },
  };

  const readFile: AgentTool = {
    name: 'read_file',
    label: '读取文件',
    description: '读取当前项目中一个已索引文本文件的指定行区间；一次最多 400 行。',
    parameters: Type.Object({
      path: Type.String(),
      startLine: Type.Optional(Type.Integer({ minimum: 1 })),
      endLine: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    execute: async (_id, rawParams) => {
      const params = rawParams as { path: string; startLine?: number; endLine?: number };
      const path = normalizeWorkspacePath(params.path);
      const file = await readWorkspaceFile(workspaceId, path);
      if (!file) throw new Error(`文件不存在或未被索引：${path}`);
      const lines = file.content.split(/\r?\n/);
      const start = Math.max(1, params.startLine ?? 1);
      const end = Math.min(lines.length, params.endLine ?? start + 199, start + 399);
      const content = lines
        .slice(start - 1, end)
        .map((line, index) => `${start + index}|${line}`)
        .join('\n');
      return textResult(content, { path, startLine: start, endLine: end, totalLines: lines.length });
    },
  };

  const proposePatch: AgentTool = {
    name: 'propose_patch',
    label: '生成候选修改',
    description: '为本地可写工作区的一个现有文件生成完整候选内容和 diff；不会直接写盘。',
    executionMode: 'sequential',
    parameters: Type.Object({
      path: Type.String(),
      content: Type.String(),
    }),
    execute: async (_id, rawParams) => {
      const params = rawParams as { path: string; content: string };
      const patch = await createCandidatePatch(workspaceId, params.path, params.content);
      callbacks.onPatch?.(patch);
      return textResult(
        `已生成 ${patch.path} 的候选 diff，等待用户在界面确认。不要声称文件已经写入。`,
        { patchId: patch.id, path: patch.path },
      );
    },
  };
  return [listFiles, searchText, readFile, proposePatch];
}

function apiModel(cfg: AppConfig): Model<'openai-completions'> {
  return {
    id: cfg.model,
    name: cfg.model,
    api: 'openai-completions',
    provider: cfg.provider,
    baseUrl: cfg.baseURL,
    reasoning: /reason|thinking/i.test(cfg.model),
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    compat: {
      supportsUsageInStreaming: false,
      supportsDeveloperRole: false,
    },
  };
}

export async function runProjectAgent(
  cfg: AppConfig,
  workspaceId: string,
  systemPrompt: string,
  prompt: string,
  callbacks: ProjectAgentCallbacks = {},
): Promise<string> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new Error('项目索引已失效，请重新导入。');
  const web = isWebBridgeProvider(cfg.provider);
  if (!web && (!cfg.baseURL || !cfg.apiKey || !cfg.model)) {
    throw new Error('项目分析需要完整的 API 地址、API Key 和模型名称。');
  }
  const model = web
    ? ({
        id: 'deepseek-web',
        name: 'DeepSeek Web',
        api: 'deepseek-web-json',
        provider: 'deepseek-web',
        baseUrl: '',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 64_000,
        maxTokens: 8_192,
      } satisfies Model<string>)
    : apiModel(cfg);
  const streamFn = web
    ? createDeepSeekWebStream({
        autoFocus: cfg.autoFocusDeepSeek !== false,
        onProgress: callbacks.onProgress,
      })
    : (selectedModel: Model<string>, context: Parameters<typeof streamOpenAICompatible>[1], options?: Parameters<typeof streamOpenAICompatible>[2]) =>
        streamOpenAICompatible(
          selectedModel as Model<'openai-completions'>,
          context,
          { ...options, apiKey: cfg.apiKey },
        );

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools: createWorkspaceTools(workspaceId, callbacks),
      messages: [],
    },
    streamFn,
    toolExecution: 'parallel',
  });

  let answer = '';
  let agentError = '';
  let turns = 0;
  const abort = () => agent.abort();
  callbacks.signal?.addEventListener('abort', abort, { once: true });
  agent.subscribe((event) => {
    if (event.type === 'turn_start') {
      turns += 1;
      if (turns > 20) agent.abort();
    } else if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      const delta = event.assistantMessageEvent.delta;
      answer += delta;
      callbacks.onText?.(delta);
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      if (event.message.stopReason === 'error') {
        agentError = event.message.errorMessage || '模型请求失败。';
        return;
      }
      if (event.message.stopReason !== 'stop') return;
      const finalText = event.message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
      if (!finalText) return;
      const hadStreamedText = Boolean(answer);
      answer = finalText;
      callbacks.onFinal?.(finalText);
      if (!hadStreamedText && !callbacks.onFinal) callbacks.onText?.(finalText);
    } else if (event.type === 'tool_execution_start') {
      callbacks.onTool?.({
        id: event.toolCallId,
        name: event.toolName,
        status: 'running',
        args: event.args,
      });
    } else if (event.type === 'tool_execution_end') {
      callbacks.onTool?.({
        id: event.toolCallId,
        name: event.toolName,
        status: event.isError ? 'error' : 'done',
        result: event.result,
      });
    }
  });
  try {
    await agent.prompt(prompt);
    if (callbacks.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (turns > 20) throw new Error('项目分析超过 20 个工具步骤，已停止以避免失控循环。');
    if (agentError) throw new Error(agentError);
    if (!answer.trim()) throw new Error('模型没有生成最终回答。');
    return answer;
  } catch (error) {
    if (turns > 20) throw new Error('项目分析超过 20 个工具步骤，已停止以避免失控循环。');
    throw error;
  } finally {
    callbacks.signal?.removeEventListener('abort', abort);
  }
}
