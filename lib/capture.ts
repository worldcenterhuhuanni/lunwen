// 划词解读的交接口。
// 不用 sendMessage 直传:触发时侧栏可能还没打开,没有接收方消息就丢了。
// 落到 session 存储,让「侧栏冷启动」和「侧栏已在运行」走同一条消费路径。
import { storage } from '#imports';

export const CAPTURE_MENU_ID = 'lunwen-explain-selection';

export interface PendingCapture {
  text: string;
  /** 来源页面地址,用作材料 source */
  source: string;
  title: string;
  at: number;
}

export const pendingCaptureItem = storage.defineItem<PendingCapture | null>(
  'session:pendingCapture',
  { fallback: null },
);

/** 读取并立即清除:同一次划词只会被解读一次。 */
export async function takePendingCapture(): Promise<PendingCapture | null> {
  const value = await pendingCaptureItem.getValue();
  if (value) await pendingCaptureItem.removeValue();
  return value;
}

export const watchPendingCapture = (cb: (value: PendingCapture | null) => void) =>
  pendingCaptureItem.watch(cb);
