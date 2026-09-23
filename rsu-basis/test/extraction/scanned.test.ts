// 扫描件检测（docs/03 §2、docs/05 F2）。无文本层 → 不支持，绝不 OCR。
import { describe, it, expect } from 'vitest';
import { detectScanned, type PageText } from '../../src/extraction/pdf/index.js';

const textPage = (page: number): PageText => ({
  page,
  width: 612,
  height: 792,
  items: [{ str: 'Ordinary Income Reported', x: 50, y: 700, width: 140, height: 10 }],
});
const emptyPage = (page: number): PageText => ({ page, width: 612, height: 792, items: [] });

describe('detectScanned', () => {
  it('所有页无文本层 → isScanned=true（HARD，走 L2，不 OCR）', () => {
    const r = detectScanned([emptyPage(1), emptyPage(2)]);
    expect(r.isScanned).toBe(true);
    expect(r.textPageCount).toBe(0);
    expect(r.textlessPages).toEqual([1, 2]);
  });

  it('有文本页 → isScanned=false，仅记录无文本页', () => {
    const r = detectScanned([textPage(1), emptyPage(2), textPage(3)]);
    expect(r.isScanned).toBe(false);
    expect(r.textPageCount).toBe(2);
    expect(r.textlessPages).toEqual([2]);
  });

  it('有效字符过少的页按无文本层计', () => {
    const r = detectScanned([{ page: 1, width: 612, height: 792, items: [{ str: 'x', x: 0, y: 0, width: 1, height: 1 }] }]);
    expect(r.isScanned).toBe(true); // 全份仅此页且字符 < 阈值
  });
});
