import { describe, expect, it } from 'vitest';
import { formatToolArgs, summarizeToolResult } from './tool-summary';

describe('summarizeToolResult', () => {
  it('取出工具结果里的文本片段', () => {
    const result = {
      content: [
        { type: 'text', text: 'src/a.ts' },
        { type: 'text', text: 'src/b.ts' },
      ],
      details: { count: 2 },
    };
    expect(summarizeToolResult(result)).toBe('src/a.ts\nsrc/b.ts');
  });

  it('超长结果截断并标注', () => {
    const long = { content: [{ type: 'text', text: 'x'.repeat(2000) }] };
    const text = summarizeToolResult(long);
    expect(text.endsWith('…（已截断）')).toBe(true);
    expect(text.length).toBeLessThan(2000);
  });

  it('非标准形状退回 JSON，空值给空串', () => {
    expect(summarizeToolResult({ foo: 1 })).toContain('"foo": 1');
    expect(summarizeToolResult(null)).toBe('');
  });
});

describe('formatToolArgs', () => {
  it('对象转可读 JSON，字符串原样返回', () => {
    expect(formatToolArgs({ path: 'src/a.ts' })).toBe('{\n  "path": "src/a.ts"\n}');
    expect(formatToolArgs('query')).toBe('query');
    expect(formatToolArgs(undefined)).toBe('');
  });
});
