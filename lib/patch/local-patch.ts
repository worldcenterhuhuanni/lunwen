import { createTwoFilesPatch } from 'diff';
import { fingerprintText, normalizeWorkspacePath, pathExclusionReason } from '../workspace/filters';
import { getWorkspace, readWorkspaceFile, updateWorkspaceFile } from '../workspace/store';

export interface CandidatePatch {
  id: string;
  workspaceId: string;
  path: string;
  originalFingerprint: string;
  proposedContent: string;
  diff: string;
  createdAt: number;
}

export async function assertUnchangedContent(current: string, expectedFingerprint: string): Promise<void> {
  if (await fingerprintText(current) !== expectedFingerprint) {
    throw new Error('源文件在生成 diff 后已变化，已拒绝覆盖。请重新分析并生成修改。');
  }
}

export async function createCandidatePatch(
  workspaceId: string,
  inputPath: string,
  proposedContent: string,
): Promise<CandidatePatch> {
  const path = normalizeWorkspacePath(inputPath);
  const reason = pathExclusionReason(path);
  if (reason) throw new Error(`不能修改 ${path}：${reason}`);
  const workspace = await getWorkspace(workspaceId);
  if (!workspace?.writable || !workspace.rootHandle) {
    throw new Error('当前工作区是只读来源，不能直接写回。');
  }
  const file = await readWorkspaceFile(workspaceId, path);
  if (!file) throw new Error(`只能修改已索引的现有文件：${path}`);
  if (proposedContent === file.content) throw new Error('候选内容与当前文件相同。');
  if (new TextEncoder().encode(proposedContent).byteLength > 2 * 1024 * 1024) {
    throw new Error('候选文件超过 2MB 写入上限。');
  }
  return {
    id: crypto.randomUUID(),
    workspaceId,
    path,
    originalFingerprint: file.fingerprint,
    proposedContent,
    diff: createTwoFilesPatch(`a/${path}`, `b/${path}`, file.content, proposedContent, '', '', {
      context: 3,
    }),
    createdAt: Date.now(),
  };
}

async function getFileHandle(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle> {
  const parts = normalizeWorkspacePath(path).split('/');
  let directory = root;
  for (const segment of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(segment, { create: false });
  }
  return directory.getFileHandle(parts.at(-1)!, { create: false });
}

export async function applyCandidatePatch(patch: CandidatePatch): Promise<void> {
  const workspace = await getWorkspace(patch.workspaceId);
  if (!workspace?.writable || !workspace.rootHandle) throw new Error('本地目录写入授权不可用。');
  const permission = await workspace.rootHandle.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error('用户未授予本地目录写入权限。');
  const handle = await getFileHandle(workspace.rootHandle, patch.path);
  const current = await (await handle.getFile()).text();
  await assertUnchangedContent(current, patch.originalFingerprint);
  const writable = await handle.createWritable();
  try {
    await writable.write(patch.proposedContent);
    await writable.close();
    const indexed = await readWorkspaceFile(patch.workspaceId, patch.path);
    if (indexed) {
      await updateWorkspaceFile({
        ...indexed,
        content: patch.proposedContent,
        size: new TextEncoder().encode(patch.proposedContent).byteLength,
        fingerprint: await fingerprintText(patch.proposedContent),
        modifiedAt: Date.now(),
      });
    }
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
}
