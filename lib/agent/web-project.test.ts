import { describe, expect, it } from 'vitest';
import { parseMarkdownEnvelope } from './web-project';

describe('web project Markdown envelope', () => {
  it('extracts fenced Markdown without exposing the transport wrapper', () => {
    expect(parseMarkdownEnvelope('````markdown\n# 分析\n\n`src/index.ts`\n````')).toBe(
      '# 分析\n\n`src/index.ts`',
    );
  });

  it('keeps an unfenced answer as a compatibility fallback', () => {
    expect(parseMarkdownEnvelope('# 分析\n\n完成')).toBe('# 分析\n\n完成');
  });
});
