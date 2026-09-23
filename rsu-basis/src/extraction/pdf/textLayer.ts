// pdfjs 文本层抽取（docs/03 §2）。逐页取文本项 + 坐标。
//
// R8（零出网）：不配置 cMapUrl / standardFontDataUrl / worker URL，pdfjs 不会去网络取任何资源；
// 关闭 eval。输入是内存里的字节，getTextContent 不触网。
// docs/03 §6（确定性）：pdfjs 对同一文件输出确定；本层再按 (y↓, x↑, str↑) 显式排序为规范序。
import { getDocument, type PdfTextItem } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PageText, TextItem } from './types.js';
import { cmpItems } from './table.js';

export async function extractPages(bytes: Uint8Array): Promise<PageText[]> {
  const doc = await getDocument({
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    // 刻意不设 cMapUrl / standardFontDataUrl：不触发任何网络/磁盘资源拉取（R8）。
  }).promise;

  try {
    const pages: PageText[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      const items: TextItem[] = [];
      for (const raw of content.items) {
        // 跳过 TextMarkedContent（无 str/transform）；只要真正的文本项。
        if (!raw || typeof raw !== 'object' || !('str' in raw) || !('transform' in raw)) continue;
        const t = raw as PdfTextItem;
        if (typeof t.str !== 'string' || t.str.trim() === '') continue; // 丢弃纯空白项（含 EOL 空串）
        items.push({
          str: t.str,
          x: t.transform[4]!,
          y: t.transform[5]!,
          width: t.width,
          height: t.height,
        });
      }
      page.cleanup();

      items.sort(cmpItems); // 规范序，保证跨运行字节级一致
      pages.push({ page: p, width: viewport.width, height: viewport.height, items });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
