// 核心类型与 branded 金额类型。
// CLAUDE.md R1：金额禁止使用 number，一律用 Decimal，且用 branded type 强制区分
// 金额（Money）与股数（Shares），避免把两者混算。
import Decimal from 'decimal.js';

// decimal.js 全局精度：股数保留 4 位、金额比较到分，20 位有效数字足够，
// 且不引入指数记法（toFixed / toString 保持可读且确定）。
Decimal.set({ precision: 40, toExpNeg: -9e15, toExpPos: 9e15 });

export { Decimal };

export type Money = Decimal & { readonly __brand: 'Money' };
export type Shares = Decimal & { readonly __brand: 'Shares' };

// 只允许通过这两个构造器进入 branded 世界。参数刻意收窄为 string | Decimal，
// 不接受 number（R1：金额禁止走 number）——否则 money(0.1 + 0.2) 这类 JS 浮点会溜进来。
// 字符串来源见 docs/01 §7（落盘存字符串）；Decimal 来源是引擎内部的确定性运算结果。
export function money(v: string | Decimal): Money {
  return new Decimal(v) as Money;
}
export function shares(v: string | Decimal): Shares {
  return new Decimal(v) as Shares;
}

export const ZERO_MONEY = money('0');
export const ZERO_SHARES = shares('0');

/** ISO 日期字符串 YYYY-MM-DD，UTC，无时区（docs/02 §2.1）。 */
export type IsoDate = string;
export type Term = 'ST' | 'LT';
export type FmvConvention = 'close' | 'high_low_avg' | 'prior_close' | 'unknown';
export type ProceedsKind = 'gross' | 'net_of_fees';
export type SaleKind = 'sell_to_cover' | 'open_market' | 'unknown';
export type Box = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface SourceRef {
  fileHash: string;
  fileName: string;
  page: number;
  rowIndex: number | null;
  columnLabel: string | null;
  method: 'rule' | 'llm' | 'manual';
  confidence: number;
  rawText: string;
}

// —— 核心表（docs/01 §3）——

export interface VestLot {
  id: string;
  grantId: string | null;
  vestDate: IsoDate;
  sharesVested: Shares;
  sharesWithheld: Shares | null;
  sharesDelivered: Shares;
  vestFmv: Money;
  ordinaryIncome: Money;
  fmvConvention: FmvConvention;
  sources: SourceRef[];
}

export interface SaleEvent {
  id: string;
  saleDate: IsoDate;
  sharesSold: Shares;
  proceeds: Money;
  proceedsBasis: ProceedsKind;
  reportedBasis: Money | null;
  reportedTerm: Term | null;
  covered: boolean;
  basisReportedToIRS: boolean;
  saleKind: SaleKind;
  sources: SourceRef[];
}

export interface W2Anchor {
  taxYear: number;
  box1Total: Money | null;
  rsuIncomeReported: Money | null;
  rsuIncomeSource: 'box14' | 'supplemental_total' | 'paystub' | null;
  sources: SourceRef[];
}

export interface Ledger {
  schemaVersion: number;
  taxYear: number;
  ticker: string;
  vestLots: VestLot[];
  saleEvents: SaleEvent[];
  w2Anchor: W2Anchor;
}

// —— 计算产物（docs/01 §6，引擎输出）——

export type MatchMethod = 'fifo' | 'spec_id' | 'sell_to_cover_pairing';

export interface Match {
  saleId: string;
  lotId: string;
  sharesMatched: Shares;
  proceedsPortion: Money;
  adjustedBasis: Money;
  reportedBasisPortion: Money;
  term: Term;
  matchMethod: MatchMethod;
}

export interface Form8949Row {
  description: string;
  dateAcquired: IsoDate;
  dateSold: IsoDate;
  proceeds: Money;
  costBasisReported: Money;
  // adjustmentCode / adjustmentAmount 只在「基础已报送 IRS」形态出现（docs/01 §6.1）。
  adjustmentCode?: 'B';
  adjustmentAmount?: Money;
  gainLoss: Money;
  term: Term;
  box: Box;
}

export interface Form8949Output {
  rows: Form8949Row[];
  totals: {
    proceeds: Money;
    costBasisReported: Money;
    adjustmentAmount: Money;
    gainLoss: Money;
  };
}

export interface ReconcileReport {
  status: 'ok' | 'blocked';
  warnings?: string[];
  totalOrdinaryIncome: Money;
  totalProceeds: Money;
  totalAdjustedBasis: Money;
  totalAdjustment: Money;
  totalCorrectGainLoss: Money;
  gainLossIfUnadjusted: Money;
  phantomGain: Money;
  sharesUnmatchedThisYear: Shares;
  basisOfUnmatchedShares: Money;
  estimatedOverpayment?: Money | null;
}

// —— Result（docs/02 §1：不用异常做控制流）——

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export interface MatchPolicy {
  /** 默认 FIFO；specific identification 由 1099-B 标注驱动，V1 golden 未覆盖。 */
  method: 'fifo';
}
