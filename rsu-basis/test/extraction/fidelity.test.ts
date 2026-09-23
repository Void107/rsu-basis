// Fidelity 适配器（docs/03 §3）。用合成的补充表页测 detect / extract；
// 并锁住当前【诚实状态】：C1 印刷合计锚点未确认 → supported=false（docs/03 §4）。
import { describe, it, expect } from 'vitest';
import { fidelityAdapter } from '../../src/extraction/brokers/fidelity.js';
import type { PageText, TextItem } from '../../src/extraction/pdf/index.js';

const ti = (str: string, x: number, y: number, width: number): TextItem => ({ str, x, y, width, height: 10 });

// 合成的「像 Fidelity 补充表」的页：品牌标记 + 表头（docs/11 §4 原文）+ 两数据行。
function supplementalPage(): PageText {
  return {
    page: 6,
    width: 612,
    height: 792,
    items: [
      ti('Fidelity Stock Plan Services', 36, 760, 200),
      ti('Supplemental Information', 36, 740, 180),
      // 表头 y=700
      ti('Date Acquired', 50, 700, 70),
      ti('Quantity', 200, 700, 50),
      ti('Ordinary Income Reported', 330, 700, 150),
      ti('Adjusted Cost or Other Basis', 500, 700, 90),
      // 数据行1 y=680
      ti('02/15/2024', 50, 680, 60),
      ti('100', 235, 680, 15),
      ti('5,000.00', 420, 680, 45),
      ti('50.00', 545, 680, 40),
      // 数据行2 y=660
      ti('05/15/2024', 50, 660, 60),
      ti('100', 235, 660, 15),
      ti('6,200.00', 420, 660, 45),
      ti('62.00', 545, 660, 40),
    ],
  };
}

describe('fidelity adapter', () => {
  it('detect：品牌 + 补充表标记 → 高置信度', () => {
    expect(fidelityAdapter.detect([supplementalPage()])).toBeGreaterThanOrEqual(0.9);
    expect(fidelityAdapter.detect([{ page: 1, width: 612, height: 792, items: [ti('unrelated', 0, 0, 10)] }])).toBe(0);
  });

  it('locateSupplemental：命中 "Supplemental Information" 页', () => {
    expect(fidelityAdapter.locateSupplemental([supplementalPage()])).toEqual({ startPage: 6, endPage: 6 });
  });

  it('extract：按 columnMap 列头重建表并产出候选', () => {
    const cands = fidelityAdapter.extract([supplementalPage()], 'hash', 'f.pdf');
    const labels = new Set(cands.map((c) => c.columnLabel));
    expect(labels.has('Date Acquired')).toBe(true);
    expect(labels.has('Ordinary Income Reported')).toBe(true);
    // 找到「第 2 行 · Ordinary Income Reported」的候选
    const oi = cands.find((c) => c.columnLabel === 'Ordinary Income Reported' && c.source.rowIndex === 1);
    expect(oi?.rawText).toBe('6,200.00');
    for (const c of cands) expect(c.source.method).toBe('rule');
  });

  it('C1/C8 印刷合计能力均未验证 → unknown（docs/03 §4 / INDEX.md D16，不猜）', () => {
    expect(fidelityAdapter.hasPrintedTotalSupplemental).toBe('unknown');
    expect(fidelityAdapter.hasPrintedTotal1099B).toBe('unknown');
  });

  it('columnMap 只映射确证字段，不猜 Fidelity 已算好的量', () => {
    expect(fidelityAdapter.columnMap['Adjusted cost basis']).toBeUndefined();
    expect(fidelityAdapter.columnMap['Adjusted gain/loss']).toBeUndefined();
    expect(fidelityAdapter.columnMap['Ordinary Income Reported']).toBe('ordinaryIncome');
  });
});
