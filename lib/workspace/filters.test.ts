import { describe, expect, it } from 'vitest';
import {
  containsLikelySecret,
  normalizeWorkspacePath,
  pathExclusionReason,
} from './filters';

describe('workspace filters', () => {
  it('normalizes safe relative paths', () => {
    expect(normalizeWorkspacePath('./src\\main.ts')).toBe('src/main.ts');
  });

  it('rejects path escape and repository metadata', () => {
    expect(() => normalizeWorkspacePath('../secret')).toThrow('非法工作区路径');
    expect(pathExclusionReason('.git/config')).toBe('默认忽略目录');
    expect(pathExclusionReason('node_modules/pkg/index.js')).toBe('默认忽略目录');
    expect(pathExclusionReason('fixtures/large/data.ts', ['fixtures/**'])).toBe('用户忽略规则');
  });

  it('blocks sensitive paths and recognizable credentials', () => {
    expect(pathExclusionReason('.env.production')).toBe('敏感文件');
    expect(pathExclusionReason('cert/private.pem')).toBe('敏感文件');
    expect(containsLikelySecret('token=ghp_abcdefghijklmnopqrstuvwxyz1234567890')).toBe(true);
  });
});
