import { throwIfAborted, yieldToMain } from '../abort';
import { listWorkspaceFiles } from './store';
import type { WorkspaceFile } from './types';

export interface WorkspaceContextPack {
  content: string;
  includedPaths: string[];
  omittedPaths: string[];
  repositoryMapFiles: number;
  repositoryMapTruncated: boolean;
}

interface ContextPackOptions {
  maxChars: number;
  query?: string;
  signal?: AbortSignal;
}

const IMPORTANT_NAMES = new Set([
  'readme.md',
  'package.json',
  'pyproject.toml',
  'cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'requirements.txt',
  'gemfile',
  'composer.json',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'next.config.mjs',
  'wxt.config.ts',
  'dockerfile',
  'makefile',
]);

const LOW_VALUE_PATH = /(?:^|\/)(?:changelog|license|pnpm-lock|package-lock|yarn\.lock|snapshots?)(?:\.|\/|$)/i;
const ENTRY_NAME = /(?:^|\/)(?:index|main|app|server|cli|bootstrap|entrypoint)\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php)$/i;
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const SOURCE_PATH = /(?:^|\/)(?:src|lib|app|packages|entrypoints)(?:\/|$)/i;
const QUERY_STOP_WORDS = new Set([
  '分析', '项目', '源码', '代码', '文件', '功能', '如何', '什么', '这个', '一下',
  'please', 'project', 'source', 'code', 'file', 'analyze', 'analysis', 'how', 'what',
]);

function queryTerms(query = ''): string[] {
  const matches = query.toLocaleLowerCase().match(/[a-z_$][\w$.-]{1,}|[\u3400-\u9fff]{2,8}/g) ?? [];
  return [...new Set(matches.filter((term) => !QUERY_STOP_WORDS.has(term)))].slice(0, 16);
}

function structuralScore(file: WorkspaceFile): number {
  const path = file.path.toLocaleLowerCase();
  const name = path.split('/').at(-1) ?? path;
  const depth = path.split('/').length - 1;
  let score = Math.max(0, 20 - depth * 3);
  if (IMPORTANT_NAMES.has(name) || /^readme(?:\.[^/]+)?$/i.test(name)) score += 120;
  if (ENTRY_NAME.test(path)) score += 95;
  if (SOURCE_PATH.test(path)) score += 30;
  if (TEST_PATH.test(path)) score += 18;
  if (LOW_VALUE_PATH.test(path)) score -= 100;
  if (file.size <= 20_000) score += 8;
  if (file.size > 200_000) score -= 15;
  return score;
}

function isManifest(file: WorkspaceFile): boolean {
  const name = file.path.toLocaleLowerCase().split('/').at(-1) ?? '';
  return IMPORTANT_NAMES.has(name) || /^readme(?:\.[^/]+)?$/i.test(name);
}

function relevanceScore(file: WorkspaceFile, terms: string[]): number {
  if (!terms.length) return 0;
  const path = file.path.toLocaleLowerCase();
  const content = file.content.toLocaleLowerCase();
  let score = 0;
  for (const term of terms) {
    if (path.includes(term)) score += 220;
    const first = content.indexOf(term);
    if (first >= 0) {
      score += 150;
      if (content.indexOf(term, first + term.length) >= 0) score += 30;
    }
  }
  return score;
}

function buildRepositoryMap(
  files: WorkspaceFile[],
  maxChars: number,
): { text: string; count: number; truncated: boolean } {
  const lines: string[] = [];
  let chars = 0;
  for (const file of files) {
    const line = `${file.path}\t${file.language}\t${file.size}B`;
    if (chars + line.length + 1 > maxChars) break;
    lines.push(line);
    chars += line.length + 1;
  }
  const truncated = lines.length < files.length;
  if (truncated) lines.push(`… 另有 ${files.length - lines.length} 个路径因仓库地图预算未展开`);
  return { text: lines.join('\n'), count: Math.min(lines.length, files.length), truncated };
}

function mergeLineWindows(points: number[], total: number): Array<[number, number]> {
  const windows: Array<[number, number]> = [];
  for (const point of points.slice(0, 6)) {
    const start = Math.max(0, point - 12);
    const end = Math.min(total, point + 13);
    const previous = windows.at(-1);
    if (previous && start <= previous[1] + 3) {
      previous[1] = Math.max(previous[1], end);
    } else {
      windows.push([start, end]);
    }
  }
  return windows;
}

