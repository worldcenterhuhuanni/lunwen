import type {
  SearchMatch,
  WorkspaceBuildResult,
  WorkspaceFile,
  WorkspaceRecord,
} from './types';
import { throwIfAborted, yieldToMain } from '../abort';
import {
  DOCUMENTS,
  FILES,
  SESSIONS,
  WORKSPACES,
  deleteByIndex,
  openDb,
  requestResult,
  transactionDone,
} from '../db';

function fileKey(workspaceId: string, path: string): string {
  return `${workspaceId}\0${path}`;
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

    // 重建索引时先清掉同工作区的旧文件行，避免删掉的文件残留成幽灵。
    await deleteByIndex(files, 'workspaceId', result.workspace.id);
    for (const file of result.files) {
      files.put({ ...file, key: fileKey(file.workspaceId, file.path) });
    }
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

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  const db = await openDb();
  const tx = db.transaction(WORKSPACES, 'readonly');
  const rows = await requestResult(tx.objectStore(WORKSPACES).getAll());
  await transactionDone(tx);
  db.close();
  return (rows as WorkspaceRecord[]).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 删除工作区及其全部文件行和引用它的会话。
 * 三者必须同一事务：否则中途失败会留下查不到工作区、却仍占着空间的孤儿文件行。
 */
export async function deleteWorkspace(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([WORKSPACES, FILES, SESSIONS, DOCUMENTS], 'readwrite');
  const sessions = tx.objectStore(SESSIONS);
  // 文档以 sessionId 为主键，所以先取出这些会话的键，再顺手删掉它们的对照原文。
  const sessionKeys = await requestResult(
    sessions.index('workspaceId').getAllKeys(IDBKeyRange.only(id)),
  );
  for (const key of sessionKeys) tx.objectStore(DOCUMENTS).delete(key);
  tx.objectStore(WORKSPACES).delete(id);
  await deleteByIndex(tx.objectStore(FILES), 'workspaceId', id);
  await deleteByIndex(sessions, 'workspaceId', id);
  await transactionDone(tx);
  db.close();
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
