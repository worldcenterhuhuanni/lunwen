import { useRef, useState } from 'react';
import {
  extractFromActiveTab,
  extractFromPdfFile,
  extractFromPlainText,
  extractFromUrl,
  type Paper,
} from '@/lib/extract';
import { IconChevron, IconLink, IconPage, IconUpload } from '../icons';

interface Props {
  busy: boolean;
  extracting: boolean;
  webMode: boolean;
  readWith: (getPaper: () => Promise<Paper>) => void;
}

export function PaperPanel({ busy, extracting, webMode, readWith }: Props) {
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 网页模式优先下载页面 PDF 上传，而不是先抽全文再粘贴。
  const webOpts = { skipPdfText: webMode, preferPdfDownload: webMode } as const;

  const submitUrl = () => {
    if (url.trim()) readWith(() => extractFromUrl(url.trim(), webOpts));
  };
  const submitPaste = () => {
    if (!paste.trim()) return;
    setPasteOpen(false);
    readWith(async () => extractFromPlainText(paste));
  };
  const onPickPdf = (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    readWith(() => extractFromPdfFile(file, webOpts));
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <>
      <button className="primary" disabled={busy} onClick={() => readWith(() => extractFromActiveTab(webOpts))}>
        <IconPage size={16} />
        {extracting ? '正在准备…' : '解读当前页面'}
      </button>
      <div className="btn-row">
        <button className="ghost grow" disabled={busy} onClick={() => fileRef.current?.click()}>
          <IconUpload size={16} />
          上传 PDF
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => onPickPdf(e.target.files)}
        />
      </div>
      <div className="url-row">
        <span className="url-icon">
          <IconLink size={16} />
        </span>
        <input
          className="url-input"
          placeholder="粘贴链接:网页=HTML 线 / PDF 链接=PDF 线"
          value={url}
          disabled={busy}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitUrl()}
        />
        <button className="ghost" disabled={busy || !url.trim()} onClick={submitUrl}>
          解读
        </button>
      </div>
      <div className={pasteOpen ? 'paste-drawer open' : 'paste-drawer'}>
        <button
          type="button"
          className="paste-drawer-toggle"
          aria-expanded={pasteOpen}
          onClick={() => setPasteOpen((open) => !open)}
        >
          <span>
            <strong>粘贴文字</strong>
            <small>{paste ? `已输入 ${paste.length} 字` : '摘要、论文片段或任意材料'}</small>
          </span>
          <IconChevron size={16} />
        </button>
        {pasteOpen && (
          <div className="paste-drawer-body">
            <textarea
              className="paste-input"
              placeholder="粘贴文字后按当前模板解读…"
              value={paste}
              disabled={busy}
              rows={5}
              autoFocus
              onChange={(e) => setPaste(e.target.value)}
            />
            <div className="paste-drawer-foot">
              <span>{paste.length.toLocaleString()} 字</span>
              <button className="ghost" disabled={busy || !paste.trim()} onClick={submitPaste}>
                解读这段
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