function relevantExcerpt(content: string, terms: string[], maxChars: number): string {
  if (content.length <= maxChars) return content;
  if (terms.length) {
    const lines = content.split(/\r?\n/);
    const points: number[] = [];
    for (let index = 0; index < lines.length && points.length < 6; index += 1) {
      const line = lines[index].toLocaleLowerCase();
      if (terms.some((term) => line.includes(term))) points.push(index);
    }
    const windows = mergeLineWindows(points, lines.length);
    if (windows.length) {
      const snippets = windows.map(([start, end]) =>
        `【行 ${start + 1}-${end}】\n${lines.slice(start, end).join('\n')}`,
      );
      const joined = snippets.join('\n\n…\n\n');
      if (joined.length <= maxChars) return joined;
      return joined.slice(0, maxChars);
    }
  }
  const headChars = Math.floor(maxChars * 0.72);
  const tailChars = Math.max(0, maxChars - headChars - 20);
  return `${content.slice(0, headChars)}\n\n… 文件中段省略 …\n\n${content.slice(-tailChars)}`;
}

export async function buildContextPackFromFiles(
  sourceFiles: WorkspaceFile[],
  options: ContextPackOptions,
): Promise<WorkspaceContextPack> {
  throwIfAborted(options.signal);
  const maxChars = Math.max(1_000, Math.floor(options.maxChars));
  const files = [...sourceFiles].sort((a, b) => a.path.localeCompare(b.path));
  const terms = queryTerms(options.query);
  const scored: Array<{ file: WorkspaceFile; score: number }> = [];

  for (let index = 0; index < files.length; index += 1) {
    throwIfAborted(options.signal);
    if (index > 0 && index % 20 === 0) await yieldToMain(options.signal);
    const file = files[index];
    scored.push({
      file,
      score: structuralScore(file) + relevanceScore(file, terms),
    });
  }
  scored.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  const ordered = terms.length
    ? scored
    : (() => {
        const result: typeof scored = [];
        const seen = new Set<string>();
        const take = (predicate: (item: (typeof scored)[number]) => boolean, limit: number) => {
          for (const item of scored) {
            if (result.length >= files.length || limit <= 0) break;
            if (seen.has(item.file.path) || !predicate(item)) continue;
            result.push(item);
            seen.add(item.file.path);
            limit -= 1;
          }
        };
        // 宽泛架构分析先建立骨架，再把主要预算留给真实源码。
        take((item) => isManifest(item.file), 4);
        take((item) => ENTRY_NAME.test(item.file.path), 4);
        take((item) => SOURCE_PATH.test(item.file.path) && !TEST_PATH.test(item.file.path), 16);
        take((item) => TEST_PATH.test(item.file.path), 3);
        take(() => true, files.length);
        return result;
      })();

  const mapBudget = Math.min(14_000, Math.max(300, Math.floor(maxChars * 0.24)));
  const repositoryMap = buildRepositoryMap(files, mapBudget);
  const sections = [
    `## 仓库地图\n格式：路径、语言、字节数。\n${repositoryMap.text}`,
    '## 本次纳入的源码证据',
  ];
  let usedChars = sections.join('\n\n').length;
  const includedPaths: string[] = [];
  const perFileLimit = terms.length
    ? Math.min(14_000, Math.max(500, Math.floor(maxChars * 0.28)))
    : Math.min(8_000, Math.max(500, Math.floor(maxChars * 0.18)));
  const boundaryReserve = 320;

  for (const { file } of ordered) {
    throwIfAborted(options.signal);
    const remaining = maxChars - boundaryReserve - usedChars;
    if (remaining < 800) break;
    const excerpt = relevantExcerpt(file.content, terms, Math.min(perFileLimit, remaining - 120));
    const section = `### ${file.path}\n<source path="${file.path}">\n${excerpt}\n</source>`;
    if (usedChars + section.length > maxChars) continue;
    sections.push(section);
    includedPaths.push(file.path);
    usedChars += section.length + 2;
  }

  const included = new Set(includedPaths);
  const omittedPaths = files.filter((file) => !included.has(file.path)).map((file) => file.path);
  sections.push(
    `## 上下文边界\n本次包含 ${includedPaths.length}/${files.length} 个文件的源码内容。` +
      `其余 ${omittedPaths.length} 个文件仍在本地完整索引中，但未进入本次模型上下文；不得据此断言它们不存在或未实现相关功能。`,
  );

  return {
    content: sections.join('\n\n'),
    includedPaths,
    omittedPaths,
    repositoryMapFiles: repositoryMap.count,
    repositoryMapTruncated: repositoryMap.truncated,
  };
}

export async function buildWorkspaceContextPack(
  workspaceId: string,
  options: ContextPackOptions,
): Promise<WorkspaceContextPack> {
  const files = await listWorkspaceFiles(workspaceId);
  throwIfAborted(options.signal);
  return buildContextPackFromFiles(files, options);
}
