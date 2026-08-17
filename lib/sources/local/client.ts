import type { Material } from '../../material/types';
import { throwIfAborted } from '../../abort';
import { pathExclusionReason } from '../../workspace/filters';
import { buildWorkspace } from '../../workspace/indexer';
import { getWorkspace, saveWorkspace } from '../../workspace/store';
import type { WorkspaceBuildLimits, WorkspaceCandidate } from '../../workspace/types';

async function* walkDirectory(
  current: FileSystemDirectoryHandle,
  ignorePatterns: string[],
  signal?: AbortSignal,
  prefix = '',
): AsyncGenerator<WorkspaceCandidate> {
  for await (const handle of current.values()) {
    throwIfAborted(signal);
    const path = prefix ? `${prefix}/${handle.name}` : handle.name;
    const exclusion = pathExclusionReason(path, ignorePatterns);
    if (handle.kind === 'directory') {
      if (exclusion) {
        yield { path: `${path}/.excluded`, content: '', size: 0 };
        continue;
      }
      yield* walkDirectory(handle as FileSystemDirectoryHandle, ignorePatterns, signal, path);
      continue;
    }
    const file = await (handle as FileSystemFileHandle).getFile();
    if (exclusion) {
      yield { path, content: '', size: file.size, modifiedAt: file.lastModified };
      continue;
    }
    yield {
      path,
      content: await file.text(),
      size: file.size,
      modifiedAt: file.lastModified,
    };
  }
}

function localMaterial(
  title: string,
  workspaceId: string,
  result: Awaited<ReturnType<typeof buildWorkspace>>,
  writable: boolean,
): Material {
  return {
    mode: 'local',
    kind: 'local',
    title,
    source: `local:${title}`,
    text: `本地工作区 ${title} 已建立文件级索引。`,
    workspaceId,
    version: result.workspace.version,
    stats: result.workspace.stats,
    writable,
  };
}

export function supportsDirectoryPicker(): boolean {
  return typeof window.showDirectoryPicker === 'function';
}

/** 首次导入与重新索引共用：给定目录句柄和工作区标识，重建一次完整索引。 */
async function indexDirectoryHandle(
  root: FileSystemDirectoryHandle,
  workspaceId: string,
  limits: WorkspaceBuildLimits,
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
): Promise<Material> {
  throwIfAborted(signal);
  onProgress?.(`正在扫描 ${root.name}…`);
  const writable = (await root.queryPermission({ mode: 'readwrite' })) !== 'denied';
  const result = await buildWorkspace(walkDirectory(root, limits.ignorePatterns, signal), {
    id: workspaceId,
    mode: 'local',
    title: root.name,
    source: `local:${root.name}`,
    version: String(Date.now()),
    writable,
    limits,
    rootHandle: root,
    signal,
  });
  onProgress?.('正在保存本地源码索引…');
  await saveWorkspace(result, signal);
  return localMaterial(root.name, workspaceId, result, writable);
}

export async function importLocalDirectory(
  limits: WorkspaceBuildLimits,
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
): Promise<Material> {
  if (!window.showDirectoryPicker) throw new Error('当前浏览器不支持可写目录授权，请使用只读目录导入。');
  const root = await window.showDirectoryPicker({ mode: 'readwrite' });
  return indexDirectoryHandle(root, `local:${crypto.randomUUID()}`, limits, onProgress, signal);
}

/**
 * 用已持久化的目录句柄重建索引，沿用原工作区标识。
 * 「重新索引」和「复用历史本地工作区」是同一件事：都要重新读盘确认内容没过期。
 */
export async function reindexLocalWorkspace(
  workspaceId: string,
  limits: WorkspaceBuildLimits,
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
): Promise<Material> {
  const record = await getWorkspace(workspaceId);
  if (!record) throw new Error('本地索引已失效，请重新选择目录。');
  const root = record.rootHandle;
  if (!root) throw new Error('该工作区当初是只读导入的，没有目录授权，请重新选择文件夹。');
  onProgress?.('正在确认目录授权…');
  let permission = await root.queryPermission({ mode: 'readwrite' });
  // 权限只在用户手势里才能重新申请，所以这条路径必须由按钮点击触发。
  if (permission !== 'granted') permission = await root.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error('目录授权已失效，请重新选择该文件夹。');
  return indexDirectoryHandle(root, workspaceId, limits, onProgress, signal);
}

export async function importLocalFileList(
  fileList: FileList,
  limits: WorkspaceBuildLimits,
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
): Promise<Material> {
  const files = Array.from(fileList);
  if (!files.length) throw new Error('没有选择目录文件。');
  const title = files[0].webkitRelativePath?.split('/')[0] || '本地目录';
  onProgress?.(`正在只读导入 ${title}…`);
  const candidates: WorkspaceCandidate[] = [];
  for (const file of files) {
    throwIfAborted(signal);
    const path = file.webkitRelativePath
      ? file.webkitRelativePath.split('/').slice(1).join('/')
      : file.name;
    if (!path) continue;
    if (pathExclusionReason(path, limits.ignorePatterns)) {
      candidates.push({ path, content: '', size: file.size, modifiedAt: file.lastModified });
      continue;
    }
    candidates.push({
      path,
      content: await file.text(),
      size: file.size,
      modifiedAt: file.lastModified,
    });
  }
  const workspaceId = `local-readonly:${crypto.randomUUID()}`;
  const result = await buildWorkspace(candidates, {
    id: workspaceId,
    mode: 'local',
    title,
    source: `local:${title}`,
    version: String(Date.now()),
    writable: false,
    limits,
    signal,
  });
  await saveWorkspace(result, signal);
  return localMaterial(title, workspaceId, result, false);
}
