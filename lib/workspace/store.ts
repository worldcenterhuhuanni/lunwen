import type {
  SearchMatch,
  WorkspaceBuildResult,
  WorkspaceFile,
  WorkspaceRecord,
} from './types';
import { throwIfAborted, yieldToMain } from '../abort';

const DB_NAME = 'material-analysis';
const DB_VERSION = 1;
const WORKSPACES = 'workspaces';
const FILES = 'files';

function fileKey(workspaceId: string, path: string): string {
  return `${workspaceId}\0${path}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKSPACES)) {
        db.createObjectStore(WORKSPACES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(FILES)) {
        const store = db.createObjectStore(FILES, { keyPath: 'key' });
        store.createIndex('workspaceId', 'workspaceId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务已取消'));
  });
}

export async function saveWorkspace(
  result: WorkspaceBuildResult,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const db = await openDb();
  const tx = db.transaction([WORKSPACES, FILES], 'readwrite');
  const onAbort = () => {
    try {
      tx.abort();
    } catch {
      /* 事务可能已经完成。 */
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const workspaces = tx.objectStore(WORKSPACES);
  const files = tx.objectStore(FILES);
  try {
    throwIfAborted(signal);
    workspaces.put(result.workspace);

    const existing = files.index('workspaceId').openKeyCursor(IDBKeyRange.only(result.workspace.id));
    await new Promise<void>((resolve, reject) => {
      existing.onerror = () => reject(existing.error);
      existing.onsuccess = () => {
        const cursor = existing.result;
        if (!cursor) {
          for (const file of result.files) {
            files.put({ ...file, key: fileKey(file.workspaceId, file.path) });
          }
          resolve();
          return;
        }
        files.delete(cursor.primaryKey);
        cursor.continue();
      };
    });
    await transactionDone(tx);
    throwIfAborted(signal);
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    db.close();
  }
}

export async function getWorkspace(id: string): Promise<WorkspaceRecord | null> {
  const db = await openDb();
  const tx = db.transaction(WORKSPACES, 'readonly');
  const value = await requestResult(tx.objectStore(WORKSPACES).get(id));
  await transactionDone(tx);
  db.close();
  return (value as WorkspaceRecord | undefined) ?? null;
}

export async function listWorkspaceFiles(workspaceId: string): Promise<WorkspaceFile[]> {
  const db = await openDb();
  const tx = db.transaction(FILES, 'readonly');
  const rows = await requestResult(
    tx.objectStore(FILES).index('workspaceId').getAll(IDBKeyRange.only(workspaceId)),
  );
  await transactionDone(tx);
  db.close();
  return (rows as Array<WorkspaceFile & { key: string }>).map(({ key: _key, ...file }) => file);
}

export async function readWorkspaceFile(
  workspaceId: string,
  path: string,
): Promise<WorkspaceFile | null> {
  const db = await openDb();
  const tx = db.transaction(FILES, 'readonly');
  const row = await requestResult(tx.objectStore(FILES).get(fileKey(workspaceId, path)));
  await transactionDone(tx);
  db.close();
  if (!row) return null;
  const { key: _key, ...file } = row as WorkspaceFile & { key: string };
  return file;
}

export async function updateWorkspaceFile(file: WorkspaceFile): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(FILES, 'readwrite');
  tx.objectStore(FILES).put({ ...file, key: fileKey(file.workspaceId, file.path) });
  await transactionDone(tx);
  db.close();
}

export async function searchWorkspace(
  workspaceId: string,
  query: string,
  limit = 40,
  signal?: AbortSignal,
): Promise<SearchMatch[]> {
  throwIfAborted(signal);
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const files = await listWorkspaceFiles(workspaceId);
  const matches: SearchMatch[] = [];
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    throwIfAborted(signal);
    if (fileIndex > 0 && fileIndex % 20 === 0) await yieldToMain(signal);
    const file = files[fileIndex];
    const lines = file.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].toLocaleLowerCase().includes(needle)) continue;
      matches.push({ path: file.path, line: i + 1, text: lines[i].trim().slice(0, 500) });
      if (matches.length >= limit) return matches;
    }
  }
  return matches;
}
