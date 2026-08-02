import type { AnalysisMode } from '../material/types';
import { throwIfAborted, yieldToMain } from '../abort';
import {
  containsLikelySecret,
  fingerprintText,
  languageForPath,
  looksBinary,
  normalizeWorkspacePath,
  pathExclusionReason,
} from './filters';
import type {
  WorkspaceBuildLimits,
  WorkspaceBuildResult,
  WorkspaceCandidate,
  WorkspaceFile,
  WorkspaceRecord,
} from './types';

interface BuildWorkspaceOptions {
  id: string;
  mode: Exclude<AnalysisMode, 'paper'>;
  title: string;
  source: string;
  version: string;
  writable: boolean;
  limits: WorkspaceBuildLimits;
  rootHandle?: FileSystemDirectoryHandle;
  signal?: AbortSignal;
}

export async function buildWorkspace(
  candidates: Iterable<WorkspaceCandidate> | AsyncIterable<WorkspaceCandidate>,
  options: BuildWorkspaceOptions,
): Promise<WorkspaceBuildResult> {
  const files: WorkspaceFile[] = [];
  const excluded: WorkspaceBuildResult['excluded'] = [];
  const languages: Record<string, number> = {};
  let indexedBytes = 0;
  let excludedBytes = 0;
  let processed = 0;

  for await (const candidate of candidates) {
    throwIfAborted(options.signal);
    processed += 1;
    if (processed % 25 === 0) await yieldToMain(options.signal);
    const path = normalizeWorkspacePath(candidate.path);
    const size = candidate.size ?? new TextEncoder().encode(candidate.content).byteLength;
    const reason = pathExclusionReason(path, options.limits.ignorePatterns);
    if (reason) {
      excluded.push({ path, reason, size });
      excludedBytes += size;
      continue;
    }
    if (size > options.limits.maxFileBytes) {
      excluded.push({ path, reason: '文件超过单文件上限', size });
      excludedBytes += size;
      continue;
    }
    if (looksBinary(candidate.content)) {
      excluded.push({ path, reason: '内容疑似二进制', size });
      excludedBytes += size;
      continue;
    }
    if (containsLikelySecret(candidate.content)) {
      excluded.push({ path, reason: '内容疑似包含密钥', size });
      excludedBytes += size;
      continue;
    }
    if (files.length + 1 > options.limits.maxFiles) {
      throw new Error(`项目文件数超过上限 ${options.limits.maxFiles.toLocaleString()}，请缩小目录或调整设置。`);
    }
    if (indexedBytes + size > options.limits.maxTotalBytes) {
      const mb = Math.round(options.limits.maxTotalBytes / 1024 / 1024);
      throw new Error(`项目文本超过上限 ${mb}MB，已停止索引，未产生不完整结果。`);
    }
    const language = languageForPath(path);
    const file: WorkspaceFile = {
      workspaceId: options.id,
      path,
      content: candidate.content,
      size,
      language,
      modifiedAt: candidate.modifiedAt,
      fingerprint: await fingerprintText(candidate.content),
    };
    files.push(file);
    indexedBytes += size;
    languages[language] = (languages[language] ?? 0) + 1;
  }

  throwIfAborted(options.signal);
  if (!files.length) throw new Error('没有找到可安全索引的文本源码。');
  files.sort((a, b) => a.path.localeCompare(b.path));

  const workspace: WorkspaceRecord = {
    id: options.id,
    mode: options.mode,
    title: options.title,
    source: options.source,
    version: options.version,
    createdAt: Date.now(),
    stats: {
      indexedFiles: files.length,
      indexedBytes,
      excludedFiles: excluded.length,
      excludedBytes,
      languages,
    },
    writable: options.writable,
    rootHandle: options.rootHandle,
  };
  return { workspace, files, excluded };
}
