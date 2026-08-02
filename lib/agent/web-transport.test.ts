import { describe, expect, it } from 'vitest';
import { parseWebAction } from './web-transport';

describe('DeepSeek web action protocol', () => {
  it('parses tool calls and final answers', () => {
    expect(parseWebAction('```json\n{"action":"search_text","query":"createApp"}\n```')).toEqual({
      action: 'search_text',
      query: 'createApp',
    });
    expect(parseWebAction('{"action":"final","answer":"完成"}')).toEqual({
      action: 'final',
      answer: '完成',
    });
  });

  it('rejects unsupported or incomplete actions', () => {
    expect(() => parseWebAction('{"action":"shell","command":"rm -rf /"}')).toThrow('不支持');
    expect(() => parseWebAction('not json')).toThrow('没有返回 JSON');
  });
});
