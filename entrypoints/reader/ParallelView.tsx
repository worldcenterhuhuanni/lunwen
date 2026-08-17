import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownLite } from '@/entrypoints/sidepanel/MarkdownLite';
import { IconSend, IconStop } from '@/entrypoints/sidepanel/icons';
import type { Excerpt } from '@/lib/session/types';
import { PdfPane } from './PdfPane';
import { useReaderAnalysis } from './useReaderAnalysis';

type Draft = { text: string; page: number; rects: Excerpt['rects'] };

export function ParallelView({ sessionId }: { sessionId: string }) {
  const a = useReaderAnalysis(sessionId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [question, setQuestion] = useState('');
  const [activeExcerptId, setActiveExcerptId] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<Excerpt | null>(null);
  /** 左栏宽度百分比，拖动分隔条调整 */
  const [split, setSplit] = useState(52);
  const analysisRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLTextAreaElement>(null);

  const busy = a.status === 'streaming';
  const excerptById = useMemo(
    () => new Map(a.excerpts.map((item) => [item.id, item])),
    [a.excerpts],
  );

  useEffect(() => {
    analysisRef.current?.scrollTo({
      top: analysisRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [a.turns]);

  // 从原文高亮跳到引用它的那条分析。
  const pickExcerpt = useCallback((excerptId: string) => {
    setActiveExcerptId(excerptId);
    const node = analysisRef.current?.querySelector(`[data-excerpt="${excerptId}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // 从分析卡片跳回原文并高亮。
  const locateExcerpt = useCallback(
    (excerptId: string) => {
      const excerpt = excerptById.get(excerptId);
      if (!excerpt) return;
      setActiveExcerptId(excerptId);
      setScrollTarget(excerpt);
    },
    [excerptById],
  );

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const move = (e: PointerEvent) => {
      const next = (e.clientX / window.innerWidth) * 100;
      setSplit(Math.min(75, Math.max(25, next)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  function submit() {
    const text = question.trim();
    if (!text || busy) return;
    const excerpt: Excerpt | null = draft
      ? { id: crypto.randomUUID(), text: draft.text, page: draft.page, rects: draft.rects }
      : null;
    if (excerpt) setActiveExcerptId(excerpt.id);
    setQuestion('');
    setDraft(null);
    void a.ask(excerpt, text);
  }

  if (a.status === 'loading') {
    return (
      <div className="pane-empty">
        <p className="pane-empty-title">正在展开原文…</p>
      </div>
    );
  }

  if (a.status === 'missing' || !a.session) {
    return (
      <div className="pane-empty">
        <p className="pane-empty-title">这次对照阅读的内容已失效</p>
        <p className="pane-empty-hint">请回侧栏重新打开这篇材料。</p>
        <button type="button" className="reader-primary" onClick={() => window.close()}>
          关闭
        </button>
      </div>
    );
  }

  const material = a.session.material;

  return (
    <div className="parallel">
      <header className="parallel-head">
        <div>
          <p className="reader-kicker">原 文 对 照</p>
          <h1>{material.title}</h1>
        </div>
        {material.source?.startsWith('http') ? (
          <a className="parallel-source" href={material.source} target="_blank" rel="noreferrer">
            {material.source}
          </a>
        ) : (
          <span className="parallel-source">{material.source}</span>
        )}
      </header>

      <div className="parallel-body">
        <section className="parallel-left" style={{ width: `${split}%` }}>
          {a.pdfData ? (
            <PdfPane
              data={a.pdfData}
              excerpts={a.excerpts}
              activeExcerptId={activeExcerptId}
              onSelect={setDraft}
              onPickExcerpt={pickExcerpt}
              scrollToExcerpt={scrollTarget}
            />
          ) : (
            <TextPane
              text={material.text}
              onSelect={(text) => setDraft({ text, page: 0, rects: [] })}
            />
          )}
        </section>

        <div
          className="parallel-split"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整左右宽度"
          onPointerDown={startDrag}
        />

        <section className="parallel-right">
          <div className="analysis-scroll" ref={analysisRef}>
            {a.turns.map((turn, index) => {
              const excerpt = turn.excerptId ? excerptById.get(turn.excerptId) : undefined;
              if (turn.role === 'user') {
                return (
                  <div className="ask-bubble" key={index} data-excerpt={turn.excerptId ?? ''}>
                    {turn.content}
                  </div>
                );
              }
              return (
                <article className="tutor" key={index} data-excerpt={turn.excerptId ?? ''}>
                  {excerpt ? (
                    <button
                      type="button"
                      className="cited"
                      title="跳到原文中的这段"
                      onClick={() => locateExcerpt(excerpt.id)}
                    >
                      <small>引用{excerpt.page ? ` · 第 ${excerpt.page} 页` : ''}</small>
                      <span>{excerpt.text.slice(0, 90)}{excerpt.text.length > 90 ? '…' : ''}</span>
                    </button>
                  ) : (
                    <small className="cited-none">全文分析</small>
                  )}
                  {turn.content ? (
                    <MarkdownLite text={turn.content} streaming={busy && index === a.turns.length - 1} />
                  ) : (
                    <div className="thinking" aria-label="思考中">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {a.progress && <div className="banner warn">{a.progress}</div>}
          {a.error && <div className="banner error">{a.error}</div>}

          <div className="composer">
            {draft && (
              <div className="draft-chip">
                <small>已选中{draft.page ? ` · 第 ${draft.page} 页` : ''}</small>
                <span>{draft.text.slice(0, 70)}{draft.text.length > 70 ? '…' : ''}</span>
                <button type="button" aria-label="取消这段引用" onClick={() => setDraft(null)}>
                  ×
                </button>
              </div>
            )}
            <div className="composer-row">
              {busy && (
                <button className="icon-btn stop" title="停止" aria-label="停止" onClick={a.stop}>
                  <IconStop size={18} />
                </button>
              )}
              <textarea
                ref={askRef}
                className="ask-input"
                rows={1}
                placeholder={draft ? '就选中的这段提问，Enter 发送' : '选中左侧原文即可就它提问'}
                value={question}
                disabled={busy}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <button
                className="icon-btn send"
                title="发送"
                aria-label="发送"
                disabled={busy || !question.trim()}
                onClick={submit}
              >
                <IconSend size={18} />
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** 非 PDF 材料的兜底左栏：纯文本，同样支持选中提问。 */
function TextPane({ text, onSelect }: { text: string; onSelect: (text: string) => void }) {
  return (
    <div className="text-pane">
      <div
        className="text-pane-body"
        onMouseUp={() => {
          const value = window.getSelection()?.toString().trim() ?? '';
          if (value.length >= 2) onSelect(value);
        }}
      >
        {text.split(/\n{2,}/).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    </div>
  );
}
