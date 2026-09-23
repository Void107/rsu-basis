// 提取层 · PDF 解析基建入口（docs/03 §2）。
// 管线：File bytes → sha256 → pdfjs 文本层 → 扫描件检测 →（表格重建 → RawFieldCandidate[]）。
// 不含券商适配器、不含 LLM/L3。候选不进 schema（由后续 validate.ts 负责映射）。
import { sha256 } from './hash.js';
import { extractPages } from './textLayer.js';
import { detectScanned } from './scanned.js';
import { reconstructTable, gridToCandidates } from './table.js';
import type { ParseResult, RawFieldCandidate } from './types.js';

export * from './types.js';
export { sha256 } from './hash.js';
export { extractPages } from './textLayer.js';
export { detectScanned, MIN_CHARS_PER_PAGE } from './scanned.js';
export { clusterRows, reconstructTable, gridToCandidates, joinPageTables, cmpItems, Y_TOL } from './table.js';

/** File → 哈希 + 页文本 + 扫描件判定。不做表格重建（那需要调用方给出表头提示）。 */
export async function parsePdf(bytes: Uint8Array, fileName: string): Promise<ParseResult> {
  const fileHash = sha256(bytes);
  const pages = await extractPages(bytes);
  const scan = detectScanned(pages);
  return { fileHash, fileName, pageCount: pages.length, scan, pages };
}

export interface ExtractOutcome {
  result: ParseResult;
  candidates: RawFieldCandidate[];
  /** 非 null 表示无法解析的确定性阻断态；'scanned' → docs/05 F2（不 OCR）。 */
  unsupported: 'scanned' | null;
}

/**
 * 给定表头提示，从文档抽取候选。表头提示由调用方（未来的券商适配器）提供，
 * 本层不内置任何券商知识。扫描件直接返回 unsupported='scanned'，绝不 OCR。
 */
export async function extractCandidates(
  bytes: Uint8Array,
  fileName: string,
  headerHints: string[],
): Promise<ExtractOutcome> {
  const result = await parsePdf(bytes, fileName);
  if (result.scan.isScanned) {
    return { result, candidates: [], unsupported: 'scanned' };
  }
  const candidates: RawFieldCandidate[] = [];
  for (const page of result.pages) {
    const grid = reconstructTable(page, headerHints);
    if (grid) {
      candidates.push(...gridToCandidates(grid, { fileHash: result.fileHash, fileName }));
    }
  }
  return { result, candidates, unsupported: null };
}
