// 归一（docs/03 §2/§3）。R2：不可解析 → null，不猜。
import { describe, it, expect } from 'vitest';
import { parseMoney, parseShares, parseTerm, parseDate } from '../../src/extraction/normalize.js';

describe('parseMoney', () => {
  it('千分位、$、括号负数', () => {
    expect(parseMoney('1,234.56')!.toFixed(2)).toBe('1234.56');
    expect(parseMoney('$5,000.00')!.toFixed(2)).toBe('5000.00');
    expect(parseMoney('(1,234.56)')!.toFixed(2)).toBe('-1234.56');
    expect(parseMoney('0.00')!.toFixed(2)).toBe('0.00');
  });
  it('不可解析 → null（不猜）', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('N/A')).toBeNull();
    expect(parseMoney('--')).toBeNull();
    expect(parseMoney('1.2.3')).toBeNull();
  });
});

describe('parseShares', () => {
  it('分数股保留 4 位，不取整', () => {
    expect(parseShares('12.3456')!.toString()).toBe('12.3456');
    expect(parseShares('1,000')!.toString()).toBe('1000');
  });
  it('不可解析 → null', () => {
    expect(parseShares('abc')).toBeNull();
    expect(parseShares('')).toBeNull();
  });
});

describe('parseTerm', () => {
  it('识别长短期', () => {
    expect(parseTerm('Short-term')).toBe('ST');
    expect(parseTerm('Long-term')).toBe('LT');
    expect(parseTerm('LT')).toBe('LT');
    expect(parseTerm('anything else')).toBeNull();
  });
});

describe('parseDate', () => {
  it('MM/DD/YYYY 与 ISO', () => {
    expect(parseDate('02/15/2024')).toBe('2024-02-15');
    expect(parseDate('2024-02-15')).toBe('2024-02-15');
  });
  it('歧义/未知格式 → null（TODO 由适配器扩展）', () => {
    expect(parseDate('Feb 15, 2024')).toBeNull();
    expect(parseDate('15/02/24')).toBeNull();
    expect(parseDate('13/40/2024')).toBeNull();
  });
});
