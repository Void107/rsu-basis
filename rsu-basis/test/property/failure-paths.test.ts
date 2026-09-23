// 失败路径测试（docs/05）。CLAUDE.md §3：先写失败路径，happy path 最不需要保护。
// 每条断言一个具体的阻断态与错误类型——「算不出来」是可接受输出，「自信地算错」不是。
import { describe, it, expect } from 'vitest';
import {
  runRawLedger,
  reconcile,
  emit8949Rows,
  normalizeVestEvents,
  classifyHoldingPeriod,
  plusOneYear,
  money,
  shares,
  type Match,
  type SaleEvent,
  type VestLot,
  type W2Anchor,
} from '../../src/engine/index.js';

const SRC = { fileHash: 's', fileName: 's', page: 1, rowIndex: null, columnLabel: null, method: 'manual' as const, confidence: 1, rawText: 's' };

function lot(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'L0', grantId: 'G0', vestDate: '2024-01-15',
    sharesVested: '10', sharesWithheld: '0', sharesDelivered: '10',
    vestFmv: '10.00', ordinaryIncome: '100.00', fmvConvention: 'close', sources: [SRC],
    ...over,
  };
}
function sale(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'S0', saleDate: '2024-06-01', sharesSold: '10', proceeds: '200.00',
    proceedsBasis: 'gross', reportedBasis: '0.00', reportedTerm: null, covered: true,
    basisReportedToIRS: true, saleKind: 'open_market', sources: [SRC],
    ...over,
  };
}
function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  const clone = { ...obj };
  delete (clone as Record<string, unknown>)[key];
  return clone;
}
function ledger(lots: unknown[], sales: unknown[], anchor?: unknown) {
  return {
    schemaVersion: 1, taxYear: 2024, ticker: 'TEST',
    vestLots: lots, saleEvents: sales,
    w2Anchor: anchor ?? { taxYear: 2024, box1Total: null, rsuIncomeReported: null, rsuIncomeSource: null, sources: [SRC] },
  };
}

