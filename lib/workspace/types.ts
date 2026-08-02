import type { AnalysisMode, ProjectStats } from '../material/types';

export interface WorkspaceFile {
  workspaceId: string;
  path: string;
  content: string;
  size: number;
  language: string;
  modifiedAt?: number;
  fingerprint: string;
}

export interface WorkspaceRecord {
  id: string;
  mode: Exclude<AnalysisMode, 'paper'>;
  title: string;
  source: string;
  version: string;
  createdAt: number;
  stats: ProjectStats;
  writable: boolean;
  rootHandle?: FileSystemDirectoryHandle;
}

export interface WorkspaceBuildLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxArchiveBytes: number;
  ignorePatterns: string[];
}

export interface WorkspaceCandidate {
  path: string;
  content: string;
  size?: number;
  modifiedAt?: number;
}

export interface WorkspaceBuildResult {
  workspace: WorkspaceRecord;
  files: WorkspaceFile[];
  excluded: { path: string; reason: string; size: number }[];
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}
