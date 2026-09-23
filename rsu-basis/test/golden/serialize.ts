// 把引擎输出（Decimal）序列化回 golden fixture 的字符串形态（docs/01 §7）。
// 金额到分（toFixed(2)），股数保留有效位（toString，整数即 "40"，分数即 "12.3456"）。
// 这是测试专用的格式化，不是金额运算，故放在 test/ 而非 src/engine（CLAUDE.md §5）。
import type { EngineOutput, Form8949Output, Match, ReconcileReport } from '../../src/engine/index.js';

const m2 = (d: { toFixed: (n: number) => string }) => d.toFixed(2);
const sh = (d: { toString: () => string }) => d.toString();

export function serializeMatches(o: EngineOutput) {
  return {
    matches: o.matches.map(serializeMatch),
    reconcile: serializeReconcile(o.reconcile),
  };
}

function serializeMatch(m: Match) {
  return {
    saleId: m.saleId,
    lotId: m.lotId,
    sharesMatched: sh(m.sharesMatched),
    proceedsPortion: m2(m.proceedsPortion),
    adjustedBasis: m2(m.adjustedBasis),
    reportedBasisPortion: m2(m.reportedBasisPortion),
    term: m.term,
    matchMethod: m.matchMethod,
  };
}

function serializeReconcile(r: ReconcileReport) {
  const base: Record<string, unknown> = { status: r.status };
  if (r.warnings && r.warnings.length > 0) base['warnings'] = r.warnings;
  base['totalOrdinaryIncome'] = m2(r.totalOrdinaryIncome);
  base['totalProceeds'] = m2(r.totalProceeds);
  base['totalAdjustedBasis'] = m2(r.totalAdjustedBasis);
  base['totalAdjustment'] = m2(r.totalAdjustment);
  base['totalCorrectGainLoss'] = m2(r.totalCorrectGainLoss);
  base['gainLossIfUnadjusted'] = m2(r.gainLossIfUnadjusted);
  base['phantomGain'] = m2(r.phantomGain);
  base['sharesUnmatchedThisYear'] = sh(r.sharesUnmatchedThisYear);
  base['basisOfUnmatchedShares'] = m2(r.basisOfUnmatchedShares);
  return base;
}

export function serializeForm8949(f: Form8949Output) {
  return {
    rows: f.rows.map((row) => {
      const out: Record<string, unknown> = {
        description: row.description,
        dateAcquired: row.dateAcquired,
        dateSold: row.dateSold,
        proceeds: m2(row.proceeds),
        costBasisReported: m2(row.costBasisReported),
      };
      if (row.adjustmentCode) out['adjustmentCode'] = row.adjustmentCode;
      if (row.adjustmentAmount) out['adjustmentAmount'] = m2(row.adjustmentAmount);
      out['gainLoss'] = m2(row.gainLoss);
      out['term'] = row.term;
      out['box'] = row.box;
      return out;
    }),
    totals: {
      proceeds: m2(f.totals.proceeds),
      costBasisReported: m2(f.totals.costBasisReported),
      adjustmentAmount: m2(f.totals.adjustmentAmount),
      gainLoss: m2(f.totals.gainLoss),
    },
  };
}
