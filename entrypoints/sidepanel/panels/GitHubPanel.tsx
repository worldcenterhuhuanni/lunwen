import { useState } from 'react';
import type { Material } from '@/lib/material/types';
import { importGitHubRepository } from '@/lib/sources/github/client';
import type { WorkspaceBuildLimits } from '@/lib/workspace/types';
import { IconLink } from '../icons';

interface Props {
  busy: boolean;
  limits: WorkspaceBuildLimits;
  onProgress: (message: string) => void;
  importProject: (getMaterial: (signal: AbortSignal) => Promise<Material>) => void;
}

export function GitHubPanel({ busy, limits, onProgress, importProject }: Props) {
  const [url, setUrl] = useState('');

  const submit = () => {
    if (!url.trim()) return;
    importProject((signal) => importGitHubRepository(url.trim(), limits, onProgress, signal));
  };

  return (
    <div className="project-connect">
      <p className="connect-title">公开仓库源码</p>
      <p className="connect-hint">读取默认分支全部合规文本源码，建立本地索引后再按需检索。同一提交已索引过会直接复用。</p>
      <div className="url-row">
        <span className="url-icon">
          <IconLink size={16} />
        </span>
        <input
          className="url-input"
          placeholder="https://github.com/owner/repo"
          value={url}
          disabled={busy}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="ghost" disabled={busy || !url.trim()} onClick={submit}>
          索引
        </button>
      </div>
    </div>
  );
}
