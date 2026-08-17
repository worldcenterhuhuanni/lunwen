import { beforeEach, describe, expect, it, vi } from 'vitest';

const getWorkspace = vi.fn();
const saveWorkspace = vi.fn();

vi.mock('../../workspace/store', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspace(...args),
  saveWorkspace: (...args: unknown[]) => saveWorkspace(...args),
}));

const { importGitHubRepository } = await import('./client');

const limits = {
  maxFiles: 5000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxArchiveBytes: 80 * 1024 * 1024,
  ignorePatterns: [],
};

const stats = {
  indexedFiles: 12,
  indexedBytes: 2048,
  excludedFiles: 1,
  excludedBytes: 64,
  languages: { ts: 12 },
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('importGitHubRepository 索引复用', () => {
  beforeEach(() => {
    getWorkspace.mockReset();
    saveWorkspace.mockReset();
  });

  it('同一提交已索引时直接复用，不再下载源码', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/owner/repo')) {
        return jsonResponse({
          full_name: 'owner/repo',
          default_branch: 'main',
          html_url: 'https://github.com/owner/repo',
          size: 100,
          private: false,
        });
      }
      if (url.includes('/commits/')) return jsonResponse({ sha: 'abc123' });
      throw new Error(`不该发出的请求: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    getWorkspace.mockResolvedValue({
      id: 'github:owner/repo:abc123',
      mode: 'github',
      title: 'owner/repo',
      source: 'https://github.com/owner/repo',
      version: 'abc123',
      createdAt: 1,
      stats,
      writable: false,
    });

    const material = await importGitHubRepository('https://github.com/owner/repo', limits);

    expect(material.workspaceId).toBe('github:owner/repo:abc123');
    expect(material.stats).toEqual(stats);
    expect(saveWorkspace).not.toHaveBeenCalled();
    // 只允许查仓库信息和最新提交这两次 API 调用，不得触发归档下载。
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('codeload'))).toBe(true);
  });
});
