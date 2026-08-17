// 选区几何换算。刻意与 pdfjs 分开：这两个函数是纯计算，
// 放在一起会让测试为了它们去 import 整个 pdf.js（在 node 环境下直接报错）。
import type { ExcerptRect } from './session/types';

/**
 * 把选区矩形换算成页内归一化坐标。
 * 存归一化值而不是像素：换个窗口宽度或缩放级别后高亮依然对得上。
 */
export function toNormalizedRects(clientRects: DOMRect[], pageBox: DOMRect): ExcerptRect[] {
  if (pageBox.width <= 0 || pageBox.height <= 0) return [];
  return clientRects
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x: (rect.left - pageBox.left) / pageBox.width,
      y: (rect.top - pageBox.top) / pageBox.height,
      w: rect.width / pageBox.width,
      h: rect.height / pageBox.height,
    }));
}

/** 归一化矩形还原成当前尺寸下的百分比样式值。 */
export function toPercentStyle(rect: ExcerptRect) {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}
