// C8 1099-B 合计锚定（INDEX.md D16，失败路径 F23）。
// ⏸ PENDING：适配器上 hasPrintedTotal1099B='unknown' → 运行时硬阻断。
// 逻辑本身完整实现，此处用合成 fixture 覆盖【有合计行 / 无合计行】两个分支。
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { runC8, runC8FromGrid, findTotalRowIndex1099B } from '../../src/extraction/c8.js';
import { CrossCheckError } from '../../src/extraction/errors.js';
import type { TableGrid } from '../../src/extraction/pdf/index.js';

const D = (s: string) => new Decimal(s);
const PROCEEDS_LABEL = '1d Proceeds';

/** 合成 1099-B 网格：Description | 1d Proceeds，可控是否带印刷合计行。 */
function grid(withTotal: boolean, opts: { totalValue?: string } = {}): TableGrid {
  const rows: TableGrid['rows'] = [
    { rowIndex: 0, y: 680, cells: [{ text: '40 sh ACME', x: 50, y: 680 }, { text: '2,000.00', x: 400, y: 680 }] },
    { rowIndex: 1, y: 660, cells: [{ text: '40 sh ACME', x: 50, y: 660 }, { text: '2,480.00', x: 400, y: 660 }] },
  ];
  if (withTotal) {
    rows.push({ rowIndex: 2, y: 640, cells: [{ text: 'Total', x: 50, y: 640 }, { text: opts.totalValue ?? '4,480.00', x: 400, y: 640 }] });
  }
  return {
    page: 5,
    headerY: 700,
    columns: [
      { label: 'Description', headerX: 60, bandLeft: -Infinity, bandRight: 300 },
      { label: PROCEEDS_LABEL, headerX: 410, bandLeft: 300, bandRight: Infinity },
    ],
    rows,
  };
}

describe('runC8 能力门（三态，与 C1 同构）', () => {
  it("'unknown' → 硬阻断 F23，文案含「结构描述表」（pending，同补充表待办）", () => {
    const r = runC8({ hasPrintedTotal1099B: 'unknown', column: 'proceeds', perRowValues: [], printedTotal: null });
    expect(r.status).toBe('fail');
    expect(r.level).toBe('HARD');
    expect(r.failurePath).toBe('F23');
    expect(r.userMessage).toContain('结构描述表');
    expect(new CrossCheckError(r).userMessage).toBe(r.userMessage);
  });

  it("'absent' → 硬阻断 F23，明确不支持该券商", () => {
    const r = runC8({ hasPrintedTotal1099B: 'absent', column: 'proceeds', perRowValues: [], printedTotal: null });
    expect(r.status).toBe('fail');
    expect(r.userMessage).toContain('不支持');
  });

  it("'confirmed' 但未定位到合计 → 硬阻断 F23", () => {
    const r = runC8({ hasPrintedTotal1099B: 'confirmed', column: 'proceeds', perRowValues: [D('2000.00')], printedTotal: null });
    expect(r.status).toBe('fail');
    expect(r.failurePath).toBe('F23');
  });

  it("'confirmed' + 对齐 → pass；漏一笔 → fail F23", () => {
    expect(runC8({ hasPrintedTotal1099B: 'confirmed', column: 'proceeds', perRowValues: [D('2000.00'), D('2480.00')], printedTotal: D('4480.00') }).status).toBe('pass');
    const bad = runC8({ hasPrintedTotal1099B: 'confirmed', column: 'proceeds', perRowValues: [D('2000.00')], printedTotal: D('4480.00') });
    expect(bad.status).toBe('fail');
    expect(bad.deltaMagnitude).toBe('1e3');
  });

  it('reportedBasis 列（Box 1e）同样可锚定，文案指向 Box 1e', () => {
    const r = runC8({ hasPrintedTotal1099B: 'confirmed', column: 'reportedBasis', perRowValues: [D('0.00')], printedTotal: D('500.00') });
    expect(r.status).toBe('fail');
    expect(r.userMessage).toContain('Box 1e');
  });
});

describe('findTotalRowIndex1099B', () => {
  it('有/无合计行', () => {
    expect(findTotalRowIndex1099B(grid(true))).toBe(2);
    expect(findTotalRowIndex1099B(grid(false))).toBe(-1);
  });
});

describe('runC8FromGrid（分支：合计行有 / 无）', () => {
  it('confirmed + 有合计行 + 对齐 → pass', () => {
    expect(runC8FromGrid({ hasPrintedTotal1099B: 'confirmed', grid: grid(true), column: 'proceeds', columnLabel: PROCEEDS_LABEL }).status).toBe('pass');
  });

  it('confirmed + 有合计行 + 漏读一笔（合计对不上）→ fail F23', () => {
    const r = runC8FromGrid({ hasPrintedTotal1099B: 'confirmed', grid: grid(true, { totalValue: '7,280.00' }), column: 'proceeds', columnLabel: PROCEEDS_LABEL });
    expect(r.status).toBe('fail');
    expect(r.failurePath).toBe('F23');
  });

  it('confirmed + 无合计行 → 硬阻断（定位不到印刷合计）', () => {
    const r = runC8FromGrid({ hasPrintedTotal1099B: 'confirmed', grid: grid(false), column: 'proceeds', columnLabel: PROCEEDS_LABEL });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('not located');
  });

  it('unknown → 不看数据直接阻断（即使网格里有合计行）', () => {
    const r = runC8FromGrid({ hasPrintedTotal1099B: 'unknown', grid: grid(true), column: 'proceeds', columnLabel: PROCEEDS_LABEL });
    expect(r.status).toBe('fail');
    expect(r.userMessage).toContain('结构描述表');
  });
});
