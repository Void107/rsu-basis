// 七条交叉校验 C1–C7（docs/03 §4）。
// 这是提取层的【核心】与【主要防线】，不是安全网（docs/09 §7.5）——因此先于任何券商适配器实现。
// 「提取错误率可以不为零，但静默错误率必须为零」，靠这七条兜住。
//
// 每条失败 → 一条 docs/05 失败路径 + 用户文案（见 errors.ts / 下方各函数）：
//   C1 → F11（合计锚定）      HARD    最重要的一条；无「忽略并继续」
//   C2 → F12（乘积一致）      HARD
//   C3 → F15（股数守恒）      HARD
//   C4 → F11（行数一致）      HARD    与 C1 同属「漏行/多行」失败族；docs/05 无独立路径，复用 F11
//   C5 → F13（W-2 锚定）      DECIDE  无 W-2 → 降级 WARN 并标注（docs/05 F13）
//   C6 → F14（长短期回验）    DECIDE  券商也可能标错，交用户裁决
//   C7 → F21（二次提取 diff） HARD    InvariantViolation 语义，脱敏上报
//
// 纯函数，输入为已归一的 Decimal / 基本值；不 import src/engine（层独立），
// C6 需要的「引擎算出的 term」由调用方作为参数传入（不在此重算，避免耦合）。
import Decimal from 'decimal.js';
import type { CheckResult } from './errors.js';

const CENT = new Decimal('0.01');

/** 差额数量级，如 100 → "1e2"、0.03 → "1e-2"、0 → "0"。R7：只给量级，不给具体值。 */
export function magnitude(d: Decimal): string {
  const a = d.abs();
  if (a.isZero()) return '0';
  return `1e${Math.floor(Math.log10(a.toNumber()))}`;
}

const sum = (xs: Decimal[]): Decimal => xs.reduce((a, b) => a.add(b), new Decimal(0));

// ——————————————————————————————————————————————————————————————
// C1 合计锚定：逐行 ordinaryIncome 之和 == 补充表印刷合计。docs/03 §4 最重要的一条。
// printedTotal 由适配器从印刷合计行提取。没有印刷合计行的券商不该走到这里
// （docs/03 §4：无锚点则该券商不支持，不设变通）——见 brokers 层的守卫。
// ——————————————————————————————————————————————————————————————
export function checkC1(perRowOrdinaryIncome: Decimal[], printedTotal: Decimal): CheckResult {
  const s = sum(perRowOrdinaryIncome);
  const tol = CENT.mul(Math.max(1, perRowOrdinaryIncome.length));
  const delta = s.sub(printedTotal).abs();
  if (delta.lte(tol)) return { check: 'C1', status: 'pass', level: 'HARD' };
  return {
    check: 'C1',
    status: 'fail',
    level: 'HARD',
    failurePath: 'F11',
    userMessage:
      '逐行加总与补充表上的印刷合计对不上。这通常说明解析时漏读或多读了行。请对照原始补充表逐行核对并手工补齐——为保证结果可信，此处不能「忽略并继续」。',
    detail: `C1: |Σrows - printedTotal| exceeds tolerance (rows=${perRowOrdinaryIncome.length})`,
    deltaMagnitude: magnitude(delta),
  };
}

// ——————————————————————————————————————————————————————————————
// C2 乘积一致：sharesVested × vestFmv ≈ ordinaryIncome（独立提取的）。docs/03 §4。
// ——————————————————————————————————————————————————————————————
export interface C2Lot {
  rowIndex: number;
  sharesVested: Decimal;
  vestFmv: Decimal;
  ordinaryIncome: Decimal;
}
export function checkC2(lots: C2Lot[]): CheckResult {
  for (const l of lots) {
    const delta = l.sharesVested.mul(l.vestFmv).sub(l.ordinaryIncome).abs();
    if (delta.gt(CENT)) {
      return {
        check: 'C2',
        status: 'fail',
        level: 'HARD',
        failurePath: 'F12',
        userMessage:
          '每股 FMV × 股数 与补充表上独立列出的普通所得对不上。可能原因：调整后成本列是「总额」而非「每股」；FMV 口径不同；某一列读错了。请核对后重试。',
        detail: `C2: row ${l.rowIndex} product != ordinaryIncome`,
        deltaMagnitude: magnitude(delta),
      };
    }
  }
  return { check: 'C2', status: 'pass', level: 'HARD' };
}

// ——————————————————————————————————————————————————————————————
// C3 股数守恒：sharesVested == sharesWithheld + sharesDelivered（零容差）。docs/03 §4。
// ——————————————————————————————————————————————————————————————
export interface C3Lot {
  rowIndex: number;
  sharesVested: Decimal;
  sharesWithheld: Decimal;
  sharesDelivered: Decimal;
}
export function checkC3(lots: C3Lot[]): CheckResult {
  for (const l of lots) {
    if (!l.sharesVested.equals(l.sharesWithheld.add(l.sharesDelivered))) {
      return {
        check: 'C3',
        status: 'fail',
        level: 'HARD',
        failurePath: 'F15',
        userMessage:
          '股数不守恒：归属股数 ≠ 代扣股数 + 到账股数。这通常是解析错位。请核对该行的三个股数列后重试。',
        detail: `C3: row ${l.rowIndex} vested != withheld + delivered`,
      };
    }
  }
  return { check: 'C3', status: 'pass', level: 'HARD' };
}

