// §7 生成后自检 —— 必须实现，不通过不交付。
//
//   1. 用 exceljs【读回文件】
//   2. 用求值器计算所有公式格（只依据读回来的内容）
//   3. 与引擎输出的数值逐格比对，【零容差】
//   4. 验证 _ledger round-trip 一致
//   5. 任何一项不通过 → 不交付，报 InvariantViolation
//
// 为什么必须读回文件而不是校验内存里的对象：公式字符串是手写拼接的，最常见的 bug 是
// 引用行号偏移一行。那类 bug 不抛异常，只产出一份看起来正常但数字全错的表。
// 只有「按文件里真实写着的公式去算，再和引擎的数比」才能抓住它。
import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { InvariantViolation } from '../../engine/index.js';
import { evaluateCell, type CellValue, type SheetView, type WorkbookView } from './evaluate.js';
import { decodeLedger } from './ledgerBlob.js';
import type { CellExpectation } from './build.js';

export interface SelfCheckFailure {
  sheet: string;
  cell: string;
  what: string;
  expected: string;
  actual: string;
}
export interface SelfCheckReport {
  ok: boolean;
  cellsChecked: number;
  formulaCells: number;
  failures: SelfCheckFailure[];
  ledgerRoundTrip: 'ok' | 'mismatch' | 'error';
}

/** exceljs 工作簿 → 求值器用的视图。数字/日期一律转 Decimal（日期转 Excel 序列号）。 */
export function toWorkbookView(wb: ExcelJS.Workbook): WorkbookView {
  const view: WorkbookView = new Map();
  wb.eachSheet((ws) => {
    const literals = new Map<string, CellValue>();
    const formulas = new Map<string, string>();
    let maxRow = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      maxRow = Math.max(maxRow, rowNumber);
      row.eachCell({ includeEmpty: false }, (cell) => {
        const addr = cell.address.replace(/\$/g, '');
        const v = cell.value as unknown;
        if (v && typeof v === 'object' && 'formula' in (v as object)) {
          formulas.set(addr, String((v as { formula: string }).formula));
          return;
        }
        if (v === null || v === undefined) return;
        if (v instanceof Date) {
          const serial = Math.round((v.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
          literals.set(addr, new Decimal(serial));
        } else if (typeof v === 'number') {
          // 经由字符串构造，保证 float → Decimal 无额外误差
          literals.set(addr, new Decimal(String(v)));
        } else if (typeof v === 'boolean') {
          literals.set(addr, v);
        } else if (typeof v === 'object' && 'richText' in (v as object)) {
          literals.set(addr, (v as { richText: { text: string }[] }).richText.map((t) => t.text).join(''));
        } else {
          literals.set(addr, String(v));
        }
      });
    });
    view.set(ws.name, { literals, formulas, maxRow });
  });
  return view;
}

const show = (v: CellValue): string =>
  v === null ? '<empty>' : v instanceof Decimal ? v.toFixed() : typeof v === 'boolean' ? String(v) : v;

/** 从 buffer 读回并自检。 */
export async function selfCheck(
  buffer: ArrayBuffer | Uint8Array,
  expectations: CellExpectation[],
  originalLedger: unknown,
): Promise<SelfCheckReport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const view = toWorkbookView(wb);

  const failures: SelfCheckFailure[] = [];
  let formulaCells = 0;
  for (const sheet of view.values()) formulaCells += sheet.formulas.size;

  // —— 3. 逐格零容差比对 ——
  for (const e of expectations) {
    let actual: CellValue;
    try {
      actual = evaluateCell(view, e.sheet, e.cell);
    } catch (err) {
      failures.push({ sheet: e.sheet, cell: e.cell, what: e.what, expected: String(e.expected), actual: `<eval error: ${(err as Error).message}>` });
      continue;
    }
    const ok =
      e.expected instanceof Decimal
        ? actual instanceof Decimal && actual.equals(e.expected) // 零容差
        : actual === e.expected;
    if (!ok) {
      failures.push({
        sheet: e.sheet,
        cell: e.cell,
        what: e.what,
        expected: e.expected instanceof Decimal ? e.expected.toFixed() : e.expected,
        actual: show(actual),
      });
    }
  }

  // —— 额外守卫：任何被写入的公式格都必须可求值（未被 expectations 覆盖的也要算一遍）——
  for (const [sheetName, sheet] of view) {
    for (const cell of sheet.formulas.keys()) {
      try {
        evaluateCell(view, sheetName, cell);
      } catch (err) {
        failures.push({ sheet: sheetName, cell, what: 'formula must be evaluable', expected: '<evaluable>', actual: `<eval error: ${(err as Error).message}>` });
      }
    }
  }

  // —— 4. _ledger round-trip ——
  let ledgerRoundTrip: SelfCheckReport['ledgerRoundTrip'] = 'ok';
  try {
    const ls = view.get('_ledger');
    const chunks: string[] = [];
    if (ls) {
      for (let r = 1; r <= ls.maxRow; r++) {
        const v = ls.literals.get(`A${r}`);
        if (typeof v === 'string') chunks.push(v);
      }
    }
    const decoded = decodeLedger(chunks);
    if (JSON.stringify(decoded) !== JSON.stringify(originalLedger)) ledgerRoundTrip = 'mismatch';
  } catch {
    ledgerRoundTrip = 'error';
  }

  return {
    ok: failures.length === 0 && ledgerRoundTrip === 'ok',
    cellsChecked: expectations.length,
    formulaCells,
    failures,
    ledgerRoundTrip,
  };
}

/** 自检不通过 → 抛 InvariantViolation（不交付）。detail 不含金额（R7）。 */
export function assertSelfCheckPassed(report: SelfCheckReport): void {
  if (report.ok) return;
  const where = report.failures.slice(0, 5).map((f) => `${f.sheet}!${f.cell}(${f.what})`).join('; ');
  throw new InvariantViolation({
    invariant: 'xlsx-selfcheck',
    detail: `post-generation self-check failed: ${report.failures.length} cell(s) [${where}], ledgerRoundTrip=${report.ledgerRoundTrip}`,
  });
}
