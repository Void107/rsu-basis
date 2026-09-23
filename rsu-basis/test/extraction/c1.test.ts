// C1 完整实现（docs/03 §4）：能力门（三态）+ 定位印刷合计行 + 逐行比对。
// 合成 fixture 里【控制合计行的有无】，两种分支都覆盖。所有 C1 阻断映射到 docs/05 F11。
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { runC1, runC1FromGrid, findTotalRowIndex } from '../../src/extraction/c1.js';
import { CrossCheckError } from '../../src/extraction/errors.js';
import type { TableGrid } from '../../src/extraction/pdf/index.js';

const D = (s: string) => new Decimal(s);

// 构造一个两列网格：Quantity | Ordinary Income Reported，可选带印刷合计行。
function grid(withTotal: boolean, opts: { rowsSum?: string; totalValue?: string } = {}): TableGrid {
  const OI = 'Ordinary Income Reported';
  const rows: TableGrid['rows'] = [
    { rowIndex: 0, y: 680, cells: [{ text: '100', x: 200, y: 680 }, { text: '5,000.00', x: 400, y: 680 }] },
    { rowIndex: 1, y: 660, cells: [{ text: '100', x: 200, y: 660 }, { text: '6,200.00', x: 400, y: 660 }] },
  ];
  if (withTotal) {
    rows.push({ rowIndex: 2, y: 640, cells: [{ text: 'Total', x: 200, y: 640 }, { text: opts.totalValue ?? '11,200.00', x: 400, y: 640 }] });
  }
  return {
    page: 6,
    headerY: 700,
    columns: [
      { label: 'Quantity', headerX: 210, bandLeft: -Infinity, bandRight: 305 },
      { label: OI, headerX: 410, bandLeft: 305, bandRight: Infinity },
    ],
    rows,
  };
}

describe('runC1 能力门（三态）', () => {
  it("'unknown' → 硬阻断 F11，文案含「等待结构描述表回填」", () => {
    const r = runC1({ hasPrintedTotal: 'unknown', perRowOrdinaryIncome: [], printedTotal: null });
    expect(r.status).toBe('fail');
    expect(r.level).toBe('HARD');
    expect(r.failurePath).toBe('F11');
    expect(r.userMessage).toContain('结构描述表');
    // 可抛出、带文案
    expect(new CrossCheckError(r).userMessage).toBe(r.userMessage);
  });

  it("'absent' → 硬阻断 F11，明确不支持该券商", () => {
    const r = runC1({ hasPrintedTotal: 'absent', perRowOrdinaryIncome: [], printedTotal: null });
    expect(r.status).toBe('fail');
    expect(r.failurePath).toBe('F11');
    expect(r.userMessage).toContain('不支持');
  });

  it("'confirmed' 但没定位到合计值 → 硬阻断 F11（不放行无锚点提取）", () => {
    const r = runC1({ hasPrintedTotal: 'confirmed', perRowOrdinaryIncome: [D('5000.00')], printedTotal: null });
    expect(r.status).toBe('fail');
    expect(r.failurePath).toBe('F11');
  });

  it("'confirmed' + 合计对齐 → pass；不对齐 → fail F11", () => {
    expect(runC1({ hasPrintedTotal: 'confirmed', perRowOrdinaryIncome: [D('5000.00'), D('6200.00')], printedTotal: D('11200.00') }).status).toBe('pass');
    expect(runC1({ hasPrintedTotal: 'confirmed', perRowOrdinaryIncome: [D('5000.00')], printedTotal: D('11200.00') }).status).toBe('fail');
  });
});

describe('findTotalRowIndex', () => {
  it('有合计行 → 命中其序号；无 → -1', () => {
    expect(findTotalRowIndex(grid(true))).toBe(2);
    expect(findTotalRowIndex(grid(false))).toBe(-1);
  });
});

describe('runC1FromGrid（分支：合计行有 / 无）', () => {
  const OI = 'Ordinary Income Reported';

  it('confirmed + 有合计行 + 逐行与合计对齐 → pass', () => {
    const r = runC1FromGrid({ hasPrintedTotal: 'confirmed', grid: grid(true), oiColumnLabel: OI });
    expect(r.status).toBe('pass');
  });

  it('confirmed + 有合计行 + 逐行漏读一行（合计对不上）→ fail F11', () => {
    // 合计行写 17,400（好像有第三行），但只解析出两行 → 逐行 11,200 ≠ 17,400
    const r = runC1FromGrid({ hasPrintedTotal: 'confirmed', grid: grid(true, { totalValue: '17,400.00' }), oiColumnLabel: OI });
    expect(r.status).toBe('fail');
    expect(r.failurePath).toBe('F11');
    expect(r.deltaMagnitude).toBe('1e3');
  });

  it('confirmed + 无合计行 → 硬阻断 F11（定位不到印刷合计）', () => {
    const r = runC1FromGrid({ hasPrintedTotal: 'confirmed', grid: grid(false), oiColumnLabel: OI });
    expect(r.status).toBe('fail');
    expect(r.failurePath).toBe('F11');
    expect(r.detail).toContain('not located');
  });

  it('unknown → 不看数据直接硬阻断（即使网格里其实有合计行）', () => {
    const r = runC1FromGrid({ hasPrintedTotal: 'unknown', grid: grid(true), oiColumnLabel: OI });
    expect(r.status).toBe('fail');
    expect(r.userMessage).toContain('结构描述表');
  });
});
