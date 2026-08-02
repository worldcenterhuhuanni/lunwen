// PDF 文本提取:pdfjs-dist v6,worker 由 Vite 以 ?url 方式打包。
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdf = await pdfjs.getDocument({ data }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const pageText = tc.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ');
    parts.push(pageText);
  }
  return parts.join('\n\n').replace(/[ \t]+/g, ' ').trim();
}
