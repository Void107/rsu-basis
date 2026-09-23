// 券商适配器接口（docs/03 §3）。每家一个文件。
// 适配器只负责「版式 → 候选」，不做计算、不进 schema、不做交叉校验（校验是独立主防线）。
import type { PageText, RawFieldCandidate } from '../pdf/index.js';

export type BrokerId = 'fidelity' | 'schwab' | 'etrade' | 'morganstanley' | 'shareworks';

/** 候选列头可映射到的 schema 字段（docs/01 §3）。 */
export type SchemaField =
  | 'vestDate'
  | 'sharesVested'
  | 'sharesWithheld'
  | 'sharesDelivered'
  | 'vestFmv'
  | 'ordinaryIncome'
  | 'saleDate'
  | 'sharesSold'
  | 'proceeds'
  | 'reportedBasis'
  | 'reportedTerm'
  | 'basisReportedToIRS';

export interface PageRange {
  startPage: number; // 1-indexed，含
  endPage: number; // 1-indexed，含
}

export interface Quirk {
  id: string;
  description: string;
  status: 'confirmed' | 'suspected' | 'todo'; // 是否已在真实文档上确认（Gate C）
}

/**
 * C1 印刷合计行的能力声明（docs/03 §4：C1 是最重要的一条）。显式三态，不猜：
 *   'confirmed' — 已在真实文档/结构描述表上确认有印刷合计行，可作 C1 锚点
 *   'absent'    — 已确认【没有】印刷合计行 → 无可信锚点 → 该券商不支持（不设变通）
 *   'unknown'   — 尚未验证（等待结构描述表回填）→ 运行时【硬阻断】，不静默跳过
 * 拿到测试用户回填后，把对应适配器的这个字段从 'unknown' 改一行即可。
 */
export type PrintedTotalStatus = 'confirmed' | 'absent' | 'unknown';

export interface BrokerAdapter {
  id: BrokerId;
  /** C1 补充表合计锚点能力（docs/03 §4）。非 'confirmed' 时 runC1 硬阻断。 */
  hasPrintedTotalSupplemental: PrintedTotalStatus;
  /** C8 1099-B 主表合计锚点能力（INDEX.md D16）。非 'confirmed' 时 runC8 硬阻断。
   *  与上一条是同一个待办：都等结构描述表（docs/06 §3.1 / Gate C）回填。 */
  hasPrintedTotal1099B: PrintedTotalStatus;
  /** 列头原文 → schema 字段（docs/11 §4 起步）。 */
  columnMap: Record<string, SchemaField>;
  quirks: Quirk[];
  /** 0..1 置信度。 */
  detect(pages: PageText[]): number;
  /** 定位补充表页范围；找不到 → null。 */
  locateSupplemental(pages: PageText[]): PageRange | null;
  /** 版式 → 候选（method='rule'）。不做归一到 schema、不做校验。 */
  extract(pages: PageText[], fileHash: string, fileName: string): RawFieldCandidate[];
}
