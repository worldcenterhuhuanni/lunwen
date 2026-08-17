import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteWorkspace,
  listWorkspaceFiles,
  listWorkspaces,
  saveWorkspace,
  searchWorkspace,
} from './store';
import { saveSession, listSessions } from '../session/store';
import type { WorkspaceBuildResult } from './types';

function makeResult(id: string, paths: string[]): WorkspaceBuildResult {
  return {
    workspace: {
      id,
      mode: 'github',
      title: id,
      source: `https://github.com/${id}`,
      version: 'sha',
      createdAt: 1,
      stats: {
        indexedFiles: paths.length,
        indexedBytes: 100,
        excludedFiles: 0,
        excludedBytes: 0,
        languages: {},
      },
      writable: false,
    },
    files: paths.map((path) => ({
      workspaceId: id,
      path,
      content: `内容 ${path}\n第二行`,
      size: 10,
      language: 'ts',
      fingerprint: `fp-${path}`,
    })),
    excluded: [],
  };
}

describe('工作区存储', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('重建索引时清掉旧文件行，删掉的文件不会残留', async () => {
    await saveWorkspace(makeResult('repo', ['a.ts', 'b.ts']));
    await saveWorkspace(makeResult('repo', ['a.ts']));
    const files = await listWorkspaceFiles('repo');
    expect(files.map((file) => file.path)).toEqual(['a.ts']);
  });

  it('删除工作区会连带清掉文件行和引用它的会话', async () => {
    await saveWorkspace(makeResult('repo', ['a.ts', 'b.ts']));
    await saveWorkspace(makeResult('other', ['c.ts']));
    await saveSession({
      id: 'session-1',
      updatedAt: 1,
      material: {
        mode: 'github',
        kind: 'github',
        title: 'repo',
        text: '',
        source: 'https://github.com/repo',
        workspaceId: 'repo',
      },
      turns: [{ role: 'assistant', content: '解读' }],
      templateId: 'builtin:project-guide',
      workspaceId: 'repo',
    });

    await deleteWorkspace('repo');

    expect(await listWorkspaceFiles('repo')).toEqual([]);
    expect(await listSessions()).toEqual([]);
    // 同库里的其他工作区不受影响。
    expect((await listWorkspaces()).map((space) => space.id)).toEqual(['other']);
    expect(await listWorkspaceFiles('other')).toHaveLength(1);
  });

  it('搜索命中返回路径与行号', async () => {
    await saveWorkspace(makeResult('repo', ['a.ts']));
    const matches = await searchWorkspace('repo', '第二行');
    expect(matches).toEqual([{ path: 'a.ts', line: 2, text: '第二行' }]);
  });
});
