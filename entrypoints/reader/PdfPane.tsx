import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPdfDocument, renderPdfPage, type PdfDocument } from '@/lib/pdf-render';
import { toNormalizedRects, toPercentStyle } from '@/lib/excerpt-geometry';
import type { Excerpt } from '@/lib/session/types';

interface Props {
  data: ArrayBuffer;
  excerpts: Excerpt[];
  activeExcerptId: string | null;
  /** 用户选中一段原文后浮出提问入口 */
  onSelect: (draft: { text: string; page: number; rects: Excerpt['rects'] }) => void;
  onPickExcerpt: (excerptId: string) => void;
  /** 外部要求滚动到某个片段（点分析卡片时） */
  scrollToExcerpt: Excerpt | null;
}

/** 渲染视口前后各一屏，滚出去的页释放 canvas，几百页也不会吃满内存。 */
const RENDER_MARGIN = '150% 0px';

export function PdfPane({
  data,
  excerpts,
  activeExcerptId,
  onSelect,
  onPickExcerpt,
  scrollToExcerpt,
}: Props) {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.35);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: { destroy: () => Promise<void> } | null = null;
    setError(null);
    loadPdfDocument(data)
      .then((next) => {
        if (cancelled) {
          void next.destroy();
          return;
        }
        loaded = next;
        setDoc(next.doc);
        setPageCount(next.doc.numPages);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || '无法打开这个 PDF。');
      });
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [data]);

  // 选中文字后把选区换算成归一化矩形；跨页选择只取起始页，够用且不会产生错位高亮。
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? '';
    if (!selection || selection.rangeCount === 0 || text.length < 2) return;
    const range = selection.getRangeAt(0);
    const startEl =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const pageEl = startEl?.closest('[data-page]') as HTMLElement | null;
    if (!pageEl) return;
    const page = Number(pageEl.dataset.page);
    if (!page) return;
    const rects = toNormalizedRects(
      Array.from(range.getClientRects()),
      pageEl.getBoundingClientRect(),
    );
    onSelect({ text, page, rects });
  }, [onSelect]);

  useEffect(() => {
    if (!scrollToExcerpt?.page) return;
    const target = scrollRef.current?.querySelector(`[data-page="${scrollToExcerpt.page}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [scrollToExcerpt]);

  if (error) {
    return (
      <div className="pane-empty">
        <p className="pane-empty-title">这个 PDF 打不开</p>
        <p className="pane-empty-hint">{error}</p>
      </div>
    );
  }

  return (
    <div className="pdf-pane">
      <div className="pdf-toolbar">
        <span>{pageCount ? `${pageCount} 页` : '正在打开…'}</span>
        <div className="pdf-zoom">
          <button type="button" onClick={() => setScale((s) => Math.max(0.6, s - 0.15))} aria-label="缩小">
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => setScale((s) => Math.min(3, s + 0.15))} aria-label="放大">
            ＋
          </button>
        </div>
      </div>
      <div className="pdf-scroll" ref={scrollRef} onMouseUp={handleMouseUp}>
        {doc &&
          Array.from({ length: pageCount }, (_, index) => (
            <PdfPageView
              key={index + 1}
              doc={doc}
              pageNumber={index + 1}
              scale={scale}
              excerpts={excerpts.filter((item) => item.page === index + 1)}
              activeExcerptId={activeExcerptId}
              onPickExcerpt={onPickExcerpt}
            />
          ))}
      </div>
    </div>
  );
}

function PdfPageView({
  doc,
  pageNumber,
  scale,
  excerpts,
  activeExcerptId,
  onPickExcerpt,
}: {
  doc: PdfDocument;
  pageNumber: number;
  scale: number;
  excerpts: Excerpt[];
  activeExcerptId: string | null;
  onPickExcerpt: (excerptId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { root: null, rootMargin: RENDER_MARGIN },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let cancelRender: (() => void) | null = null;
    void (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled || !canvasRef.current || !textRef.current) return;
      try {
        const rendered = await renderPdfPage(page, canvasRef.current, textRef.current, scale);
        if (cancelled) {
          rendered.cancel();
          return;
        }
        cancelRender = rendered.cancel;
        setSize({ width: rendered.width, height: rendered.height });
      } catch (e) {
        // 取消渲染会抛异常，属于正常路径，不打扰用户。
        if (!cancelled) console.debug('页面渲染中断', e);
      }
    })();
    return () => {
      cancelled = true;
      cancelRender?.();
    };
  }, [doc, pageNumber, scale, visible]);

  return (
    <div
      className="pdf-page"
      data-page={pageNumber}
      ref={hostRef}
      style={size ? { width: size.width, height: size.height } : undefined}
    >
      <canvas ref={canvasRef} />
      <div className="pdf-text-layer" ref={textRef} />
      <div className="pdf-highlights">
        {excerpts.map((excerpt) =>
          (excerpt.rects ?? []).map((rect, index) => (
            <button
              key={`${excerpt.id}-${index}`}
              type="button"
              className={excerpt.id === activeExcerptId ? 'hl active' : 'hl'}
              style={toPercentStyle(rect)}
              title={excerpt.text.slice(0, 60)}
              aria-label="跳到引用这段原文的分析"
              onClick={() => onPickExcerpt(excerpt.id)}
            />
          )),
        )}
      </div>
      <span className="pdf-page-no">{pageNumber}</span>
    </div>
  );
}
