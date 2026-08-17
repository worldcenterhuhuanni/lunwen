// 扩展本地库的唯一入口。
// workspace 索引与解读会话共用一个 IndexedDB —— 分成两个库会让版本升级互相打架，
// 而且删除工作区时要连带删掉引用它的会话，同库才能放进一个事务。
const DB_NAME = 'material-analysis';
const DB_VERSION = 3;

export const WORKSPACES = 'workspaces';
export const FILES = 'files';
export const SESSIONS = 'sessions';
/** 对照阅读用的原文字节，按会话存，只保留最近几篇。 */
export const DOCUMENTS = 'documents';

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      // 逐个判断而不是按版本号分支：旧库升级和全新建库走同一条路径。
      if (!db.objectStoreNames.contains(WORKSPACES)) {
        db.createObjectStore(WORKSPACES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(FILES)) {
        const store = db.createObjectStore(FILES, { keyPath: 'key' });
        store.createIndex('workspaceId', 'workspaceId', { unique: false });
      }
      if (!db.objectStoreNames.contains(SESSIONS)) {
        const store = db.createObjectStore(SESSIONS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
        store.createIndex('workspaceId', 'workspaceId', { unique: false });
      }
      if (!db.objectStoreNames.contains(DOCUMENTS)) {
        const store = db.createObjectStore(DOCUMENTS, { keyPath: 'sessionId' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务已取消'));
  });
}

/** 按索引游标删除全部匹配主键；调用方负责提供同一事务内的 store。 */
export function deleteByIndex(
  store: IDBObjectStore,
  indexName: string,
  value: IDBValidKey,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cursor = store.index(indexName).openKeyCursor(IDBKeyRange.only(value));
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) {
        resolve();
        return;
      }
      store.delete(current.primaryKey);
      current.continue();
    };
  });
}
