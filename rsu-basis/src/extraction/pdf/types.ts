// 提取层 · PDF 解析基建的类型（docs/03 §2）。
// 本层职责：File → 文本项(带坐标) → 表格重建 → RawFieldCandidate[]。
// 【不做】计算、【不进】schema、【不含】券商适配器、【不含】LLM/L3（docs/07 §3.1）。
//
// 刻意不 import src/engine/**：候选值不进 schema，schema 映射由后续 validate.ts 负责。

/** 规则解析的置信度恒为 1.0——命中或不命中，不存在「大概是」（docs/03 §5）。 */
export const RULE_CONFIDENCE = 1.0 as const;
export type ExtractMethod = 'rule';

/** pdfjs 文本项，坐标取自 transform：x = transform[4]，y = transform[5]。 */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageText {
  page: number; // 1-indexed
  width: number; // viewport 宽（pt）
  height: number; // viewport 高（pt）
  items: TextItem[]; // 已剔除纯空白项，并按确定顺序排序（y 降序、x 升序）
}

/** 表格重建的一个单元格（可能由同一列内多个文本项合并而成）。 */
export interface Cell {
  text: string;
  x: number; // 合并后最左项的 x
  y: number; // 所在行的锚定 y
}

export interface TableColumn {
  label: string; // 表头单元格原文（照抄，不规范化——docs/11 §4）
  headerX: number; // 表头单元格中心 x
  bandLeft: number; // 列带左边界（含）
  bandRight: number; // 列带右边界（不含）
}

export interface TableRow {
  rowIndex: number; // 数据行序号，0-based（不含表头）
  y: number;
  cells: (Cell | null)[]; // 下标与 columns 对齐
}

export interface TableGrid {
  page: number;
  headerY: number;
  columns: TableColumn[];
  rows: TableRow[];
}

/** 候选字段来源坐标（docs/03 §2「来源坐标」+ CLAUDE.md R5 的 SourceRef 雏形）。 */
export interface CandidateSource {
  fileHash: string;
  fileName: string; // 仅本地展示，不上报（R7）
  page: number; // 1-indexed
  rowIndex: number; // 数据行 index，0-based
  columnLabel: string;
  method: ExtractMethod; // 'rule'
  confidence: number; // rule → 1.0
  x: number;
  y: number;
  rawText: string; // 原始字符串，未归一（docs/01 §4：归一出错时靠它救回）
}

/** CLAUDE.md R3：LLM 边界返回的形态 = 字段名 + 字符串值 + 置信度 + 来源坐标。
 *  规则解析层同样只产出这个形态，不进 schema。 */
export interface RawFieldCandidate {
  columnLabel: string;
  rawText: string;
  confidence: number;
  source: CandidateSource;
}

export interface ScanReport {
  pageCount: number;
  textPageCount: number;
  textlessPages: number[]; // 1-indexed，items 为空或有效文本占比异常低的页
  isScanned: boolean; // true → 无文本层，不支持，走 L2 手工补录，绝不 OCR（docs/05 F2）
}

export interface ParseResult {
  fileHash: string;
  fileName: string;
  pageCount: number;
  scan: ScanReport;
  pages: PageText[];
}
