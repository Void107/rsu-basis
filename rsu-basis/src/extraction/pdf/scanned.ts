// 扫描件检测（docs/03 §2、docs/05 F2）。
// 无文本层 → 不支持，走 L2 手工补录，【绝不 OCR】。
// 检测：整页 items 为空，或有效文本占比异常低（阈值 MIN_CHARS_PER_PAGE）。
// 整份文档没有任何含文本的页 → isScanned=true（HARD，F2）。
import type { PageText, ScanReport } from './types.js';

// 单页有效字符低于此值视为无文本层（吸收仅有水印/页码噪声的图片页）。
export const MIN_CHARS_PER_PAGE = 8;

export function detectScanned(pages: PageText[]): ScanReport {
  const textlessPages: number[] = [];
  let textPageCount = 0;
  for (const pg of pages) {
    const chars = pg.items.reduce((n, it) => n + it.str.trim().length, 0);
    if (pg.items.length === 0 || chars < MIN_CHARS_PER_PAGE) {
      textlessPages.push(pg.page);
    } else {
      textPageCount++;
    }
  }
  return {
    pageCount: pages.length,
    textPageCount,
    textlessPages,
    // 全份无文本层才判定为扫描件（补充表可能只在某几页；部分图片页交由后续适配器处理）。
    isScanned: pages.length > 0 && textPageCount === 0,
  };
}