// ——————————————————————————————————————————————————————————————
// C4 行数一致：提取行数 == 文档标注的 lot 数（若有）。docs/03 §4。
// docs/05 无独立失败路径；与 C1 同属「漏行/多行」，复用 F11。annotatedLotCount 为 null → 跳过。
// ——————————————————————————————————————————————————————————————
export function checkC4(extractedRowCount: number, annotatedLotCount: number | null): CheckResult {
  if (annotatedLotCount === null) return { check: 'C4', status: 'skip', level: 'HARD' };
  if (extractedRowCount !== annotatedLotCount) {
    return {
      check: 'C4',
      status: 'fail',
      level: 'HARD',
      failurePath: 'F11',
      userMessage:
        '提取到的行数与文档上标注的批次数量不一致，可能漏读或多读了行。请对照原始补充表核对并手工补齐。',
      detail: `C4: extracted=${extractedRowCount} != annotated=${annotatedLotCount}`,
    };
  }
  return { check: 'C4', status: 'pass', level: 'HARD' };
}

// ——————————————————————————————————————————————————————————————
// C5 W-2 锚定：Σ ordinaryIncome ≈ W-2 RSU 合计。docs/03 §4 / docs/05 F13。
// 无 W-2（w2RsuTotal=null）→ 降级 WARN 并标注「未做 W-2 对账」（docs/05 F13）。
// ——————————————————————————————————————————————————————————————
export function checkC5(sumOrdinaryIncome: Decimal, w2RsuTotal: Decimal | null, lotCount: number): CheckResult {
  if (w2RsuTotal === null) {
    return {
      check: 'C5',
      status: 'skip',
      level: 'WARN',
      failurePath: 'F13',
      userMessage: '未提供 W-2，已跳过 W-2 对账。请在汇总页留意：这一层安全网未生效。',
      detail: 'C5: skipped, no W-2 anchor',
    };
  }
  const tol = CENT.mul(Math.max(1, lotCount));
  const delta = sumOrdinaryIncome.sub(w2RsuTotal).abs();
  if (delta.lte(tol)) return { check: 'C5', status: 'pass', level: 'DECIDE' };
  return {
    check: 'C5',
    status: 'fail',
    level: 'DECIDE',
    failurePath: 'F13',
    userMessage:
      '各笔普通所得之和与 W-2 上的 RSU 合计对不上。这通常意味着有一次归属没被这份文件包含，或你的 W-2 里还有其他类型的股权收入。请确认是否漏了文档。',
    detail: `C5: |ΣordinaryIncome - W2| exceeds tolerance (lots=${lotCount})`,
    deltaMagnitude: magnitude(delta),
  };
}

// ——————————————————————————————————————————————————————————————
// C6 长短期回验：引擎算出的 term == 1099-B Box 2 券商标注。docs/03 §4 / docs/05 F14。
// 券商也可能标错 → DECIDE，交用户裁决。computedTerm 由调用方（引擎）传入。
// ——————————————————————————————————————————————————————————————
export interface C6Pair {
  rowIndex: number;
  computedTerm: 'ST' | 'LT';
  brokerTerm: 'ST' | 'LT' | null; // null → 券商未标注，跳过该行
}
export function checkC6(pairs: C6Pair[]): CheckResult {
  const mismatches = pairs.filter((p) => p.brokerTerm !== null && p.brokerTerm !== p.computedTerm);
  if (mismatches.length === 0) return { check: 'C6', status: 'pass', level: 'DECIDE' };
  return {
    check: 'C6',
    status: 'fail',
    level: 'DECIDE',
    failurePath: 'F14',
    userMessage:
      '券商在 1099-B 上标注的持有期（长期/短期）与按归属日计算的结果不一致。券商有时也会标错。请对照归属日与卖出日确认应采用哪一个。',
    detail: `C6: term mismatch on rows [${mismatches.map((m) => m.rowIndex).join(',')}]`,
  };
}

// ——————————————————————————————————————————————————————————————
// C7 二次提取 diff：同一页跑两遍解析器，结果必须完全一致。docs/03 §4 / docs/05 F21。
// 不一致 = 引入了非确定性（bug）→ HARD，InvariantViolation 语义，脱敏上报，不向用户展示细节。
// ——————————————————————————————————————————————————————————————
export function checkC7(firstPass: unknown, secondPass: unknown): CheckResult {
  if (JSON.stringify(firstPass) === JSON.stringify(secondPass)) {
    return { check: 'C7', status: 'pass', level: 'HARD' };
  }
  return {
    check: 'C7',
    status: 'fail',
    level: 'HARD',
    failurePath: 'F21',
    userMessage: '内部一致性校验未通过，我们不会输出可能有误的结果。（这是程序内部问题，已记录待修复。）',
    detail: 'C7: two extraction passes produced different output (non-determinism)',
  };
}

// —— 汇总 ——
export interface CrossCheckSummary {
  results: CheckResult[];
  blocked: boolean; // 存在 HARD 或 DECIDE 的 fail
  hardFailures: CheckResult[];
  decideFailures: CheckResult[];
  warnings: CheckResult[]; // WARN 级（含 skip 的 WARN，如 C5 无 W-2）
}

export function summarize(results: CheckResult[]): CrossCheckSummary {
  const hardFailures = results.filter((r) => r.status === 'fail' && r.level === 'HARD');
  const decideFailures = results.filter((r) => r.status === 'fail' && r.level === 'DECIDE');
  const warnings = results.filter((r) => r.level === 'WARN' && (r.status === 'fail' || r.status === 'skip'));
  return {
    results,
    blocked: hardFailures.length > 0 || decideFailures.length > 0,
    hardFailures,
    decideFailures,
    warnings,
  };
}
