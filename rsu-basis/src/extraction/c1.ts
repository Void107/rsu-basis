// C1 合计锚定 · 完整实现（docs/03 §4：最重要的一条）。
// = 能力门（PrintedTotalStatus 三态）+ 定位印刷合计行 + 逐行合计比对（checkC1）。
//
// 能力门优先：hasPrintedTotal 非 'confirmed' 时【硬阻断】，不去看数据、不静默跳过——
// 'unknown' 明确提示「等待结构描述表回填」，'absent' 明确「无锚点故不支持该券商」。
// 所有 C1 相关阻断都归到 docs/05 F11（C1 的失败路径），用 userMessage/detail 区分成因。
import Decimal from 'decimal.js';
import type { CheckResult } from './errors.js';
import { checkC1 } from './crosschecks.js';
import { parseMoney } from './normalize.js';
import type { PrintedTotalStatus } from './brokers/types.js';
import type { TableGrid } from './pdf/index.js';

/** 能力门 + 比对。printedTotal 由 confirmed 分支定位得到；未定位到则为 null。 */
export function runC1(args: {
  hasPrintedTotal: PrintedTotalStatus;
  perRowOrdinaryIncome: Decimal[];
  printedTotal: Decimal | null;
}): CheckResult {
  const { hasPrintedTotal, perRowOrdinaryIncome, printedTotal } = args;

  if (hasPrintedTotal === 'unknown') {
    return {
      check: 'C1',
      status: 'fail',
      level: 'HARD',
      failurePath: 'F11',
      userMessage:
        '该券商的成本基础补充表尚未通过版式验证：C1 合计锚点（印刷合计行）未确认。为避免输出不可信的结果，我们暂不处理该券商的文档。待结构描述表回填合计行信息后即可支持。',
      detail: 'C1 gate: hasPrintedTotal=unknown (awaiting structure-description form)',
    };
  }
  if (hasPrintedTotal === 'absent') {
    return {
      check: 'C1',
      status: 'fail',
      level: 'HARD',
      failurePath: 'F11',
      userMessage:
        '该券商的补充表没有可用于校验的印刷合计行。没有合计锚点的提取不可信，我们暂不支持该券商（docs/03 §4）。',
      detail: 'C1 gate: hasPrintedTotal=absent (broker unsupported, no anchor)',
    };
  }
  // confirmed：必须能真正定位到印刷合计值，否则同样阻断（不放行没有锚点的提取）。
  if (printedTotal === null) {
    return {
      check: 'C1',
      status: 'fail',
      level: 'HARD',
      failurePath: 'F11',
      userMessage:
        '这份文档声明应有印刷合计行，但我们没能在补充表中定位到它。请对照原始补充表确认合计行位置，或手工补录。',
      detail: 'C1 gate: hasPrintedTotal=confirmed but printedTotal not located in document',
    };
  }
  return checkC1(perRowOrdinaryIncome, printedTotal);
}

/** 在网格里按标记词（默认 "total"）定位印刷合计行的序号；找不到 → -1。 */
export function findTotalRowIndex(grid: TableGrid, totalMarker = 'total'): number {
  const re = new RegExp(totalMarker, 'i');
  return grid.rows.findIndex((r) => r.cells.some((c) => c !== null && re.test(c.text)));
}

/**
 * 从重建后的网格跑完整 C1：
 *   - 能力门（hasPrintedTotal）优先阻断
 *   - confirmed 时：定位合计行 → 取其 ordinaryIncome 列为印刷合计；其余行为逐行合计
 * oiColumnLabel 为补充表里 ordinaryIncome 列的表头原文（适配器 columnMap 的键）。
 */
export function runC1FromGrid(args: {
  hasPrintedTotal: PrintedTotalStatus;
  grid: TableGrid;
  oiColumnLabel: string;
  totalMarker?: string;
}): CheckResult {
  const { hasPrintedTotal, grid, oiColumnLabel, totalMarker = 'total' } = args;
  // 能力门优先：非 confirmed 不看数据直接阻断。
  if (hasPrintedTotal !== 'confirmed') {
    return runC1({ hasPrintedTotal, perRowOrdinaryIncome: [], printedTotal: null });
  }

  const oiCol = grid.columns.findIndex((c) => c.label === oiColumnLabel);
  if (oiCol < 0) {
    return runC1({ hasPrintedTotal, perRowOrdinaryIncome: [], printedTotal: null });
  }

  const totalRowIndex = findTotalRowIndex(grid, totalMarker);
  const printedTotal =
    totalRowIndex >= 0 ? parseMoney(grid.rows[totalRowIndex]!.cells[oiCol]?.text ?? '') : null;

  const perRowOrdinaryIncome: Decimal[] = [];
  grid.rows.forEach((r, i) => {
    if (i === totalRowIndex) return; // 合计行不计入逐行合计
    const v = parseMoney(r.cells[oiCol]?.text ?? '');
    if (v !== null) perRowOrdinaryIncome.push(v);
  });

  return runC1({ hasPrintedTotal, perRowOrdinaryIncome, printedTotal });
}
