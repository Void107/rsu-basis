// 七条交叉校验 C1–C7（docs/03 §4）。每条 pass + fail；fail 必须映射到 docs/05 失败路径
// 且带用户文案（不是 "Error: ..."）。
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  checkC1, checkC2, checkC3, checkC4, checkC5, checkC6, checkC7, summarize,
} from '../../src/extraction/crosschecks.js';
import { CrossCheckError, type CheckResult } from '../../src/extraction/errors.js';

const D = (s: string) => new Decimal(s);

function expectFail(r: CheckResult, path: string) {
  expect(r.status).toBe('fail');
  expect(r.failurePath).toBe(path);
  expect(r.userMessage && r.userMessage.length).toBeGreaterThan(0);
  expect(r.userMessage!.startsWith('Error')).toBe(false);
  // 可构造成可抛出的错误，且携带失败路径与文案
  const err = new CrossCheckError(r);
  expect(err.failurePath).toBe(path);
  expect(err.userMessage).toBe(r.userMessage);
}

describe('C1 合计锚定 → F11', () => {
  it('对齐（容差内）→ pass', () => {
    expect(checkC1([D('5000.00'), D('6200.00')], D('11200.00')).status).toBe('pass');
    expect(checkC1([D('5000.00'), D('6200.005')], D('11200.00')).status).toBe('pass'); // 2 行 → 容差 0.02
  });
  it('漏一行 → fail F11，带文案', () => {
    const r = checkC1([D('5000.00')], D('11200.00'));
    expectFail(r, 'F11');
    expect(r.deltaMagnitude).toBe('1e3');
  });
});

describe('C2 乘积一致 → F12', () => {
  const lot = (o: Partial<{ v: string; f: string; oi: string }> = {}) => ({
    rowIndex: 0, sharesVested: D(o.v ?? '100'), vestFmv: D(o.f ?? '50.00'), ordinaryIncome: D(o.oi ?? '5000.00'),
  });
  it('乘积等于 oi → pass', () => {
    expect(checkC2([lot()]).status).toBe('pass');
  });
  it('调整后成本是总额而非每股 → fail F12', () => {
    // 若 vestFmv 误取了总额 5000，乘积 500000 ≠ 5000
    expectFail(checkC2([lot({ f: '5000.00' })]), 'F12');
  });
});

describe('C3 股数守恒 → F15', () => {
  it('守恒 → pass', () => {
    expect(checkC3([{ rowIndex: 0, sharesVested: D('100'), sharesWithheld: D('40'), sharesDelivered: D('60') }]).status).toBe('pass');
  });
  it('不守恒 → fail F15', () => {
    expectFail(checkC3([{ rowIndex: 0, sharesVested: D('100'), sharesWithheld: D('40'), sharesDelivered: D('55') }]), 'F15');
  });
});

describe('C4 行数一致 → F11（复用）', () => {
  it('无标注 lot 数 → skip', () => {
    expect(checkC4(5, null).status).toBe('skip');
  });
  it('行数一致 → pass；不一致 → fail F11', () => {
    expect(checkC4(5, 5).status).toBe('pass');
    expectFail(checkC4(4, 5), 'F11');
  });
});

describe('C5 W-2 锚定 → F13', () => {
  it('对齐 → pass', () => {
    expect(checkC5(D('27420.00'), D('27420.00'), 5).status).toBe('pass');
  });
  it('无 W-2 → skip + WARN（降级，docs/05 F13）', () => {
    const r = checkC5(D('27420.00'), null, 5);
    expect(r.status).toBe('skip');
    expect(r.level).toBe('WARN');
    expect(r.userMessage).toContain('W-2');
  });
  it('对不上 → fail F13（DECIDE）', () => {
    const r = checkC5(D('27420.00'), D('20000.00'), 5);
    expectFail(r, 'F13');
    expect(r.level).toBe('DECIDE');
  });
});

describe('C6 长短期回验 → F14', () => {
  it('一致（含券商未标注跳过）→ pass', () => {
    expect(checkC6([
      { rowIndex: 0, computedTerm: 'ST', brokerTerm: 'ST' },
      { rowIndex: 1, computedTerm: 'LT', brokerTerm: null },
    ]).status).toBe('pass');
  });
  it('不一致 → fail F14（DECIDE）', () => {
    const r = checkC6([{ rowIndex: 0, computedTerm: 'LT', brokerTerm: 'ST' }]);
    expectFail(r, 'F14');
    expect(r.level).toBe('DECIDE');
  });
});

describe('C7 二次提取 diff → F21', () => {
  it('一致 → pass', () => {
    expect(checkC7([{ a: 1 }], [{ a: 1 }]).status).toBe('pass');
  });
  it('不一致 → fail F21（HARD，不泄技术细节给用户）', () => {
    const r = checkC7([{ a: 1 }], [{ a: 2 }]);
    expectFail(r, 'F21');
    expect(r.level).toBe('HARD');
  });
});

describe('summarize', () => {
  it('汇总阻断态与警告', () => {
    const s = summarize([
      checkC1([D('5000.00')], D('11200.00')), // HARD fail
      checkC5(D('1'), null, 1), // WARN skip
      checkC6([{ rowIndex: 0, computedTerm: 'LT', brokerTerm: 'ST' }]), // DECIDE fail
    ]);
    expect(s.blocked).toBe(true);
    expect(s.hardFailures.map((r) => r.check)).toEqual(['C1']);
    expect(s.decideFailures.map((r) => r.check)).toEqual(['C6']);
    expect(s.warnings.map((r) => r.check)).toEqual(['C5']);
  });

  it('CrossCheckError 对非 fail 结果拒绝构造', () => {
    expect(() => new CrossCheckError({ check: 'C1', status: 'pass', level: 'HARD' })).toThrow();
  });
});
