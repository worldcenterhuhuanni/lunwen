import { beforeEach, describe, expect, it, vi } from 'vitest';

// 用一个内存 Map 顶掉 WXT 的 session 存储，只验证「读完即删」这条约定。
const backing = new Map<string, unknown>();

vi.mock('#imports', () => ({
  storage: {
    defineItem: (key: string) => ({
      getValue: async () => backing.get(key) ?? null,
      setValue: async (value: unknown) => {
        backing.set(key, value);
      },
      removeValue: async () => {
        backing.delete(key);
      },
      watch: () => () => {},
    }),
  },
}));

const { pendingCaptureItem, takePendingCapture } = await import('./capture');

describe('划词待解读文字', () => {
  beforeEach(() => backing.clear());

  it('消费一次后即清除，再次读取为空', async () => {
    await pendingCaptureItem.setValue({
      text: '选中的一段话',
      source: 'https://example.com/a',
      title: '示例页面',
      at: 1,
    });

    const first = await takePendingCapture();
    expect(first?.text).toBe('选中的一段话');
    expect(await takePendingCapture()).toBeNull();
  });

  it('没有待解读文字时返回空且不报错', async () => {
    expect(await takePendingCapture()).toBeNull();
  });
});