describe('F-missing — R2: null 必需字段 → MissingDataError', () => {
  it('vestFmv 为 null → MissingDataError(field=vestFmv)', () => {
    const res = runRawLedger(ledger([lot({ vestFmv: null })], [sale()]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('MissingDataError');
      expect((res.error as { field: string }).field).toBe('vestFmv');
    }
  });

  it('sharesSold 为 null → MissingDataError', () => {
    const res = runRawLedger(ledger([lot()], [sale({ sharesSold: null })]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('MissingDataError');
  });

  it('basisReportedToIRS 缺失 → MissingDataError（不默认，docs/01 §6.1）', () => {
    const s = sale();
    delete (s as Record<string, unknown>)['basisReportedToIRS'];
    const res = runRawLedger(ledger([lot()], [s]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('MissingDataError');
      expect((res.error as { field: string }).field).toBe('basisReportedToIRS');
    }
  });

  it('reportedBasis 为 null（计算路径）→ MissingDataError，不 ?? 0（R2）', () => {
    const res = runRawLedger(ledger([lot()], [sale({ reportedBasis: null })]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('MissingDataError');
      expect((res.error as { field: string }).field).toBe('reportedBasis');
    }
  });

  // 以下字段原先在 decode 里被静默默认，现在必需（R2：不设默认）。
  it.each([
    ['proceedsBasis', () => ledger([lot()], [omit(sale(), 'proceedsBasis')])],
    ['covered', () => ledger([lot()], [omit(sale(), 'covered')])],
    ['saleKind', () => ledger([lot()], [omit(sale(), 'saleKind')])],
    ['id', () => ledger([lot()], [omit(sale(), 'id')])],
    ['fmvConvention', () => ledger([omit(lot(), 'fmvConvention')], [sale()])],
    ['ticker', () => omit(ledger([lot()], [sale()]), 'ticker')],
  ])('%s 缺失 → MissingDataError（不默认）', (field, build) => {
    const res = runRawLedger(build());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('MissingDataError');
      expect((res.error as { field: string }).field).toBe(field);
    }
  });
});

describe('F12 — C2：sharesVested × vestFmv ≠ ordinaryIncome → ReconciliationError', () => {
  it('oi 与乘积不符（超容差）', () => {
    const res = runRawLedger(ledger([lot({ ordinaryIncome: '150.00' })], [sale()]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('ReconciliationError');
      expect((res.error as { check: string }).check).toBe('C2');
    }
  });
});

describe('F15 — C3：股数不守恒 → ReconciliationError', () => {
  it('sharesVested ≠ withheld + delivered', () => {
    const res = runRawLedger(ledger([lot({ sharesWithheld: '3', sharesDelivered: '5' })], []));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('ReconciliationError');
      expect((res.error as { check: string }).check).toBe('C3');
    }
  });
});

describe('F7 — I2：卖出股数 > 可交付股数 → OutOfScopeError', () => {
  it('open-market 卖 20，仅交付 10', () => {
    const res = runRawLedger(ledger([lot()], [sale({ sharesSold: '20', proceeds: '400.00' })]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('OutOfScopeError');
  });
});

describe('F16 — 同日多 vest、STC 无法唯一配对 → AmbiguousMatchError', () => {
  it('两 lot 同日 vest 且 withheld 相同，STC 匹配两者', () => {
    const l1 = lot({ id: 'A', vestDate: '2024-05-15', sharesVested: '100', sharesWithheld: '40', sharesDelivered: '60', vestFmv: '10.00', ordinaryIncome: '1000.00' });
    const l2 = lot({ id: 'B', grantId: 'G1', vestDate: '2024-05-15', sharesVested: '100', sharesWithheld: '40', sharesDelivered: '60', vestFmv: '10.00', ordinaryIncome: '1000.00' });
    const stc = sale({ id: 'S1', saleDate: '2024-05-15', sharesSold: '40', proceeds: '400.00', saleKind: 'sell_to_cover' });
    const res = runRawLedger(ledger([l1, l2], [stc]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('AmbiguousMatchError');
      expect((res.error as { candidateLotIds: string[] }).candidateLotIds.sort()).toEqual(['A', 'B']);
    }
  });
});

describe('F13 — C5：W-2 锚定', () => {
  it('anchor 缺失 → 降级 WARN（C5_SKIPPED_NO_W2_ANCHOR）', () => {
    const res = runRawLedger(ledger([lot()], [sale()]));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.reconcile.warnings).toContain('C5_SKIPPED_NO_W2_ANCHOR');
  });

  it('anchor 与 Σ oi 不符（超容差）→ ReconciliationError(C5)', () => {
    const anchor = { taxYear: 2024, box1Total: null, rsuIncomeReported: '200.00', rsuIncomeSource: 'box14', sources: [SRC] };
    const res = runRawLedger(ledger([lot()], [sale()], anchor));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('ReconciliationError');
      expect((res.error as { check: string }).check).toBe('C5');
    }
  });
});

describe('F19 — I5：调整方向为正 → InvariantViolation（安全带，不可关闭）', () => {
  const badMatch: Match = {
    saleId: 'S0', lotId: 'L0', sharesMatched: shares('10'),
    proceedsPortion: money('200.00'),
    adjustedBasis: money('50.00'),        // < reportedBasisPortion → 调整额为正
    reportedBasisPortion: money('100.00'),
    term: 'ST', matchMethod: 'fifo',
  };

  it('reconcile 检出正调整额 → InvariantViolation(I5)', () => {
    const anchor: W2Anchor = { taxYear: 2024, box1Total: null, rsuIncomeReported: null, rsuIncomeSource: null, sources: [] };
    const res = reconcile([], anchor, [badMatch]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('InvariantViolation');
      expect((res.error as { invariant: string }).invariant).toBe('I5');
    }
  });

  it('emit8949Rows 对正调整额抛 InvariantViolation', () => {
    const l: VestLot = {
      id: 'L0', grantId: 'G0', vestDate: '2024-01-15',
      sharesVested: shares('10'), sharesWithheld: shares('0'), sharesDelivered: shares('10'),
      vestFmv: money('10.00'), ordinaryIncome: money('100.00'), fmvConvention: 'close', sources: [],
    };
    const s: SaleEvent = {
      id: 'S0', saleDate: '2024-06-01', sharesSold: shares('10'), proceeds: money('200.00'),
      proceedsBasis: 'gross', reportedBasis: money('100.00'), reportedTerm: null, covered: true,
      basisReportedToIRS: true, saleKind: 'open_market', sources: [],
    };
    expect(() => emit8949Rows([badMatch], [s], [l], 'TEST')).toThrow(/I5/);
  });
});

describe('normalizeVestEvents 直接校验', () => {
  it('合法 lot 通过', () => {
    const res = normalizeVestEvents([{
      id: 'L0', grantId: 'G0', vestDate: '2024-01-15',
      sharesVested: shares('10'), sharesWithheld: shares('0'), sharesDelivered: shares('10'),
      vestFmv: money('10.00'), ordinaryIncome: money('100.00'), fmvConvention: 'close', sources: [],
    }]);
    expect(res.ok).toBe(true);
  });
});

describe('持有期边界（docs/02 §2.1、docs/10 §6）——「超过一年」而非「满一年」', () => {
  it('vest 2024-03-15，sale 2025-03-15（恰好一年）→ ST', () => {
    expect(classifyHoldingPeriod('2024-03-15', '2025-03-15')).toBe('ST');
  });
  it('vest 2024-03-15，sale 2025-03-16（一年零一天）→ LT', () => {
    expect(classifyHoldingPeriod('2024-03-15', '2025-03-16')).toBe('LT');
  });
  it('闰日 vest 2024-02-29 + 1年 = 2025-02-28', () => {
    expect(plusOneYear('2024-02-29')).toBe('2025-02-28');
  });
  it('闰日：vest 2024-02-29，sale 2025-02-28（恰好一年）→ ST', () => {
    expect(classifyHoldingPeriod('2024-02-29', '2025-02-28')).toBe('ST');
  });
  it('闰日：vest 2024-02-29，sale 2025-03-01（超过一年）→ LT', () => {
    expect(classifyHoldingPeriod('2024-02-29', '2025-03-01')).toBe('LT');
  });
});

describe('docs/01 §6.1 第二形态：基础未报送 IRS → Box B/E，正确基础进 (e)、无代码', () => {
  it('basisReportedToIRS=false 的 ST 卖出 → Box B、无 adjustmentCode、(e)=正确基础', () => {
    const res = runRawLedger(ledger([lot()], [sale({ basisReportedToIRS: false })]));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = res.value.form8949.rows[0]!;
    expect(row.box).toBe('B');
    expect(row.adjustmentCode).toBeUndefined();
    expect(row.adjustmentAmount).toBeUndefined();
    expect(row.costBasisReported.toFixed(2)).toBe('100.00'); // = 正确基础 10*10
    expect(row.gainLoss.toFixed(2)).toBe('100.00');          // 200 - 100
  });
});
