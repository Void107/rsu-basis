// 调整后成本基础（docs/02 §2.4）。
// 加法式定义：adjustedBasis = ordinaryIncomePortion + reportedBasisPortion
//   其中 ordinaryIncomePortion = sharesMatched × lot.vestFmv
// 当 1099-B 报 $0（RSU 绝大多数情形）时等价于 sharesMatched × vestFmv；
// 券商报了非零基础时，只有加法式正确（docs/11 §5.1）。
//
// 注意：sharesMatched × vestFmv 是「计算」，而 docs/01 §3.1 的 ordinaryIncome（lot 级）
// 是独立提取来的、用于交叉校验的量，两者不可互相顶替。这里算的是 per-match 的分摊部分。
import { money, type Money, type Shares, type VestLot } from './types.js';

/** per-match 的普通所得部分：匹配股数 × 该 lot 的 vest FMV。 */
export function ordinaryIncomePortion(sharesMatched: Shares, lot: VestLot): Money {
  return money(sharesMatched.mul(lot.vestFmv));
}

/** 加法式调整后基础。 */
export function computeAdjustedBasis(args: {
  sharesMatched: Shares;
  lot: VestLot;
  reportedBasisPortion: Money;
}): Money {
  const oi = ordinaryIncomePortion(args.sharesMatched, args.lot);
  return money(oi.add(args.reportedBasisPortion));
}
