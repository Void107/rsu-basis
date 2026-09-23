// C8 1099-B 合计锚定 —— 对称于 C1，但锚在【1099-B 主表】而非补充表。
// 决策记录见 INDEX.md D16。失败路径 F23。
//
// ⏸ PENDING：与 Fidelity 补充表合计行是【同一个待办】——1099-B 主表是否有印刷合计/小计行
// （以及 Box 1d proceeds、Box 1e cost basis 是否各自有合计）无法从公开样本确认
// （docs/11 §3 / Gate C，docs/09 §7.4-§7.5）。因此：
//   hasPrintedTotal1099B = 'unknown' → 运行时【硬阻断】，不静默跳过。
//   拿到结构描述表后把适配器上那一行改成 'confirmed' | 'absent' 即可。
//
// 逻辑已完整实现并用合成 fixture 双分支测试（test/extraction/c8.test.ts）。
import Decimal from 'decimal.js';
import type { CheckResult } from './errors.js';
import { parseMoney } from './normalize.js';
import type { PrintedTotalStatus } from './brokers/types.js';
import type { TableGrid } from './pdf/index.js';

const CENT = new Decimal('0.01');

/** 可锚定的 1099-B 列。proceeds → Box 1d；reportedBasis → Box 1e。 */
export type C8Column = 'proceeds' | 'reportedBasis';

const COLUMN_CN: Record<C8Column, string> = {
  proceeds: '收入总额（Box 1d）',
  reportedBasis: '成本基础（Box 1e）',
};

/** 能力门 + 比对。与 runC1 同构。 */
export function runC8(args: {
  hasPrintedTotal1099B: PrintedTotalStatus;
  column: C8Column;
  perRowValues: Decimal[];
  printedTotal: Decimal | null;
}): CheckResult {
  const { hasPrintedTotal1099B, column, perRowValues, printedTotal } = args;
  const cn = COLUMN_CN[column];

  if (hasPrintedTotal1099B === 'unknown') {
    return {
      check: 'C8',
      status: 'fail',
      level: 'HARD',
      failurePath: 'F23',
      userMessage:
        '该券商的 1099-B 尚未通过版式验证：合计锚点（印刷合计行）未确认。为避免输出不可信的结果，我们暂不处理该券商的文档。待结构描述表回填合计行信息后即可支持。',
      detail: `C8 gate: hasPrintedTotal1099B=unknown, column=${column} (awaiting structure-description form)`,
    };
  }
  if (hasPrintedTotal1099B === 'absent') {
    return {
      check: 'C8',
      status: 'fail',
      level: 'HARD',
      failurePath: 'F23',
      userMessage:
        '该券商的 1099-B 没有可用于校验的印刷合计行。没有合计锚点的提取不可信，我们暂不支持该券商（同 docs/03 §4 对补充表的要求）。',
      detail: `C8 gate: hasPrintedTotal1099B=absent, column=${column} (broker unsupported, no anchor)`,
    };
  }
  if (printedTotal === null) {
    return {
      check: 'C8',
      status: 'fail',
      level: 'HARD',
      failurePath: 'F23',
      userMessage:
        `这份 1099-B 声明应有印刷合计行，但我们没能定位到${cn}的合计。请对照原始 1099-B 确认合计行位置，或手工补录。`,
      detail: `C8 gate: confirmed but printedTotal not located, column=${column}`,
    };
  }

  const s = perRowValues.reduce((a, b) => a.add(b), new Decimal(0));
  const tol = CENT.mul(Math.max(1, perRowValues.length));
  const delta = s.sub(printedTotal).abs();
  if (delta.lte(tol)) return { check: 'C8', status: 'pass', level: 'HARD' };

  return {
    check: 'C8',
    status: 'fail',
    level: 'HARD',
    failurePath: 'F23',
    userMessage:
      `1099-B 上逐笔${cn}的加总与表上的印刷合计对不上。这通常说明解析时漏读或多读了交易行。请对照原始 1099-B 逐笔核对并手工补齐——为保证结果可信，此处不能「忽略并继续」。`,
    detail: `C8: |Σrows - printedTotal| exceeds tolerance (column=${column}, rows=${perRowValues.length})`,
    deltaMagnitude: magnitudeOf(delta),
  };
}

function magnitudeOf(d: Decimal): string {
  const a = d.abs();
  if (a.isZero()) return '0';
  return `1e${Math.floor(Math.log10(a.toNumber()))}`;
}

/** 在 1099-B 网格里按标记词定位合计行序号；找不到 → -1。 */
export function findTotalRowIndex1099B(grid: TableGrid, totalMarker = 'total'): number {
  const re = new RegExp(totalMarker, 'i');
  return grid.rows.findIndex((r) => r.cells.some((c) => c !== null && re.test(c.text)));
}

/** 从重建后的 1099-B 网格跑完整 C8。能力门优先，非 confirmed 不看数据。 */
export function runC8FromGrid(args: {
  hasPrintedTotal1099B: PrintedTotalStatus;
  grid: TableGrid;
  column: C8Column;
  columnLabel: string;
  totalMarker?: string;
}): CheckResult {
  const { hasPrintedTotal1099B, grid, column, columnLabel, totalMarker = 'total' } = args;
  if (hasPrintedTotal1099B !== 'confirmed') {
    return runC8({ hasPrintedTotal1099B, column, perRowValues: [], printedTotal: null });
  }

  const col = grid.columns.findIndex((c) => c.label === columnLabel);
  if (col < 0) return runC8({ hasPrintedTotal1099B, column, perRowValues: [], printedTotal: null });

  const totalRowIndex = findTotalRowIndex1099B(grid, totalMarker);
  const printedTotal = totalRowIndex >= 0 ? parseMoney(grid.rows[totalRowIndex]!.cells[col]?.text ?? '') : null;

  const perRowValues: Decimal[] = [];
  grid.rows.forEach((r, i) => {
    if (i === totalRowIndex) return;
    const v = parseMoney(r.cells[col]?.text ?? '');
    if (v !== null) perRowValues.push(v);
  });

  return runC8({ hasPrintedTotal1099B, column, perRowValues, printedTotal });
}
