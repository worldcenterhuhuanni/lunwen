export type AnalysisMode = 'paper' | 'github' | 'local';
export type MaterialKind = 'pdf' | 'html' | 'github' | 'local';

export interface PdfAttachment {
  name: string;
  mime: string;
  data: ArrayBuffer;
}

export interface ProjectStats {
  indexedFiles: number;
  indexedBytes: number;
  excludedFiles: number;
  excludedBytes: number;
  languages: Record<string, number>;
}

export interface Material {
  mode: AnalysisMode;
  kind: MaterialKind;
  title: string;
  text: string;
  source: string;
  pdf?: PdfAttachment;
  workspaceId?: string;
  version?: string;
  stats?: ProjectStats;
  writable?: boolean;
}

export type PaperMaterial = Material & {
  mode: 'paper';
  kind: 'pdf' | 'html';
};

export function materialModeLabel(mode: AnalysisMode): string {
  if (mode === 'github') return 'GitHub 项目';
  if (mode === 'local') return '本地工作区';
  return '论文';
}
