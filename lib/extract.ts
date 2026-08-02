// 论文获取:PDF 线与 HTML 线严格分开。
// 网页模式「解读当前页面」:优先找页面上的 PDF 下载入口 → 下载字节 → 上传 DeepSeek,
// 找不到下载才走 HTML 抽正文。不做无意义的「先抽 PDF 全文再粘贴」。
import { browser } from 'wxt/browser';
import { Readability } from '@mozilla/readability';
import { assertPdfBytes } from './bytes';
import { extractPdfText } from './pdf';
import type { PaperMaterial, PdfAttachment } from './material/types';

export type PaperKind = 'pdf' | 'html';
export type { PdfAttachment } from './material/types';
/** 兼容现有论文管线；新代码统一使用 Material。 */
export type Paper = PaperMaterial;

export interface ExtractOptions {
  /** 网页上传时跳过 pdf.js 抽全文 */
  skipPdfText?: boolean;
  /**
   * 网页模式读当前页:优先解析「下载 PDF」链接并走 PDF 线。
   * 找不到下载入口才回退 HTML。
   */
  preferPdfDownload?: boolean;
}

const MAX_PDF_BYTES = 40 * 1024 * 1024;

export function isPdfUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (path.endsWith('.pdf')) return true;
    if (/(?:^|\.)arxiv\.org$/i.test(u.hostname) && /^\/pdf\/[^/]+$/i.test(u.pathname)) {
      return true;
    }
    return false;
  } catch {
    return url.toLowerCase().split(/[?#]/)[0].endsWith('.pdf');
  }
}

function pdfFileName(url: string): string {
  const raw = decodeURIComponent(url.split('/').pop() || 'paper.pdf');
  return raw.toLowerCase().endsWith('.pdf') ? raw : `${raw}.pdf`;
}

/** 在页面 DOM 里找「下载 PDF」入口(注入到标签页执行)。 */
export function findPdfDownloadUrlInPage(): string | null {
  try {
    const host = location.hostname;
    const path = location.pathname;

    // 已经在 PDF 地址
    if (/\.pdf$/i.test(path.split('?')[0]) || (/arxiv\.org$/i.test(host) && /^\/pdf\//i.test(path))) {
      return location.href.split('#')[0];
    }

    // arXiv abs / html → 规范 pdf
    if (/arxiv\.org$/i.test(host)) {
      const m = path.match(/^\/(?:abs|html|pdf)\/([^/?#]+)/i);
      if (m) return `https://arxiv.org/pdf/${m[1]}`;
    }

    type Cand = { href: string; score: number };
    const cands: Cand[] = [];
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const href = (a as HTMLAnchorElement).href;
      if (!href || href.startsWith('javascript:')) continue;
      const label = `${a.textContent || ''} ${a.getAttribute('aria-label') || ''} ${a.getAttribute('title') || ''}`;
      let score = 0;
      if (/\.pdf(\?|#|$)/i.test(href)) score += 6;
      if (/\/pdf\//i.test(href)) score += 5;
      if (/download|下载/i.test(label) && /pdf/i.test(label + href)) score += 4;
      if (/^pdf$/i.test((a.textContent || '').trim())) score += 3;
      if (score > 0) cands.push({ href, score });
    }
    cands.sort((x, y) => y.score - x.score);
    return cands[0]?.href ?? null;
  } catch {
    return null;
  }
}

// ── HTML 线 ──────────────────────────────────────────────

export function extractFromHtml(html: string, url: string): Paper {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const article = new Readability(doc).parse();
  const text = (article?.textContent || doc.body?.textContent || '').trim();
  return {
    mode: 'paper',
    kind: 'html',
    title: (article?.title || doc.title || url).trim(),
    text,
    source: url,
  };
}

export function extractFromPlainText(text: string): Paper {
  const body = text.trim();
  if (!body) throw new Error('请先粘贴要解读的文字。');
  const title = body.replace(/\s+/g, ' ').slice(0, 48) + (body.length > 48 ? '…' : '');
  return {
    mode: 'paper',
    kind: 'html',
    title: title || '粘贴文本',
    text: body,
    source: 'clipboard:paste',
  };
}

async function extractHtmlFromUrl(url: string, opts?: ExtractOptions): Promise<Paper> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`抓取失败 (${res.status}) — 检查链接是否可公开访问。`);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('pdf')) {
    return extractPdfFromResponse(url, await res.arrayBuffer(), opts);
  }
  return extractFromHtml(await res.text(), url);
}

// ── PDF 线:下载字节(+可选抽文本给 API) ───────────────────

async function extractPdfFromResponse(
  url: string,
  data: ArrayBuffer,
  opts?: ExtractOptions,
): Promise<Paper> {
  if (data.byteLength > MAX_PDF_BYTES) {
    throw new Error(`PDF 过大(${Math.round(data.byteLength / 1024 / 1024)}MB),超过 ${MAX_PDF_BYTES / 1024 / 1024}MB。`);
  }
  // 必须是真 PDF:以前 Port 传丢 ArrayBuffer 时会出现 15B 的 "[object Object]"
  assertPdfBytes(data, '下载的文件');

  const pdf: PdfAttachment = {
    name: pdfFileName(url),
    mime: 'application/pdf',
    data,
  };

  let text = '';
  let title = pdf.name.replace(/\.pdf$/i, '');

  if (!opts?.skipPdfText) {
    try {
      text = await extractPdfText(data.slice(0));
      const first = text.split('\n').map((s) => s.trim()).find((s) => s.length > 8);
      if (first) title = first.slice(0, 120);
    } catch {
      /* 网页上传不依赖文本 */
    }
  }

  return { mode: 'paper', kind: 'pdf', title, text, source: url, pdf };
}

async function extractPdfFromUrl(url: string, opts?: ExtractOptions): Promise<Paper> {
  const res = await fetch(url, {
    headers: { Accept: 'application/pdf,*/*' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`下载 PDF 失败 (${res.status})`);
  const ct = res.headers.get('content-type') || '';
  const data = await res.arrayBuffer();
  // 有些站点 Content-Type 不准,以魔数为准;若明显是 HTML 直接报错
  if (ct.includes('text/html') && data.byteLength < 50_000) {
    const sniff = new TextDecoder().decode(data.slice(0, 200));
    if (/<html|<\!doctype/i.test(sniff)) {
      throw new Error('下载到的是网页而不是 PDF(可能被反爬拦截)。请换 PDF 直链或侧栏「上传 PDF」。');
    }
  }
  return extractPdfFromResponse(url, data, opts);
}

export async function extractFromPdfFile(file: File, opts?: ExtractOptions): Promise<Paper> {
  if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('请选择 PDF 文件。');
  }
  const data = await file.arrayBuffer();
  if (data.byteLength > MAX_PDF_BYTES) {
    throw new Error(`PDF 过大,请选小于 ${MAX_PDF_BYTES / 1024 / 1024}MB 的文件。`);
  }
  const paper = await extractPdfFromResponse(`local:${file.name}`, data, opts);
  return { ...paper, title: file.name.replace(/\.pdf$/i, '') || paper.title };
}

export async function extractFromUrl(url: string, opts?: ExtractOptions): Promise<Paper> {
  if (isPdfUrl(url)) return extractPdfFromUrl(url, opts);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`抓取失败 (${res.status}) — 检查链接是否可公开访问。`);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('pdf')) return extractPdfFromResponse(url, await res.arrayBuffer(), opts);
  return extractFromHtml(await res.text(), url);
}

/**
 * 当前标签页。
 * preferPdfDownload=true(网页模式)时:先找下载 PDF 链接并下载上传,不抽页面正文。
 */
export async function extractFromActiveTab(opts?: ExtractOptions): Promise<Paper> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url;
  if (!tab?.id || !url) throw new Error('无法获取当前标签页。');
  if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:')) {
    throw new Error('这是浏览器内部页面,无法读取。请打开论文页面后重试。');
  }

  // 地址本身就是 PDF
  if (isPdfUrl(url)) {
    if (url.startsWith('file:')) {
      throw new Error('本地 PDF 请用侧栏「上传 PDF」,或在扩展详情开启「允许访问文件网址」。');
    }
    return extractPdfFromUrl(url, opts);
  }

  // 网页模式:优先找「下载 PDF」再下载(扩展侧 fetch,有 host_permissions)
  if (opts?.preferPdfDownload && !url.startsWith('file:')) {
    let pdfUrl: string | null = null;
    try {
      const [inj] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: findPdfDownloadUrlInPage,
      });
      pdfUrl = (inj?.result as string | null | undefined) ?? null;
    } catch {
      pdfUrl = null;
    }
    // 注入失败时,仍可用 URL 规则猜 arxiv
    if (!pdfUrl) {
      try {
        const u = new URL(url);
        if (/(?:^|\.)arxiv\.org$/i.test(u.hostname)) {
          const m = u.pathname.match(/^\/(?:abs|html|pdf)\/([^/?#]+)/i);
          if (m) pdfUrl = `https://arxiv.org/pdf/${m[1]}`;
        }
      } catch {
        /* ignore */
      }
    }
    if (pdfUrl) {
      return extractPdfFromUrl(pdfUrl, { ...opts, skipPdfText: true });
    }
  }

  // HTML 线
  try {
    const [inj] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        html: document.documentElement.outerHTML,
        href: location.href,
      }),
    });
    const result = inj?.result as { html: string; href: string } | undefined;
    if (result?.html) {
      const paper = extractFromHtml(result.html, result.href);
      if (paper.text) return paper;
    }
  } catch {
    /* 回退 */
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return extractHtmlFromUrl(url, opts);
  }
  throw new Error('无法读取此页面内容(可能被网站限制)。');
}
