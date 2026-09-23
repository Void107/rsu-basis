// C9 逐字符回比（INDEX.md D15，失败路径 F22）。立即生效，不依赖 Gate C。
// 挡的是【解析层读错】：值必须能由 rawText 逐字符复现。
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { checkC9, type C9Field } from '../../src/extraction/c9.js';
import { CrossCheckError } from '../../src/extraction/errors.js';

const D = (s: string) => new Decimal(s);
const f = (over: Partial<C9Field> = {}): C9Field => ({
  rowIndex: 0, fieldName: 'proceeds', rawText: '2,000.00', value: D('2000.00'), kind: 'money', method: 'rule', ...over,
});

describe('C9 回比通过', () => {
  it('金额：千分位原文 ↔ Decimal', () => {
    expect(checkC9([f()]).status).toBe('pass');
  });
  it('日期：MM/DD/YYYY 原文 ↔ ISO 值', () => {
    expect(checkC9([f({ fieldName: 'saleDate', rawText: '02/15/2024', value: '2024-02-15', kind: 'date' })]).status).toBe('pass');
  });
  it('括号负数与分数股', () => {
    expect(checkC9([f({ rawText: '(1,234.56)', value: D('-1234.56') })]).status).toBe('pass');
    expect(checkC9([f({ fieldName: 'sharesSold', rawText: '12.3456', value: D('12.3456'), kind: 'shares' })]).status).toBe('pass');
  });
});

describe('C9 回比失败 → F22 硬阻断', () => {
  const expectFail = (fields: C9Field[]) => {
    const r = checkC9(fields);
    expect(r.status).toBe('fail');
    expect(r.level).toBe('HARD');
    expect(r.failurePath).toBe('F22');
    expect(r.userMessage!.startsWith('Error')).toBe(false);
    expect(new CrossCheckError(r).failurePath).toBe('F22');
    return r;
  };

  it('金额读错一位（洞 A/B：proceeds / reportedBasis）', () => {
    expectFail([f({ value: D('2001.00') })]);
    expectFail([f({ fieldName: 'reportedBasis', rawText: '0.00', value: D('1.00') })]);
  });

  it('日期错一天（洞 C），即使未跨越持有期边界', () => {
    expectFail([f({ fieldName: 'saleDate', rawText: '02/15/2024', value: '2024-02-16', kind: 'date' })]);
  });

  it('原文不可解析（读到了别的单元格）', () => {
    const r = expectFail([f({ rawText: 'N/A' })]);
    expect(r.detail).toContain('not parseable');
  });

  it('method=llm（推断值）一律拒绝——推断无法逐字符回比', () => {
    const r = expectFail([f({ method: 'llm' })]);
    expect(r.detail).toContain('llm');
  });
});

describe('C9 边界', () => {
  it('空字段集 → skip（没接上不算通过）', () => {
    expect(checkC9([]).status).toBe('skip');
  });
  it('多字段中任意一个失败即阻断', () => {
    expect(checkC9([f(), f({ rowIndex: 1, value: D('9999.00') })]).status).toBe('fail');
  });
});
