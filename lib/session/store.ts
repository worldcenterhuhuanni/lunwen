// 解读会话的持久化：材料元信息 + 全部对话轮次，存在与工作区索引同一个 IndexedDB 里。
import { DOCUMENTS, SESSIONS, openDb, requestResult, transactionDone } from '../db';
import { MAX_SESSIONS, type StoredSession } from './types';

/** 超出上限时按更新时间淘汰最旧的几条。必须与写入共用同一事务。 */
function pruneSessions(store: IDBObjectStore): Promise<void> {
  return new Promise((resolve, reject) => {
    const cursor = store.index('updatedAt').openKeyCursor(null, 'prev');
    let seen = 0;
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) {
        resolve();
        return;
      }
      seen += 1;
      if (seen > MAX_SESSIONS) store.delete(current.primaryKey);
      current.continue();
    };
  });
}

export async function saveSession(session: StoredSession): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(SESSIONS, 'readwrite');
  const store = tx.objectStore(SESSIONS);
  store.put(session);
  await pruneSessions(store);
  await transactionDone(tx);
  db.close();
}

/** 最近更新的排在前面。 */
export async function listSessions(): Promise<StoredSession[]> {
  const db = await openDb();
  const tx = db.transaction(SESSIONS, 'readonly');
  const rows = await requestResult(tx.objectStore(SESSIONS).index('updatedAt').getAll());
  await transactionDone(tx);
  db.close();
  return (rows as StoredSession[]).reverse();
}

export async function getSession(id: string): Promise<StoredSession | null> {
  const db = await openDb();
  const tx = db.transaction(SESSIONS, 'readonly');
  const row = await requestResult(tx.objectStore(SESSIONS).get(id));
  await transactionDone(tx);
  db.close();
  return (row as StoredSession | undefined) ?? null;
}

export async function deleteSession(id: string): Promise<void> {
  const db = await openDb();
  // 会话与它的对照原文一起删，否则几十 MB 的字节会永远留在库里。
  const tx = db.transaction([SESSIONS, DOCUMENTS], 'readwrite');
  tx.objectStore(SESSIONS).delete(id);
  tx.objectStore(DOCUMENTS).delete(id);
  await transactionDone(tx);
  db.close();
}
