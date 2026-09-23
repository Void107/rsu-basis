// emit8949Rows（docs/01 §6.1、docs/02 §1）。
//
// 两种输出形态由 1099-B Box 12（basisReportedToIRS）决定，不由 covered 推断（docs/01 §6.1）：
//   已报送 IRS（含报 $0）：Box A/D，(e) 照抄 1099-B 原值，(f)=B，(g)=调整额（负）
//   未报送 IRS：           Box B/E，正确基础直接进 (e)，无 (f)/(g)
// 这是两条不同路径，不是同一套行加标记。
import Decimal from 'decimal.js';
import {
  money,
  type Form8949Output,
  type Form8949Row,
  type Match,
  type SaleEvent,
  type VestLot,
} from './types.js';
import { InvariantViolation } from './errors.js';

export function emit8949Rows(
  matches: Match[],
  sales: SaleEvent[],
  lots: VestLot[],
  ticker: string,
): Form8949Row[] {
  const salesById = new Map(sales.map((s) => [s.id, s]));
  const lotsById = new Map(lots.map((l) => [l.id, l]));

  return matches.map((m) => {
    const sale = salesById.get(m.saleId);
    const lot = lotsById.get(m.lotId);
    if (!sale || !lot) {
      throw new InvariantViolation({ invariant: 'match-ref', detail: `match ${m.saleId}/${m.lotId} references missing sale/lot` });
    }
    const base = {
      description: `${m.sharesMatched.toString()} sh ${ticker}`,
      dateAcquired: lot.vestDate,
      dateSold: sale.saleDate,
      proceeds: m.proceedsPortion,
      term: m.term,
    };

    if (sale.basisReportedToIRS) {
      // adjustmentAmount = -(adjustedBasis - reportedBasisPortion)，即 -ordinaryIncomePortion
      const adjustmentAmount = money(m.reportedBasisPortion.sub(m.adjustedBasis));
      if (adjustmentAmount.greaterThan(0)) {
        throw new InvariantViolation({ invariant: 'I5', detail: `8949 row ${m.saleId}/${m.lotId}: positive adjustment` });
      }
      const gainLoss = money(m.proceedsPortion.sub(m.reportedBasisPortion).add(adjustmentAmount));
      const row: Form8949Row = {
        ...base,
        costBasisReported: m.reportedBasisPortion, // 照抄 1099-B（通常 0）
        adjustmentCode: 'B',
        adjustmentAmount,
        gainLoss,
        box: m.term === 'ST' ? 'A' : 'D',
      };
      return row;
    }

    // 未报送 IRS：正确基础直接进 (e)，无代码、无调整额。
    const gainLoss = money(m.proceedsPortion.sub(m.adjustedBasis));
    const row: Form8949Row = {
      ...base,
      costBasisReported: m.adjustedBasis,
      gainLoss,
      box: m.term === 'ST' ? 'B' : 'E',
    };
    return row;
  });
}

/** 逐行汇总。带调整代码的行必须逐笔列示，这里只是求和（docs/01 §6.2）。 */
export function buildForm8949(
  matches: Match[],
  sales: SaleEvent[],
  lots: VestLot[],
  ticker: string,
): Form8949Output {
  const rows = emit8949Rows(matches, sales, lots, ticker);
  const sum = (pick: (r: Form8949Row) => Decimal): Decimal =>
    rows.reduce((acc, r) => acc.add(pick(r)), new Decimal(0));
  return {
    rows,
    totals: {
      proceeds: money(sum((r) => r.proceeds)),
      costBasisReported: money(sum((r) => r.costBasisReported)),
      adjustmentAmount: money(sum((r) => r.adjustmentAmount ?? new Decimal(0))),
      gainLoss: money(sum((r) => r.gainLoss)),
    },
  };
}
