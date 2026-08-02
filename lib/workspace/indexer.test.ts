import { describe, expect, it } from 'vitest';
import { buildWorkspace } from './indexer';

const limits = {
  maxFiles: 10,
  maxFileBytes: 1024,
  maxTotalBytes: 4096,
  maxArchiveBytes: 4096,
  ignorePatterns: [],
};

describe('buildWorkspace', () => {
  it('indexes text and records exclusions', async () => {
    const result = await buildWorkspace([
      { path: 'src/main.ts', content: 'export const answer = 42;' },
      { path: '.env', content: 'SECRET=value' },
      { path: 'logo.png', content: '\0PNG' },
    ], {
      id: 'test',
      mode: 'github',
      title: 'demo',
      source: 'https://github.com/a/b',
      version: 'abc',
      writable: false,
      limits,
    });

    expect(result.files.map((file) => file.path)).toEqual(['src/main.ts']);
    expect(result.workspace.stats.indexedFiles).toBe(1);
    expect(result.workspace.stats.excludedFiles).toBe(2);
  });

  it('fails instead of silently truncating total text', async () => {
    await expect(buildWorkspace([
      { path: 'a.ts', content: 'a'.repeat(900) },
      { path: 'b.ts', content: 'b'.repeat(900) },
    ], {
      id: 'large',
      mode: 'local',
      title: 'large',
      source: 'local:large',
      version: '1',
      writable: false,
      limits: { ...limits, maxTotalBytes: 1000 },
    })).rejects.toThrow('已停止索引');
  });

  it('stops before indexing when the task is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(buildWorkspace([
      { path: 'src/main.ts', content: 'export const answer = 42;' },
    ], {
      id: 'cancelled',
      mode: 'github',
      title: 'cancelled',
      source: 'https://github.com/a/b',
      version: 'abc',
      writable: false,
      limits,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
