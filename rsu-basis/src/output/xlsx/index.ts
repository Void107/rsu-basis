// xlsx 生成入口（docs/04）。
// 流程：构建 → 写出 buffer → §7 自检（读回 + 重算 + 零容差比对 + ledger round-trip）
//      → 不通过则【不交付】，抛 InvariantViolation。
import { InvariantViolation, type EngineOutput, type Ledger } from '../../engine/index.js';
import { buildWorkbook, serializeLedger, type CheckRow } from './build.js';
import { selfCheck, assertSelfCheckPassed, type SelfCheckReport } from './selfcheck.js';

export * from './formulaGuard.js';
export * from './ledgerBlob.js';
export { buildWorkbook, serializeLedger, type CheckRow, type CellExpectation } from './build.js';
export { selfCheck, assertSelfCheckPassed, toWorkbookView, type SelfCheckReport } from './selfcheck.js';
export { evaluate, evaluateCell, edate, dateToSerial } from './evaluate.js';

export interface GenerateResult {
  fileName: string;
  /** Uint8Array 而非 Buffer：同一份代码要能在浏览器单文件包里跑（P4）。 */
  buffer: Uint8Array;
  selfCheck: SelfCheckReport;
}

export async function generateXlsx(args: {
  ledger: Ledger;
  engine: EngineOutput;
  checks: CheckRow[];
}): Promise<GenerateResult> {
  // §2.5：任何一条校验 fail，整份 xlsx 不应被生成。
  const failed = args.checks.filter((c) => c.status === 'fail');
  if (failed.length > 0) {
    throw new InvariantViolation({
      invariant: 'xlsx-checks-failed',
      detail: `refusing to generate: failing checks [${failed.map((f) => f.id).join(',')}]`,
    });
  }

  const built = buildWorkbook(args);
  const written = await built.workbook.xlsx.writeBuffer();
  const buffer = new Uint8Array(written as unknown as ArrayBuffer);

  const report = await selfCheck(buffer, built.expectations, serializeLedger(args.ledger));
  assertSelfCheckPassed(report); // 不通过 → 不交付

  return { fileName: built.fileName, buffer, selfCheck: report };
}
