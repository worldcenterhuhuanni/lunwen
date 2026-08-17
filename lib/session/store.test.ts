import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteSession, listSessions, saveSession } from './store';
import { MAX_SESSIONS, type StoredSession } from './types';

function makeSession(index: number): StoredSession {
  return {
    id: `session-${index}`,
    // 用递增时间戳表示新旧顺序，index 越大越新。
    updatedAt: 1_000 + index,
    material: {
      mode: 'paper',
      kind: 'html',
      title: `材料 ${index}`,
      text: '正文',
      source: 'clipboard:paste',
    },
    turns: [{ role: 'assistant', content: '解读内容' }],
    templateId: 'builtin:research-review',
  };
}

describe('会话存储', () => {
  beforeEach(() => {
    // 每个用例一套全新的库，避免相互污染。
    globalThis.indexedDB = new IDBFactory();
  });

  it('按最近更新时间倒序返回', async () => {
    await saveSession(makeSession(1));
    await saveSession(makeSession(3));
    await saveSession(makeSession(2));
    const rows = await listSessions();
    expect(rows.map((row) => row.id)).toEqual(['session-3', 'session-2', 'session-1']);
  });

  it('超过上限时淘汰最旧的几条', async () => {
    for (let index = 1; index <= MAX_SESSIONS + 5; index += 1) {
      await saveSession(makeSession(index));
    }
    const rows = await listSessions();
    expect(rows).toHaveLength(MAX_SESSIONS);
    // 最新的留下，最旧的 5 条被淘汰。
    expect(rows[0].id).toBe(`session-${MAX_SESSIONS + 5}`);
    expect(rows.at(-1)?.id).toBe('session-6');
    expect(rows.some((row) => row.id === 'session-1')).toBe(false);
  });

  it('同一 id 重复保存是更新而不是新增', async () => {
    await saveSession(makeSession(1));
    await saveSession({ ...makeSession(1), turns: [{ role: 'assistant', content: '更新后' }] });
    const rows = await listSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].turns[0].content).toBe('更新后');
  });

  it('删除后不再列出', async () => {
    await saveSession(makeSession(1));
    await deleteSession('session-1');
    expect(await listSessions()).toEqual([]);
  });
});
