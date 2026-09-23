// matchSalesToLots（docs/02 §2.2 / §2.3）。
//
// 两个 phase，最终顺序 = 全部 sell-to-cover 配对（按 sale 输入顺序）++ 全部 open-market
// FIFO 匹配（按 saleDate 升序，每笔内部按 lot 的 vestDate 升序展开）：
//
//   Phase A — sell-to-cover 确定性配对（优先于 FIFO）：
//     卖出日 == 某 lot 的 vestDate 且 股数 == 该 lot 的 sharesWithheld → 唯一配对。
//     同日多 lot 且无法唯一配对 → AmbiguousMatchError（docs/05 F16）。禁止用「最接近」消歧。
//     STC 消耗的是 lot 的 withheld 份额。
//
//   Phase B — 其余（open-market）按 FIFO 消耗 lot 的 delivered 份额。
//     一笔卖出可跨多个 lot → 多条 Match，term 可能不同（docs/05 F17，正常路径）。
//     delivered 池不够填 → 卖出 > 可匹配股数（docs/05 F7 / 不变量 I2）→ OutOfScopeError。
//
// proceeds / reportedBasis 按股数比例分摊到同一笔卖出的各 Match，余数归最后一条，
// 保证求和精确等于原值（docs/02 §2.4）。
import Decimal from 'decimal.js';
import {
  money,
  shares,
  type Match,
  type MatchPolicy,
  type Money,
  type SaleEvent,
  type Shares,
  type VestLot,
  Ok,
  Err,
  type Result,
} from './types.js';
import { AmbiguousMatchError, MissingDataError, OutOfScopeError, type EngineError } from './errors.js';
import { computeAdjustedBasis } from './basis.js';
import { classifyHoldingPeriod } from './holding.js';

interface Skeleton {
  saleId: string;
  lotId: string;
  sharesMatched: Shares;
  matchMethod: 'fifo' | 'sell_to_cover_pairing';
}

/** 按股数比例把 total 分摊到 weights，余数归最后一条（求和精确等于 total）。 */
function allocate(total: Money, weights: Shares[], totalShares: Shares): Money[] {
  const out: Money[] = [];
  let acc = new Decimal(0);
  for (let i = 0; i < weights.length; i++) {
    if (i < weights.length - 1) {
      const p = total.mul(weights[i]!).div(totalShares).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      out.push(money(p));
      acc = acc.add(p);
    } else {
      out.push(money(total.sub(acc)));
    }
  }
  return out;
}

