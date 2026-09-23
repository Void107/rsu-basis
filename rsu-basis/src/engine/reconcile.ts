// reconcile（docs/02 §3）+ 不变量校验（docs/02 §4 的 I1–I6）。
// 这是对账的唯一场所——CLAUDE.md §4：绝不让 LLM「检查这些数加起来对不对」。
//
// 违反不变量一律走 Result 的 Err 分支（不返回「看起来正常」的部分报告）：
//   I1/I2/I6 → InvariantViolation（内部一致性，理应恒真，违反=bug，脱敏上报）
//   I3       → 有 anchor 时超容差 → ReconciliationError（C5，docs/05 F13）；
//              无 anchor → 降级为 WARN（warnings 里记 C5_SKIPPED_NO_W2_ANCHOR）
//   I5       → InvariantViolation（方向反转，最危险，docs/05 F19，HARD 且不可关闭）
import Decimal from 'decimal.js';
import {
  money,
  shares,
  type Match,
  type Money,
  type ReconcileReport,
  type VestLot,
  type W2Anchor,
  Ok,
  Err,
  type Result,
} from './types.js';
import { InvariantViolation, ReconciliationError, type EngineError } from './errors.js';

const CENT = money('0.01');

export function reconcile(
  lots: VestLot[],
  anchor: W2Anchor,
  matches: Match[],
): Result<ReconcileReport, EngineError> {
  const sum = (xs: Decimal[]): Decimal => xs.reduce((a, b) => a.add(b), new Decimal(0));

  // —— I5：每条 adjustmentAmount ≤ 0（安全带）——
  for (const m of matches) {
    // adjustmentAmount = -(adjustedBasis - reportedBasisPortion)。>0 即方向反转。
    const adjustment = m.reportedBasisPortion.sub(m.adjustedBasis);
    if (adjustment.greaterThan(0)) {
      return Err(
        new InvariantViolation({
          invariant: 'I5',
          detail: `match ${m.saleId}/${m.lotId}: adjustmentAmount > 0 (basis reported exceeds vest FMV basis)`,
        }),
      );
    }
  }

  // I1（Σ matched == Σ sold）在 matchSalesToLots 由构造保证：任何未能填满的卖出会
  // 在那里以 OutOfScopeError 报错。此处需要独立的 sales 输入才能重复校验，见 checkI1()。

  // —— I2：每个 lot Σ matched ≤ sharesVested；同时算未匹配股数与其 basis ——
  const matchedByLot = new Map<string, Decimal>();
  for (const m of matches) {
    matchedByLot.set(m.lotId, (matchedByLot.get(m.lotId) ?? new Decimal(0)).add(m.sharesMatched));
  }
  let unmatchedShares = new Decimal(0);
  let unmatchedBasis = new Decimal(0);
  for (const lot of lots) {
    const matched = matchedByLot.get(lot.id) ?? new Decimal(0);
    if (matched.greaterThan(lot.sharesVested)) {
      return Err(new InvariantViolation({ invariant: 'I2', detail: `lot ${lot.id}: matched > sharesVested` }));
    }
    const remaining = lot.sharesVested.sub(matched);
    unmatchedShares = unmatchedShares.add(remaining);
    unmatchedBasis = unmatchedBasis.add(remaining.mul(lot.vestFmv));
  }

  const totalOrdinaryIncome = sum(lots.map((l) => l.ordinaryIncome));
  const totalProceeds = sum(matches.map((m) => m.proceedsPortion));
  const totalAdjustedBasis = sum(matches.map((m) => m.adjustedBasis));
  const totalReportedBasisPortion = sum(matches.map((m) => m.reportedBasisPortion));

  // —— I6：Σ 普通所得部分 + Σ 未匹配 basis == Σ ordinaryIncome（精确相等）——
  // 加法式下 adjustedBasis = 普通所得部分 + reportedBasisPortion（docs/02 §2.4）。
  // 参与「普通所得守恒」的只有普通所得部分（= adjustedBasis − reportedBasisPortion）；
  // reportedBasisPortion 是券商已报的独立基础，不属于 vest 时确认的普通所得。
  // reportedBasisPortion 全为 0（RSU 绝大多数情形）时退化为「Σ adjustedBasis + …」的旧式。
  // （docs/02 §3.1：跨年 lot 场景下「未匹配」指未在本年匹配，非「仍持有」，等式仍成立）
  const totalOrdinaryIncomePortion = totalAdjustedBasis.sub(totalReportedBasisPortion);
  if (!totalOrdinaryIncomePortion.add(unmatchedBasis).equals(totalOrdinaryIncome)) {
    return Err(
      new InvariantViolation({
        invariant: 'I6',
        detail: 'Σ (adjustedBasis - reportedBasisPortion) + Σ unmatchedBasis != Σ ordinaryIncome (exact)',
      }),
    );
  }

  // —— I3 / C5：W-2 锚定 ——
  const warnings: string[] = [];
  if (anchor.rsuIncomeReported === null) {
    warnings.push('C5_SKIPPED_NO_W2_ANCHOR');
  } else {
    // docs/01 §5：容差 $0.01 × 涉及 lot 数。
    const tol = money(CENT.mul(lots.length === 0 ? 1 : lots.length));
    if (totalOrdinaryIncome.sub(anchor.rsuIncomeReported).abs().greaterThan(tol)) {
      return Err(new ReconciliationError({ check: 'C5', detail: 'Σ ordinaryIncome != W-2 rsuIncomeReported (beyond tolerance)' }));
    }
  }

  const totalAdjustment = money(totalReportedBasisPortion.sub(totalAdjustedBasis)); // = -(adjBasis - reported)
  const totalCorrectGainLoss = money(totalProceeds.sub(totalAdjustedBasis));
  const gainLossIfUnadjusted = money(totalProceeds.sub(totalReportedBasisPortion));
  const phantomGain = money(totalAdjustedBasis.sub(totalReportedBasisPortion));

  const report: ReconcileReport = {
    status: 'ok',
    totalOrdinaryIncome: money(totalOrdinaryIncome),
    totalProceeds: money(totalProceeds),
    totalAdjustedBasis: money(totalAdjustedBasis),
    totalAdjustment,
    totalCorrectGainLoss,
    gainLossIfUnadjusted,
    phantomGain,
    sharesUnmatchedThisYear: shares(unmatchedShares),
    basisOfUnmatchedShares: money(unmatchedBasis),
  };
  if (warnings.length > 0) report.warnings = warnings;
  return Ok(report);
}
