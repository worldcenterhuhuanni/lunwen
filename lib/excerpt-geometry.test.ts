import { describe, expect, it } from 'vitest';
import { toNormalizedRects, toPercentStyle } from './excerpt-geometry';

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height }) as DOMRect;

const pageBox = rect(100, 50, 800, 1000);

describe('选区矩形归一化', () => {
  it('换算成页内 0-1 坐标', () => {
    const [only] = toNormalizedRects([rect(180, 150, 400, 20)], pageBox);
    expect(only).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.02 });
  });

  it('丢掉零尺寸矩形（选区边界常带空 rect）', () => {
    const rects = toNormalizedRects([rect(180, 150, 0, 20), rect(180, 150, 400, 20)], pageBox);
    expect(rects).toHaveLength(1);
  });

  it('页面尺寸未知时返回空，不产生除零得到的 NaN', () => {
    expect(toNormalizedRects([rect(0, 0, 10, 10)], rect(0, 0, 0, 0))).toEqual([]);
  });

  it('归一化后再还原，与原始位置一致（换个页面尺寸也成立）', () => {
    const [normalized] = toNormalizedRects([rect(180, 150, 400, 20)], pageBox);
    const style = toPercentStyle(normalized);
    expect(style).toEqual({ left: '10%', top: '10%', width: '50%', height: '2%' });

    // 同一份归一化坐标套到两倍宽的页面上，落点仍是同一处相对位置。
    const doubled = rect(0, 0, 1600, 2000);
    expect(normalized.x * doubled.width).toBe(160);
    expect(normalized.y * doubled.height).toBe(200);
  });
});
