import type { Material } from '../../material/types';
import { throwIfAborted } from '../../abort';
import { buildWorkspace } from '../../workspace/indexer';
import { saveWorkspace } from '../../workspace/store';
import type { WorkspaceBuildLimits, WorkspaceCandidate } from '../../workspace/types';
import { pathExclusionReason } from '../../workspace/filters';

interface GitHubRepoInfo {
  full_name: string;
  default_branch: string;
  html_url: string;
  size: number;
  private: boolean;
}

interface GitHubCommit {
  sha: string;
}

interface GitHubTree {
  truncated: boolean;
  tree: Array<{ path: string; type: 'blob' | 'tree' | 'commit'; size?: number }>;
}

interface ArchiveWorkerResponse {
  id: string;
  ok: boolean;
  files?: WorkspaceCandidate[];
  error?: string;
}

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export function parseGitHubRepoUrl(value: string): GitHubRepoRef {
  const input = value.trim();
  const normalized = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('请输入有效的 GitHub 仓库地址。');
  }
  if (!/(^|\.)github\.com$/i.test(url.hostname)) {
    throw new Error('项目模式首版只支持 github.com 公开仓库。');
  }
  const [owner, rawRepo] = url.pathname.split('/').filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/i, '');
  if (!owner || !repo) throw new Error('GitHub 地址应为 https://github.com/owner/repo。');
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    throw new Error('GitHub 仓库名称包含不支持的字符。');
  }
  return { owner, repo };
}

async function githubJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal,
  });
  if (response.status === 404) throw new Error('仓库不存在、不是公开仓库，或地址无权访问。');
  if (response.status === 403) {
    throw new Error('GitHub 未认证请求已触发限流，请稍后重试。');
  }
  if (!response.ok) throw new Error(`GitHub 请求失败 (${response.status})。`);
  return response.json() as Promise<T>;
}

function parseArchiveInWorker(
  gzip: ArrayBuffer,
  signal?: AbortSignal,
): Promise<WorkspaceCandidate[]> {
  throwIfAborted(signal);
  const worker = new Worker(new URL('./archive.worker.ts', import.meta.url), { type: 'module' });
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'GitHub 归档 Worker 失败。'));
    };
    worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (!event.data.ok) {
        reject(new Error(event.data.error || 'GitHub 归档解析失败。'));
        return;
      }
      resolve(event.data.files ?? []);
    };
    worker.postMessage({ id, gzip }, [gzip]);
  });
}

async function importViaTree(
  owner: string,
  repo: string,
  sha: string,
  limits: WorkspaceBuildLimits,
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
): Promise<WorkspaceCandidate[]> {
  throwIfAborted(signal);
  onProgress?.('仓库较大，正在读取 GitHub 文件树…');
  const tree = await githubJson<GitHubTree>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(sha)}?recursive=1`,
    signal,
  );
  if (tree.truncated) throw new Error('GitHub 文件树响应已截断，无法保证全量索引。');
  const blobs = tree.tree.filter((entry) => entry.type === 'blob');
  const eligible = blobs.filter((entry) =>
    !pathExclusionReason(entry.path, limits.ignorePatterns) && (entry.size ?? 0) <= limits.maxFileBytes,
  );
  if (eligible.length > limits.maxFiles) {
    throw new Error(`仓库包含 ${eligible.length.toLocaleString()} 个可读文件，超过 ${limits.maxFiles.toLocaleString()} 上限。`);
  }
  const declaredTextBytes = eligible.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  if (declaredTextBytes > limits.maxTotalBytes) {
    throw new Error(`仓库可读文本约 ${Math.round(declaredTextBytes / 1024 / 1024)}MB，超过索引总量上限。`);
  }
  const eligiblePaths = new Set(eligible.map((entry) => entry.path));
  const candidates: WorkspaceCandidate[] = blobs
    .filter((entry) => !eligiblePaths.has(entry.path))
    .map((entry) => ({ path: entry.path, content: '', size: entry.size ?? 0 }));
  let completed = 0;
  for (let index = 0; index < eligible.length; index += 8) {
    throwIfAborted(signal);
    const group = eligible.slice(index, index + 8);
    const loaded = await Promise.all(group.map(async (entry) => {
      const response = await fetch(
        `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(sha)}/${entry.path.split('/').map(encodeURIComponent).join('/')}`,
        { signal },
      );
      if (!response.ok) throw new Error(`读取源码失败 (${response.status})：${entry.path}`);
      const content = await response.text();
      return { path: entry.path, content, size: new TextEncoder().encode(content).byteLength };
    }));
    candidates.push(...loaded);
    completed += loaded.length;
    onProgress?.(`正在读取源码 ${completed}/${eligible.length}…`);
  }
  return candidates;
}

export async function importGitHubRepository(
  input: string,
  limits: WorkspaceBuildLimits,
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
): Promise<Material> {
  throwIfAborted(signal);
  const { owner, repo } = parseGitHubRepoUrl(input);
  onProgress?.('正在读取 GitHub 仓库信息…');
  const info = await githubJson<GitHubRepoInfo>(`/repos/${owner}/${repo}`, signal);
  if (info.private) throw new Error('首版只支持公开仓库。');
  const commit = await githubJson<GitHubCommit>(
    `/repos/${owner}/${repo}/commits/${encodeURIComponent(info.default_branch)}`,
    signal,
  );
  let candidates: WorkspaceCandidate[];
  if (info.size * 1024 > limits.maxArchiveBytes * 4) {
    candidates = await importViaTree(owner, repo, commit.sha, limits, onProgress, signal);
  } else {
    onProgress?.(`正在下载 ${info.full_name}@${commit.sha.slice(0, 7)}…`);
    const archive = await fetch(
      `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/${encodeURIComponent(commit.sha)}`,
      { signal },
    );
    if (!archive.ok) throw new Error(`GitHub 归档下载失败 (${archive.status})。`);
    const declared = Number(archive.headers.get('content-length') || 0);
    if (declared > limits.maxArchiveBytes) {
      candidates = await importViaTree(owner, repo, commit.sha, limits, onProgress, signal);
    } else {
      const gzip = await archive.arrayBuffer();
      throwIfAborted(signal);
      if (gzip.byteLength > limits.maxArchiveBytes) {
        candidates = await importViaTree(owner, repo, commit.sha, limits, onProgress, signal);
      } else {
        onProgress?.('正在解压并检查源码安全边界…');
        candidates = await parseArchiveInWorker(gzip, signal);
      }
    }
  }
  const workspaceId = `github:${info.full_name.toLowerCase()}:${commit.sha}`;
  const result = await buildWorkspace(candidates, {
    id: workspaceId,
    mode: 'github',
    title: info.full_name,
    source: info.html_url,
    version: commit.sha,
    writable: false,
    limits,
    signal,
  });
  throwIfAborted(signal);
  onProgress?.('正在保存本地源码索引…');
  await saveWorkspace(result, signal);

  return {
    mode: 'github',
    kind: 'github',
    title: info.full_name,
    source: info.html_url,
    text: `公开仓库 ${info.full_name}，默认分支 ${info.default_branch}，提交 ${commit.sha}。源码已建立文件级本地索引。`,
    workspaceId,
    version: commit.sha,
    stats: result.workspace.stats,
    writable: false,
  };
}
