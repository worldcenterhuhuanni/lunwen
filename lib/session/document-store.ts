// 对照阅读的原文字节。按会话存，只留最近几篇 —— 历史列表可以有几十条会话，
// 但同时需要原文对照的永远只有手头这一两篇，没必要让几十 MB 的 PDF 常驻。
import { DOCUMENTS, openDb, requestResult, transactionDone } from '../db';

export interface StoredDocument {
  sessionId: string;
  name: string;
  mime: string;
  data: ArrayBuffer;
  updatedAt: number;
}

/** 同时保留的对照文档上限。 */
export const MAX_DOCUMENTS = 3;

/** 超出上限时按更新时间淘汰最旧的；必须与写入共用同一事务。 */
function pruneDocuments(store: IDBObjectStore): Promise<void> {
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
      if (seen > MAX_DOCUMENTS) store.delete(current.primaryKey);
      current.continue();
    };
  });
}

export async function putDocument(document: StoredDocument): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(DOCUMENTS, 'readwrite');
  const store = tx.objectStore(DOCUMENTS);
  store.put(document);
  await pruneDocuments(store);
  await transactionDone(tx);
  db.close();
}

export async function getDocument(sessionId: string): Promise<StoredDocument | null> {
  const db = await openDb();
  const tx = db.transaction(DOCUMENTS, 'readonly');
  const row = await requestResult(tx.objectStore(DOCUMENTS).get(sessionId));
  await transactionDone(tx);
  db.close();
  return (row as StoredDocument | undefined) ?? null;
}

export async function deleteDocument(sessionId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(DOCUMENTS, 'readwrite');
  tx.objectStore(DOCUMENTS).delete(sessionId);
  await transactionDone(tx);
  db.close();
}
