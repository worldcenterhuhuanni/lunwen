import { Agent } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../deepseek-web', () => ({
  streamDeepSeekWeb: vi.fn(),
}));

import { streamDeepSeekWeb } from '../deepseek-web';
import { createDeepSeekWebStream } from './web-transport';

const model: Model<string> = {
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
};

describe('DeepSeek web Agent event bridge', () => {
  beforeEach(() => vi.mocked(streamDeepSeekWeb).mockReset());

  it('forwards a final JSON answer as text_delta', async () => {
    vi.mocked(streamDeepSeekWeb).mockImplementation(async function* () {
      yield '{"action":"final","answer":"项目分析完成"}';
    });
    const agent = new Agent({
      initialState: {
        systemPrompt: 'test',
        model,
        tools: [],
        messages: [],
      },
      streamFn: createDeepSeekWebStream({ autoFocus: false }),
    });
    let answer = '';
    agent.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        answer += event.assistantMessageEvent.delta;
      }
    });

    await agent.prompt('分析项目');

    expect(answer).toBe('项目分析完成');
  });
});
