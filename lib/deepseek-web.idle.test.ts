import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 模拟一个已登录、已就绪的 DeepSeek 标签页，只保留 Port 通信这一段行为。
const portListeners: Array<(message: unknown) => void> = [];
const disconnectListeners: Array<() => void> = [];

const port = {
  postMessage: vi.fn(),
  disconnect: vi.fn(),
  onMessage: {
    addListener: (fn: (message: unknown) => void) => portListeners.push(fn),
    removeListener: (fn: (message: unknown) => void) => {
      const index = portListeners.indexOf(fn);
      if (index >= 0) portListeners.splice(index, 1);
    },
  },
  onDisconnect: {
    addListener: (fn: () => void) => disconnectListeners.push(fn),
    removeListener: (fn: () => void) => {
      const index = disconnectListeners.indexOf(fn);
      if (index >= 0) disconnectListeners.splice(index, 1);
    },
  },
};

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: {
      query: async () => [{ id: 1, active: true, discarded: false, url: 'https://chat.deepseek.com/' }],
      get: async () => ({ id: 1, status: 'complete', url: 'https://chat.deepseek.com/' }),
      update: async () => ({}),
      reload: async () => ({}),
      create: async () => ({ id: 1 }),
      sendMessage: async () => ({ type: 'status', loggedIn: true, hasInput: true }),
      connect: () => port,
    },
    scripting: { executeScript: async () => [] },
  },
}));

const { streamDeepSeekWeb } = await import('./deepseek-web');

/** 起一个消费者，把产出的增量和最终错误收集起来。 */
function startStream() {
  const deltas: string[] = [];
  const state: { failed: Error | null } = { failed: null };
  const done = (async () => {
    try {
      for await (const delta of streamDeepSeekWeb('分析这个项目', { newChat: false })) {
        deltas.push(delta);
      }
    } catch (error) {
      state.failed = error as Error;
    }
  })();
  return { deltas, state, done };
}

const emit = (message: unknown) => portListeners.forEach((fn) => fn(message));

describe('网页桥接的空闲判定', () => {
  beforeEach(() => {
    portListeners.length = 0;
    disconnectListeners.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('页面在思考期间持续报活时，不会被判成没有新内容', async () => {
    const { deltas, state, done } = startStream();
    await vi.advanceTimersByTimeAsync(2_000);

    // 4 分钟只有心跳、没有任何正文，已经超过 3 分钟的空闲阈值。
    for (let i = 0; i < 16; i += 1) {
      await vi.advanceTimersByTimeAsync(15_000);
      emit({ type: 'progress', message: `DeepSeek 正在思考…已等待 ${(i + 1) * 15} 秒` });
    }

    emit({ type: 'delta', text: '最终答案' });
    emit({ type: 'done' });
    await vi.advanceTimersByTimeAsync(1_000);
    await done;

    expect(state.failed).toBeNull();
    expect(deltas.join('')).toBe('最终答案');
  });

  it('页面完全没有动静超过 3 分钟则如实报错', async () => {
    const { state, done } = startStream();
    await vi.advanceTimersByTimeAsync(2_000);

    await vi.advanceTimersByTimeAsync(200_000);
    await done;

    expect(state.failed?.message).toContain('没有任何动静');
  });
});
