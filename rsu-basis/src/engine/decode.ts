// 把已解析的 schema JSON（金额/股数为字符串，docs/01 §7）转成引擎内的 Decimal 表示。
// 这里是 R2 的执行点：任何计算路径上的必需字段为 null / 缺失 → MissingDataError，
// 绝不 fallback、绝不 ?? 0、绝不插值（CLAUDE.md R2、D2）。
//
// 本模块是纯函数：输入是已经在测试/加载层 JSON.parse 好的普通对象，无 I/O。
import {
  money,
  shares,
  type Ledger,
  type SaleEvent,
  type SourceRef,
  type VestLot,
  type W2Anchor,
  type SaleKind,
  type Term,
  type FmvConvention,
  type ProceedsKind,
  Ok,
  Err,
  type Result,
} from './types.js';
import { MissingDataError } from './errors.js';

type Raw = Record<string, unknown>;

function isFiniteNumericString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));
}

function reqMoney(o: Raw, field: string, ctx: { lotId?: string; saleId?: string; expectedSource: string }) {
  const v = o[field];
  if (v === null || v === undefined || !isFiniteNumericString(v)) {
    throw new MissingDataError({ field, ...ctx });
  }
  return money(v);
}

function reqShares(o: Raw, field: string, ctx: { lotId?: string; saleId?: string; expectedSource: string }) {
  const v = o[field];
  if (v === null || v === undefined || !isFiniteNumericString(v)) {
    throw new MissingDataError({ field, ...ctx });
  }
  return shares(v);
}

function optMoney(o: Raw, field: string) {
  const v = o[field];
  if (v === null || v === undefined) return null;
  if (!isFiniteNumericString(v)) return null;
  return money(v);
}

function optShares(o: Raw, field: string) {
  const v = o[field];
  if (v === null || v === undefined) return null;
  if (!isFiniteNumericString(v)) return null;
  return shares(v);
}

function reqString(o: Raw, field: string, ctx: { lotId?: string; saleId?: string; expectedSource: string }) {
  const v = o[field];
  if (typeof v !== 'string' || v === '') throw new MissingDataError({ field, ...ctx });
  return v;
}

function reqBool(o: Raw, field: string, ctx: { lotId?: string; saleId?: string; expectedSource: string }) {
  const v = o[field];
  if (typeof v !== 'boolean') throw new MissingDataError({ field, ...ctx });
  return v;
}

function reqEnum<T extends string>(
  o: Raw,
  field: string,
  allowed: readonly T[],
  ctx: { lotId?: string; saleId?: string; expectedSource: string },
): T {
  const v = o[field];
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new MissingDataError({ field, ...ctx });
  return v as T;
}

function sources(o: Raw): SourceRef[] {
  const s = o['sources'];
  return Array.isArray(s) ? (s as SourceRef[]) : [];
}

const FMV_CONVENTIONS: readonly FmvConvention[] = ['close', 'high_low_avg', 'prior_close', 'unknown'];
const PROCEEDS_KINDS: readonly ProceedsKind[] = ['gross', 'net_of_fees'];
const SALE_KINDS: readonly SaleKind[] = ['sell_to_cover', 'open_market', 'unknown'];

function decodeLot(raw: Raw): VestLot {
  // id 是匹配锚点（byId、STC 候选、lot 溯源），缺失即报错，绝不兜占位串（会撞 Map key）。
  const id = reqString(raw, 'id', { expectedSource: 'ledger: lot id' });
  const ctxV = { lotId: id, expectedSource: 'broker supplemental statement' };
  return {
    id,
    grantId: typeof raw['grantId'] === 'string' ? (raw['grantId'] as string) : null,
    vestDate: reqString(raw, 'vestDate', { lotId: id, expectedSource: 'supplemental: vest date column' }),
    sharesVested: reqShares(raw, 'sharesVested', ctxV),
    sharesWithheld: optShares(raw, 'sharesWithheld'),
    sharesDelivered: reqShares(raw, 'sharesDelivered', ctxV),
    vestFmv: reqMoney(raw, 'vestFmv', {
      lotId: id,
      expectedSource: 'broker supplemental statement, column "Adjusted Cost or Other Basis" (per share)',
    }),
    ordinaryIncome: reqMoney(raw, 'ordinaryIncome', {
      lotId: id,
      expectedSource: 'supplemental: Ordinary Income Reported column',
    }),
    // 必需枚举，不设默认（R2）。值可以是 'unknown'（诚实哨兵），但该字段本身必须由提取层显式给出。
    fmvConvention: reqEnum(raw, 'fmvConvention', FMV_CONVENTIONS, { lotId: id, expectedSource: 'supplemental: FMV convention' }),
    sources: sources(raw),
  };
}

