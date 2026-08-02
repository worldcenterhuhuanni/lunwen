// 居中扩展窗口与阅读页临时载荷：侧栏无法覆盖浏览器主视口，
// 因此设置与放大阅读统一走 windows.create popup。
import { browser } from 'wxt/browser';
import type { CandidatePatch } from './patch/local-patch';

export type ReaderDocument = {
  id: string;
  kind?: 'reader' | 'patch';
  patchId?: string;
  title: string;
  source?: string;
  content: string;
  createdAt: number;
};

type PopupSize = { width: number; height: number };

const SETTINGS_SIZE: PopupSize = { width: 1100, height: 860 };
const READER_SIZE: PopupSize = { width: 1180, height: 900 };

function readerStorageKey(id: string) {
  return `reader:${id}`;
}

/** 扩展页 URL；PublicPath 在新入口首次生成类型前可能滞后，故做窄转。 */
function extensionPageUrl(pathWithQuery: `/${string}`) {
  return browser.runtime.getURL(pathWithQuery as '/options.html');
}

/** 按当前浏览器窗口居中，并限制在可用尺寸内。 */
export async function openCenteredPopup(pathWithQuery: `/${string}`, size: PopupSize) {
  const current = await browser.windows.getCurrent();
  const availW = Math.max(480, current.width ?? size.width);
  const availH = Math.max(420, current.height ?? size.height);
  const width = Math.min(size.width, availW - 24);
  const height = Math.min(size.height, availH - 24);
  const left = Math.round((current.left ?? 0) + (availW - width) / 2);
  const top = Math.round((current.top ?? 0) + (availH - height) / 2);

  return browser.windows.create({
    url: extensionPageUrl(pathWithQuery),
    type: 'popup',
    width,
    height,
    left,
    top,
    focused: true,
  });
}

/** 打开大尺寸设置窗；失败时回退到浏览器默认 options 页。 */
export async function openSettingsWindow() {
  try {
    await openCenteredPopup('/options.html', SETTINGS_SIZE);
  } catch (error) {
    console.error('打开设置窗口失败，回退 openOptionsPage', error);
    await browser.runtime.openOptionsPage();
  }
}

/** 写入 session 载荷并打开独立阅读窗。 */
export async function openReaderWindow(doc: {
  title: string;
  source?: string;
  content: string;
}) {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const payload: ReaderDocument = {
    id,
    kind: 'reader',
    title: doc.title,
    source: doc.source,
    content: doc.content,
    createdAt: Date.now(),
  };

  await browser.storage.session.set({ [readerStorageKey(id)]: payload });
  await openCenteredPopup(
    `/reader.html?id=${encodeURIComponent(id)}`,
    READER_SIZE,
  );
  return id;
}

/** 在独立大窗中审阅候选 diff，确认结果通过 runtime message 返回侧栏。 */
export async function openPatchReviewWindow(patch: CandidatePatch) {
  const id = crypto.randomUUID();
  const payload: ReaderDocument = {
    id,
    kind: 'patch',
    patchId: patch.id,
    title: patch.path,
    source: '候选修改 · 尚未写入',
    content: patch.diff,
    createdAt: Date.now(),
  };
  await browser.storage.session.set({ [readerStorageKey(id)]: payload });
  await openCenteredPopup(`/reader.html?id=${encodeURIComponent(id)}`, READER_SIZE);
  return id;
}

export async function getReaderDocument(id: string): Promise<ReaderDocument | null> {
  const key = readerStorageKey(id);
  const result = await browser.storage.session.get(key);
  const value = result[key];
  if (!value || typeof value !== 'object') return null;
  const doc = value as ReaderDocument;
  if (!doc.content) return null;
  return doc;
}

export async function clearReaderDocument(id: string) {
  await browser.storage.session.remove(readerStorageKey(id));
}
