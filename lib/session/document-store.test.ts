import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_DOCUMENTS, getDocument, putDocument } from './document-store';
import { deleteSession, listSessions, saveSession } from './store';
import type { StoredSession } from './types';

function makeDocument(index: number) {
  return {
    sessionId: `session-${index}`,
    name: `paper-${index}.pdf`,
    mime: 'application/pdf',
    data: new ArrayBuffer(64),
    updatedAt: 1_000 + index,
  };
}

function makeSession(index: number): StoredSession {
  return {
    id: `session-${index}`,
    updatedAt: 1_000 + index,
    material: {
      mode: 'paper',
      kind: 'pdf',
      title: `论文 ${index}`,
      text: '正文',
      source: 'local:a.pdf',
    },
    turns: [{ role: 'assistant', content: '解读' }],
    templateId: 'builtin:research-review',
  };
}

describe('对照原文存储', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('只保留最近几篇，旧的自动淘汰', async () => {
    for (let index = 1; index <= MAX_DOCUMENTS + 2; index += 1) {
      await putDocument(makeDocument(index));
    }
    expect(await getDocument(`session-${MAX_DOCUMENTS + 2}`)).not.toBeNull();
    expect(await getDocument('session-1')).toBeNull();
    expect(await getDocument('session-2')).toBeNull();
  });

  it('同一会话重复写入是覆盖而不是新增', async () => {
    await putDocument(makeDocument(1));
    await putDocument({ ...makeDocument(1), name: 'renamed.pdf' });
    expect((await getDocument('session-1'))?.name).toBe('renamed.pdf');
  });

  it('删除会话时连带删掉它的原文', async () => {
    await saveSession(makeSession(1));
    await putDocument(makeDocument(1));

    await deleteSession('session-1');

    expect(await listSessions()).toEqual([]);
    expect(await getDocument('session-1')).toBeNull();
  });
});

describe('旧会话兼容', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('没有 excerpts 字段的历史会话仍能正常读出', async () => {
    await saveSession(makeSession(1));
    const rows = await listSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].excerpts).toBeUndefined();
    expect(rows[0].turns[0].excerptId).toBeUndefined();
  });
});
