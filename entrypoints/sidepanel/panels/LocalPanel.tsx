import { useRef } from 'react';
import type { Material } from '@/lib/material/types';
import {
  importLocalDirectory,
  importLocalFileList,
  supportsDirectoryPicker,
} from '@/lib/sources/local/client';
import type { WorkspaceBuildLimits } from '@/lib/workspace/types';
import { IconUpload } from '../icons';

interface Props {
  busy: boolean;
  limits: WorkspaceBuildLimits;
  onProgress: (message: string) => void;
  importProject: (getMaterial: (signal: AbortSignal) => Promise<Material>) => void;
}

export function LocalPanel({ busy, limits, onProgress, importProject }: Props) {
  const folderRef = useRef<HTMLInputElement>(null);

  const pickDirectory = () => {
    if (supportsDirectoryPicker()) {
      importProject((signal) => importLocalDirectory(limits, onProgress, signal));
      return;
    }
    folderRef.current?.click();
  };

  const onPickFolder = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    importProject((signal) => importLocalFileList(fileList, limits, onProgress, signal));
    if (folderRef.current) folderRef.current.value = '';
  };

  return (
    <div className="project-connect">
      <p className="connect-title">授权一个本地工作区</p>
      <p className="connect-hint">Chrome 可在 diff 确认后写回；不支持目录句柄的浏览器将只读导入。</p>
      <button className="primary" disabled={busy} onClick={pickDirectory}>
        <IconUpload size={16} />
        选择本地文件夹
      </button>
      <input
        ref={folderRef}
        type="file"
        hidden
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => onPickFolder(e.target.files)}
      />
    </div>
  );
}