function decodeSale(raw: Raw): SaleEvent {
  // id 是匹配锚点，缺失即报错，绝不兜占位串。
  const id = reqString(raw, 'id', { expectedSource: 'ledger: sale id' });
  const ctxS = { saleId: id, expectedSource: '1099-B' };
  return {
    id,
    saleDate: reqString(raw, 'saleDate', { saleId: id, expectedSource: '1099-B trade date' }),
    sharesSold: reqShares(raw, 'sharesSold', ctxS),
    proceeds: reqMoney(raw, 'proceeds', { saleId: id, expectedSource: '1099-B Box 1d' }),
    // 毛额 / 净额影响 proceeds 口径，必需，不默认 'gross'（R2：不做静默假设）。
    proceedsBasis: reqEnum(raw, 'proceedsBasis', PROCEEDS_KINDS, { saleId: id, expectedSource: '1099-B proceeds basis (gross/net)' }),
    // reportedBasis 允许为 null（schema 定义 Money | null）；null 的处理留到 matching 的计算点（R2）。
    reportedBasis: optMoney(raw, 'reportedBasis'),
    reportedTerm: (raw['reportedTerm'] as Term | null) ?? null,
    covered: reqBool(raw, 'covered', { saleId: id, expectedSource: '1099-B Box 5 (covered security)' }),
    // basisReportedToIRS 决定 8949 输出形态（docs/01 §6.1），必须来自 1099-B Box 12，
    // 不得由 covered 推断、也不设默认——缺失即 MissingDataError（R2 / D2：缺数据就停）。
    // 选错形态 = 输出错误的 8949，属静默错误，正是本项目要杜绝的。
    basisReportedToIRS: reqBool(raw, 'basisReportedToIRS', { saleId: id, expectedSource: '1099-B Box 12' }),
    // saleKind 决定匹配分支（STC vs FIFO），必需；值可为 'unknown'（→ 用户裁决），但字段本身不默认。
    saleKind: reqEnum(raw, 'saleKind', SALE_KINDS, { saleId: id, expectedSource: 'derived sale kind (docs/01 §3.2)' }),
    sources: sources(raw),
  };
}

function decodeAnchor(raw: Raw): W2Anchor {
  return {
    taxYear: Number(raw['taxYear']),
    box1Total: optMoney(raw, 'box1Total'),
    rsuIncomeReported: optMoney(raw, 'rsuIncomeReported'),
    rsuIncomeSource: (raw['rsuIncomeSource'] as W2Anchor['rsuIncomeSource']) ?? null,
    sources: sources(raw),
  };
}

/** JSON 对象 → Ledger。R2：必需字段缺失即 MissingDataError（不抛出，走 Result）。 */
export function decodeLedger(raw: unknown): Result<Ledger, MissingDataError> {
  try {
    const o = raw as Raw;
    const vestLots = (o['vestLots'] as Raw[]).map(decodeLot);
    const saleEvents = (o['saleEvents'] as Raw[]).map(decodeSale);
    const w2Anchor = decodeAnchor(o['w2Anchor'] as Raw);
    return Ok({
      schemaVersion: Number(o['schemaVersion']),
      taxYear: Number(o['taxYear']),
      // ticker 进入 8949 description，必需，不兜空串。
      ticker: reqString(o, 'ticker', { expectedSource: 'ledger: ticker' }),
      vestLots,
      saleEvents,
      w2Anchor,
    });
  } catch (err) {
    if (err instanceof MissingDataError) return Err(err);
    throw err;
  }
}
