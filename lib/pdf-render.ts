// 对照阅读的 PDF 渲染:canvas 画版面 + TextLayer 铺一层透明文字。
// 文字层是关键 —— 有了它浏览器原生选中就能直接用,不需要自己实现选区命中。
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
export type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;

export interface LoadedPdf {
  doc: PdfDocument;
  /** 释放 worker 与网络资源；destroy 挂在 loading task 上，不在文档对象上。 */
  destroy: () => Promise<void>;
}

export async function loadPdfDocument(data: ArrayBuffer): Promise<LoadedPdf> {
  // pdf.js 会接管并分离这个 ArrayBuffer，传副本以免调用方持有的引用失效。
  const task = pdfjs.getDocument({ data: data.slice(0) });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

export interface RenderedPage {
  width: number;
  height: number;
  cancel: () => void;
}

/**
 * 把一页画进 canvas 并在 textLayer 容器里铺好文字层。
 * 返回 CSS 像素尺寸，供外层容器定高。
 */
export async function renderPdfPage(
  page: PdfPage,
  canvas: HTMLCanvasElement,
  textLayer: HTMLElement,
  scale: number,
): Promise<RenderedPage> {
  const viewport = page.getViewport({ scale });
  const outputScale = window.devicePixelRatio || 1;

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法获取 canvas 绘图上下文。');

  const task = page.render({
    canvasContext: context,
    transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
    viewport,
  } as Parameters<PdfPage['render']>[0]);

  textLayer.replaceChildren();
  const layer = new pdfjs.TextLayer({
    textContentSource: await page.getTextContent(),
    container: textLayer,
    viewport,
  });

  await Promise.all([task.promise, layer.render()]);

  return {
    width: viewport.width,
    height: viewport.height,
    cancel: () => {
      task.cancel();
      layer.cancel();
    },
  };
}
