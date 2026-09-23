// normalizeVestEvents（docs/02 §1）。纯函数校验，不改数、不补数。
// 在这里执行两条 lot 级不变量/交叉校验：
//   I4 (docs/02 §4) / C3 (F15)：sharesVested == sharesWithheld + sharesDelivered（股数零容差）
//   C2 (docs/05 F12)：sharesVested × vestFmv ≈ ordinaryIncome（金额容差 $0.01/lot）
// 注意 ordinaryIncome 是独立提取来的（docs/01 §3.1），这里是拿乘积去校验它，
// 不是拿它顶替乘积——两者一致才说明 FMV 口径与提取都没问题。
import {
  money,
  type VestLot,
  Ok,
  Err,
  type Result,
} from './types.js';
import { ReconciliationError } from './errors.js';

// docs/01 §5：金额比对绝对容差 $0.01 × 涉及 lot 数。lot 级校验即单 lot → $0.01。
const PER_LOT_TOLERANCE = money('0.01');

export function normalizeVestEvents(raw: VestLot[]): Result<VestLot[], ReconciliationError> {
  for (const lot of raw) {
    // I4 / C3：股数守恒（零容差）。withheld 为 null 表示未提取到代扣列，
    // 此时无法校验，交由 matching 阶段在需要 withheld 时以 MissingDataError 暴露。
    if (lot.sharesWithheld !== null) {
      const sum = lot.sharesWithheld.add(lot.sharesDelivered);
      if (!sum.equals(lot.sharesVested)) {
        return Err(
          new ReconciliationError({
            check: 'C3',
            detail: `lot ${lot.id}: sharesVested != sharesWithheld + sharesDelivered`,
          }),
        );
      }
    }
    // C2：乘积一致性。
    const product = money(lot.sharesVested.mul(lot.vestFmv));
    if (product.sub(lot.ordinaryIncome).abs().greaterThan(PER_LOT_TOLERANCE)) {
      return Err(
        new ReconciliationError({
          check: 'C2',
          detail: `lot ${lot.id}: sharesVested*vestFmv != ordinaryIncome (beyond $0.01)`,
        }),
      );
    }
  }
  return Ok(raw);
}
