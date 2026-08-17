import { useEffect, useState } from 'react';
import {
  clearReaderDocument,
  getReaderDocument,
  type ReaderDocument,
} from '@/lib/extension-windows';
import { MarkdownLite } from '@/entrypoints/sidepanel/MarkdownLite';
import { IconClose } from '@/entrypoints/sidepanel/icons';
import { browser } from 'wxt/browser';
import { ParallelView } from './ParallelView';

function readIdFromLocation() {
  return new URLSearchParams(window.location.search).get('id')?.trim() || '';
}

/** 对照视图直接按会话读数据，不走 storage.session 的临时载荷。 */
function readParallelSession() {
  const params = new URLSearchParams(window.location.search);
  return params.get('view') === 'parallel' ? params.get('session')?.trim() || '' : '';
}

export default function App() {
  const parallelSessionId = readParallelSession();
  if (parallelSessionId) return <ParallelView sessionId={parallelSessionId} />;
  return <DocumentView />;
}

function DocumentView() {
  const [doc, setDoc] = useState<ReaderDocument | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [decision, setDecision] = useState<'idle' | 'sending' | 'error'>('idle');
  const [decisionError, setDecisionError] = useState('');
  const id = readIdFromLocation();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) {
        if (!cancelled) setStatus('missing');
        return;
      }
      const next = await getReaderDocument(id);
      if (cancelled) return;
      if (!next) {
        setStatus('missing');
        return;
      }
      setDoc(next);
      setStatus('ready');
      document.title = `${next.title || '材料分析'} · ${next.kind === 'patch' ? 'Diff 审阅' : '沉浸阅读'}`;
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const cleanup = () => {
      void clearReaderDocument(id);
    };
    window.addEventListener('pagehide', cleanup);
    return () => window.removeEventListener('pagehide', cleanup);
  }, [id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') window.close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function decidePatch(accepted: boolean) {
    if (!doc?.patchId) return;
    setDecision('sending');
    setDecisionError('');
    try {
      const response = await browser.runtime.sendMessage({
        type: 'local-patch-decision',
        patchId: doc.patchId,
        accepted,
      }) as { ok?: boolean; error?: string } | undefined;
      if (!response?.ok) throw new Error(response?.error || '侧栏未响应，请保持侧栏打开后重试。');
      window.close();
    } catch (error) {
      setDecision('error');
      setDecisionError((error as Error).message);
    }
  }

  if (status === 'loading') {
    return (
      <div className="reader-shell">
        <div className="reader-empty">
          <p className="reader-empty-title">正在展开书页…</p>
        </div>
      </div>
    );
  }

  if (status === 'missing' || !doc) {
    return (
      <div className="reader-shell">
        <div className="reader-empty">
          <p className="reader-kicker">内容已失效</p>
          <h1 className="reader-empty-title">请回侧栏重新放大阅读</h1>
          <p className="reader-empty-hint">
            临时书页只在本次会话中保留。关闭窗口后会自动清理，也可直接关闭本窗口。
          </p>
          <button type="button" className="reader-primary" onClick={() => window.close()}>
            关闭窗口
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="reader-shell">
      <header className="reader-head">
        <div className="reader-head-copy">
          <p className="reader-kicker">{doc.kind === 'patch' ? 'DIFF 审 阅' : '沉 浸 阅 读'}</p>
          <h1>{doc.title || '材料分析'}</h1>
          {doc.source ? <p className="reader-source">{doc.source}</p> : null}
        </div>
        <button
          type="button"
          className="reader-close"
          aria-label="关闭沉浸阅读"
          title="关闭"
          onClick={() => window.close()}
        >
          <IconClose size={20} />
        </button>
      </header>
      <main className={doc.kind === 'patch' ? 'reader-paper patch-mode' : 'reader-paper'}>
        <article className="reader-folio">
          {doc.kind === 'patch' ? <pre className="reader-diff">{doc.content}</pre> : <MarkdownLite text={doc.content} />}
        </article>
        {doc.kind === 'patch' && (
          <div className="patch-actions">
            <div>
              <strong>写入前最后确认</strong>
              <span>确认时会重新校验源文件版本与目录权限。</span>
              {decisionError ? <span className="patch-error">{decisionError}</span> : null}
            </div>
            <button type="button" disabled={decision === 'sending'} onClick={() => void decidePatch(false)}>
              拒绝
            </button>
            <button className="reader-primary" type="button" disabled={decision === 'sending'} onClick={() => void decidePatch(true)}>
              {decision === 'sending' ? '处理中…' : '确认写入'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
