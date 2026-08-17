import { describe, expect, it } from 'vitest';
import { resolveFollowupTemplate, resolveTemplate } from './prompt-templates';

const defaults = { pdf: 'builtin:research-review', html: 'builtin:research-review' };
const custom = [
  {
    id: 'custom:plain',
    name: '大白话',
    description: '用日常语言解释',
    scope: 'both' as const,
    systemPrompt: '说人话',
    userPrompt: '{{content}}',
  },
];

describe('resolveFollowupTemplate', () => {
  it('本篇已锁定模板时，追问一律沿用它', () => {
    const locked = resolveTemplate(custom, 'custom:plain', 'html');
    const picked = resolveFollowupTemplate(custom, locked, 'auto', 'html', defaults);
    expect(picked.id).toBe('custom:plain');
  });

  it('恢复的会话没有锁定引用时，用会话记录的模板而不是全局默认', () => {
    const picked = resolveFollowupTemplate(custom, null, 'custom:plain', 'html', defaults);
    expect(picked.id).toBe('custom:plain');
  });

  it('没有锁定也没有显式选择时才回落到按类型的默认模板', () => {
    const picked = resolveFollowupTemplate(custom, null, 'auto', 'pdf', {
      pdf: 'builtin:research-review',
      html: 'builtin:plain-language',
    });
    expect(picked.id).toBe('builtin:research-review');
  });

  it('记录的模板已被删除时回落到内置模板，不抛错', () => {
    const picked = resolveFollowupTemplate([], null, 'custom:deleted', 'html', defaults);
    expect(picked.builtin).toBe(true);
    expect(picked.systemPrompt).toBeTruthy();
  });
});
