import { describe, expect, it } from 'vitest';
import { stripAttachment } from './types';
import type { Material } from '../material/types';

const paper: Material = {
  mode: 'paper',
  kind: 'pdf',
  title: '一篇论文',
  text: '正文',
  source: 'https://example.com/a.pdf',
  pdf: { name: 'a.pdf', mime: 'application/pdf', data: new ArrayBuffer(2048) },
};

describe('stripAttachment', () => {
  it('丢掉附件字节但保留文件名，历史记录才不会撑爆存储', () => {
    const stored = stripAttachment(paper);
    expect(stored.pdf).toEqual({ name: 'a.pdf', mime: 'application/pdf', byteLength: 2048 });
    expect((stored.pdf as unknown as { data?: unknown }).data).toBeUndefined();
    expect(stored.title).toBe('一篇论文');
    expect(stored.text).toBe('正文');
  });

  it('没有附件的材料原样保留', () => {
    const { pdf: _pdf, ...html } = paper;
    const stored = stripAttachment({ ...html, kind: 'html' });
    expect(stored.pdf).toBeUndefined();
    expect(stored.kind).toBe('html');
  });
});