export function matchSalesToLots(
  sales: SaleEvent[],
  lots: VestLot[],
  _policy: MatchPolicy,
): Result<Match[], EngineError> {
  // FIFO 顺序：vestDate 升序，同日按输入顺序（Array.prototype.sort 稳定）。
  const fifoLots = lots
    .map((lot, idx) => ({ lot, idx }))
    .sort((a, b) => (a.lot.vestDate < b.lot.vestDate ? -1 : a.lot.vestDate > b.lot.vestDate ? 1 : a.idx - b.idx))
    .map((x) => x.lot);

  const byId = new Map(lots.map((l) => [l.id, l]));
  const withheldConsumed = new Set<string>();
  const deliveredRemaining = new Map<string, Decimal>(lots.map((l) => [l.id, l.sharesDelivered]));

  const skels: Skeleton[] = [];

  // —— Phase A：sell-to-cover 配对 ——（保持 sale 输入顺序）
  for (const sale of sales) {
    if (sale.saleKind !== 'sell_to_cover') continue;
    const candidates = lots.filter(
      (l) =>
        l.vestDate === sale.saleDate &&
        l.sharesWithheld !== null &&
        l.sharesWithheld.equals(sale.sharesSold) &&
        !withheldConsumed.has(l.id),
    );
    if (candidates.length !== 1) {
      return Err(
        new AmbiguousMatchError({
          saleId: sale.id,
          candidateLotIds: candidates.map((c) => c.id),
          reason:
            candidates.length === 0
              ? 'sell_to_cover sale has no lot uniquely matching by vestDate+sharesWithheld'
              : 'multiple lots vest same day with identical withheld shares (docs/05 F16)',
        }),
      );
    }
    const lot = candidates[0]!;
    withheldConsumed.add(lot.id);
    skels.push({ saleId: sale.id, lotId: lot.id, sharesMatched: sale.sharesSold, matchMethod: 'sell_to_cover_pairing' });
  }

  // —— Phase B：其余按 FIFO ——（按 saleDate 升序，稳定）
  const openMarket = sales
    .map((sale, idx) => ({ sale, idx }))
    .filter(({ sale }) => sale.saleKind !== 'sell_to_cover')
    .sort((a, b) => (a.sale.saleDate < b.sale.saleDate ? -1 : a.sale.saleDate > b.sale.saleDate ? 1 : a.idx - b.idx));

  for (const { sale } of openMarket) {
    if (sale.saleKind === 'unknown') {
      // 判不出卖出类型 → 交用户裁决（docs/01 §3.2、docs/05 F18）。
      return Err(
        new AmbiguousMatchError({
          saleId: sale.id,
          candidateLotIds: [],
          reason: 'saleKind is unknown; requires user adjudication',
        }),
      );
    }
    let need = sale.sharesSold as Decimal;
    for (const lot of fifoLots) {
      if (need.lessThanOrEqualTo(0)) break;
      const avail = deliveredRemaining.get(lot.id)!;
      if (avail.lessThanOrEqualTo(0)) continue;
      const take = Decimal.min(avail, need);
      deliveredRemaining.set(lot.id, avail.sub(take));
      need = need.sub(take);
      skels.push({ saleId: sale.id, lotId: lot.id, sharesMatched: shares(take), matchMethod: 'fifo' });
    }
    if (need.greaterThan(0)) {
      // delivered 池不够 → 卖出股数 > 可匹配股数（docs/05 F7 / I2）。
      return Err(new OutOfScopeError({ scopeItem: 'F7_shares_sold_exceed_vested_delivered' }));
    }
  }

  // —— 分摊 proceeds / reportedBasis 并计算 term、adjustedBasis ——
  // 同一笔卖出的 skeleton 在数组中连续（STC 一条；open-market 连续多条），按出现顺序分摊。
  const salesById = new Map(sales.map((s) => [s.id, s]));
  const groups = new Map<string, number[]>(); // saleId -> skel indices（保持顺序）
  skels.forEach((sk, i) => {
    const arr = groups.get(sk.saleId);
    if (arr) arr.push(i);
    else groups.set(sk.saleId, [i]);
  });

  const proceedsPortion = new Array<Money>(skels.length);
  const reportedPortion = new Array<Money>(skels.length);
  for (const [saleId, idxs] of groups) {
    const sale = salesById.get(saleId)!;
    // R2：reportedBasis 在计算路径上（→ reportedBasisPortion → adjustedBasis → adjustmentAmount），
    // null 表示未从 1099-B Box 1e 确证。绝不 ?? 0 兜底——停下来报缺失，交由上层裁决它是否确为 $0。
    if (sale.reportedBasis === null) {
      return Err(new MissingDataError({ field: 'reportedBasis', saleId, expectedSource: '1099-B Box 1e' }));
    }
    const weights = idxs.map((i) => skels[i]!.sharesMatched);
    const totalShares = shares(weights.reduce((acc, w) => acc.add(w), new Decimal(0)));
    const procAlloc = allocate(sale.proceeds, weights, totalShares);
    const repAlloc = allocate(sale.reportedBasis, weights, totalShares);
    idxs.forEach((skelIdx, k) => {
      proceedsPortion[skelIdx] = procAlloc[k]!;
      reportedPortion[skelIdx] = repAlloc[k]!;
    });
  }

  const matches: Match[] = skels.map((sk, i) => {
    const lot = byId.get(sk.lotId)!;
    const sale = salesById.get(sk.saleId)!;
    const reportedBasisPortion = reportedPortion[i]!;
    return {
      saleId: sk.saleId,
      lotId: sk.lotId,
      sharesMatched: sk.sharesMatched,
      proceedsPortion: proceedsPortion[i]!,
      adjustedBasis: computeAdjustedBasis({ sharesMatched: sk.sharesMatched, lot, reportedBasisPortion }),
      reportedBasisPortion,
      term: classifyHoldingPeriod(lot.vestDate, sale.saleDate),
      matchMethod: sk.matchMethod,
    };
  });

  return Ok(matches);
}
