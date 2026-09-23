// xlsx 生成 + §7 自检。
// 最重要的两条：(1) 自检必须真的能抓住「公式引用行号偏移一行」；(2) §5 兼容性守卫。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { runRawLedger, decodeLedger, type EngineOutput, type Ledger } from '../../src/engine/index.js';
import {
  generateXlsx, buildWorkbook, serializeLedger, selfCheck, toWorkbookView,
  assertFormulaAllowed, FormulaCompatibilityError, encodeLedger, decodeLedger as decodeBlob,
  LedgerVersionError, evaluate, edate, dateToSerial, type CheckRow,
} from '../../src/output/xlsx/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, '..', 'golden');
const CASES = readdirSync(GOLDEN, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(GOLDEN, d.name, 'expected', 'ledger.json')))
  .map((d) => d.name).sort();

const PASSING_CHECKS: CheckRow[] = [
  { id: 'I1', description: 'Σ matched == Σ sold', expected: '0', actual: '0', delta: '0', status: 'pass' },
  { id: 'I6', description: 'basis 恒等式', expected: '0', actual: '0', delta: '0', status: 'pass' },
];

function load(caseName: string): { ledger: Ledger; engine: EngineOutput } {
  const raw = JSON.parse(readFileSync(join(GOLDEN, caseName, 'expected', 'ledger.json'), 'utf8'));
  const d = decodeLedger(raw);
  if (!d.ok) throw new Error('decode failed');
  const e = runRawLedger(raw);
  if (!e.ok) throw new Error(`engine failed: ${e.error.kind}`);
  return { ledger: d.value, engine: e.value };
}

describe('§5 兼容性守卫（只允许 SUM/SUMIF/IF/EDATE/ROUND + A1 引用）', () => {
  it('允许集通过', () => {
    for (const f of ['SUM(A1:A9)', 'SUMIF(Matching!I:I,"ST",Matching!H:H)', 'IF(B8="","x",-B2*B8)', 'IF(J2>EDATE(E2,12),"LT","ST")', 'ROUND(C2*D2,2)', '-(F2-G2)', 'Lots!G3']) {
      expect(() => assertFormulaAllowed(f), f).not.toThrow();
    }
  });
  it('动态数组函数被拒（Numbers 不支持）', () => {
    for (const f of ['FILTER(A:A,B:B>0)', 'XLOOKUP(A1,B:B,C:C)', 'LET(x,1,x+1)', 'TEXTJOIN(",",1,A:A)']) {
      expect(() => assertFormulaAllowed(f), f).toThrow(FormulaCompatibilityError);
    }
  });
  it('结构化引用与溢出运算符被拒', () => {
    expect(() => assertFormulaAllowed('SUM(Table1[Amount])')).toThrow(FormulaCompatibilityError);
    expect(() => assertFormulaAllowed('SUM(A1#)')).toThrow(FormulaCompatibilityError);
  });
  it('EDATE 之外的日期函数被拒', () => {
    expect(() => assertFormulaAllowed('DATE(2024,1,1)')).toThrow(FormulaCompatibilityError);
    expect(() => assertFormulaAllowed('YEAR(A1)')).toThrow(FormulaCompatibilityError);
  });
  it('字符串字面量里的函数名不误判', () => {
    expect(() => assertFormulaAllowed('IF(A1="FILTER(x)","y","z")')).not.toThrow();
  });
});

describe('EDATE 语义（持有期边界）', () => {
  const ser = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return dateToSerial(new Date(Date.UTC(y!, m! - 1, d!))); };
  it('EDATE(2024-03-15,12) = 2025-03-15；恰好一年不算长期（用 >）', () => {
    expect(edate(ser('2024-03-15'), 12).equals(ser('2025-03-15'))).toBe(true);
  });
  it('闰日 clamp：EDATE(2024-02-29,12) = 2025-02-28', () => {
    expect(edate(ser('2024-02-29'), 12).equals(ser('2025-02-28'))).toBe(true);
  });
});

describe('_ledger round-trip（§6）', () => {
  it('encode → decode 深度一致', () => {
    const { ledger } = load(CASES[0]!);
    const obj = serializeLedger(ledger);
    expect(decodeBlob(encodeLedger(obj))).toEqual(obj);
  });
  it('分片：超长内容切到 32767 以内', () => {
    const big = { schemaVersion: 1, blob: 'x'.repeat(400000) };
    const chunks = encodeLedger(big);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(32767);
    expect(decodeBlob(chunks)).toEqual(big);
  });
  it('schemaVersion 不兼容 → 明确报错，不静默降级', () => {
    expect(() => decodeBlob(encodeLedger({ schemaVersion: 99 }))).toThrow(LedgerVersionError);
  });
});

describe.each(CASES)('生成 + 自检：%s', (caseName) => {
  it('生成成功且自检通过（零容差）', async () => {
    const { ledger, engine } = load(caseName);
    const out = await generateXlsx({ ledger, engine, checks: PASSING_CHECKS });
    expect(out.selfCheck.ok, JSON.stringify(out.selfCheck.failures, null, 2)).toBe(true);
    expect(out.selfCheck.ledgerRoundTrip).toBe('ok');
    expect(out.selfCheck.cellsChecked).toBeGreaterThan(0);
    expect(out.selfCheck.formulaCells).toBeGreaterThan(0);
    expect(out.fileName).toBe(`RSU-basis-${ledger.ticker}-${ledger.taxYear}.xlsx`);
  });

  it('每一个公式格都被 expectation 覆盖（不留「只验可求值」的盲区）', async () => {
    const { ledger, engine } = load(caseName);
    const built = buildWorkbook({ ledger, engine, checks: PASSING_CHECKS });
    const covered = new Set(built.expectations.map((e) => `${e.sheet}!${e.cell}`));
    const uncovered: string[] = [];
    built.workbook.eachSheet((ws) => {
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const v = cell.value as unknown;
          if (v && typeof v === 'object' && 'formula' in (v as object)) {
            const key = `${ws.name}!${cell.address.replace(/\$/g, '')}`;
            if (!covered.has(key)) uncovered.push(key);
          }
        });
      });
    });
    expect(uncovered, `未被零容差比对覆盖的公式格:\n${uncovered.join('\n')}`).toEqual([]);
  });

  it('8949 逐行输出：明细行数 == 引擎行数（小计行不替代逐笔列示）', async () => {
    const { ledger, engine } = load(caseName);
    const out = await generateXlsx({ ledger, engine, checks: PASSING_CHECKS });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('8949')!;
    let detail = 0;
    ws.eachRow((row) => {
      const a = row.getCell('A').value;
      if (typeof a === 'string' && /^\d/.test(a)) detail++; // "40 sh ACME"
    });
    expect(detail).toBe(engine.form8949.rows.length);
  });

  it('两种输出形态：Box A/D 有代码 B 与 (g)；Box B/E 无代码、(e) 为正确基础', async () => {
    const { ledger, engine } = load(caseName);
    const out = await generateXlsx({ ledger, engine, checks: PASSING_CHECKS });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
    const view = toWorkbookView(wb);
    const ws = wb.getWorksheet('8949')!;
    ws.eachRow((row, n) => {
      const box = row.getCell('I').value;
      if (box !== 'A' && box !== 'D' && box !== 'B' && box !== 'E') return;
      const code = row.getCell('F').value;
      const g = view.get('8949')!.formulas.get(`G${n}`);
      if (box === 'A' || box === 'D') {
        expect(code, `row ${n}`).toBe('B');
        expect(g, `row ${n} must have (g)`).toBeDefined();
      } else {
        expect(code ?? null, `row ${n} must have no code`).toBeNull();
        expect(g, `row ${n} must have no (g)`).toBeUndefined();
      }
    });
  });

  it('Summary：未填税率 → 不显示估算金额', async () => {
    const { ledger, engine } = load(caseName);
    const out = await generateXlsx({ ledger, engine, checks: PASSING_CHECKS });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
    const view = toWorkbookView(wb);
    expect(view.get('Summary')!.literals.get('B8') ?? null).toBeNull(); // 税率格为空
    expect(evaluate(view.get('Summary')!.formulas.get('B9')!, view, 'Summary')).toBe('请填入边际税率');
  });

  it('填入税率后估算金额 = -调整总额 × 税率', async () => {
    const { ledger, engine } = load(caseName);
    const built = buildWorkbook({ ledger, engine, checks: PASSING_CHECKS });
    built.workbook.getWorksheet('Summary')!.getCell('B8').value = 0.413;
    const buf = await built.workbook.xlsx.writeBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as ArrayBuffer);
    const view = toWorkbookView(wb);
    const got = evaluate(view.get('Summary')!.formulas.get('B9')!, view, 'Summary') as Decimal;
    const want = engine.reconcile.totalAdjustment.negated().mul(new Decimal('0.413'));
    expect(got.toFixed(6)).toBe(want.toFixed(6));
  });
});

describe('分数股精度（写入不得截断）', () => {
  it('12.3456 股 × $50.01 的乘积在文件里精确保留，自检通过', async () => {
    const SRC = { fileHash: 's', fileName: 's', page: 1, rowIndex: 1, columnLabel: null, method: 'manual' as const, confidence: 1, rawText: 's' };
    const shares = '12.3456';
    const fmv = '50.01';
    const oi = new Decimal(shares).mul(fmv).toString(); // 12.3456 × 50.01 = 617.403456（6 位小数）
    const raw = {
      schemaVersion: 1, taxYear: 2024, ticker: 'FRAC',
      vestLots: [{
        id: 'F1', grantId: 'G1', vestDate: '2024-01-15',
        sharesVested: shares, sharesWithheld: '0', sharesDelivered: shares,
        vestFmv: fmv, ordinaryIncome: oi, fmvConvention: 'close', sources: [SRC],
      }],
      saleEvents: [{
        id: 'S1', saleDate: '2024-09-01', sharesSold: shares, proceeds: '700.00',
        proceedsBasis: 'gross', reportedBasis: '0.00', reportedTerm: 'ST', covered: true,
        basisReportedToIRS: true, saleKind: 'open_market', sources: [],
      }],
      w2Anchor: { taxYear: 2024, box1Total: null, rsuIncomeReported: null, rsuIncomeSource: null, sources: [] },
    };
    const d = decodeLedger(raw);
    const e = runRawLedger(raw);
    expect(d.ok && e.ok).toBe(true);
    if (!d.ok || !e.ok) return;
    expect(e.value.matches[0]!.adjustedBasis.toString()).toBe('617.403456');
    const out = await generateXlsx({ ledger: d.value, engine: e.value, checks: PASSING_CHECKS });
    expect(out.selfCheck.ok, JSON.stringify(out.selfCheck.failures, null, 2)).toBe(true);
  });
});

// ——★ 这一组是 §7 存在的全部理由：注入「行号偏移一行」，自检必须抓住 ★——
describe('§7 自检必须抓住公式行号偏移（否则表看起来正常但数字全错）', () => {
  const caseName = 'synthetic-001';

  async function corruptAndCheck(mutate: (wb: ExcelJS.Workbook) => void) {
    const { ledger, engine } = load(caseName);
    const built = buildWorkbook({ ledger, engine, checks: PASSING_CHECKS });
    mutate(built.workbook);
    const buf = await built.workbook.xlsx.writeBuffer();
    return selfCheck(buf as ArrayBuffer, built.expectations, serializeLedger(ledger));
  }

  it('Matching!D 引用 Lots 时行号 +1 → 自检 fail', async () => {
    const r = await corruptAndCheck((wb) => {
      const ws = wb.getWorksheet('Matching')!;
      const cur = (ws.getCell('D2').value as { formula: string }).formula; // Lots!G2
      const bumped = cur.replace(/(\d+)$/, (m) => String(Number(m) + 1));
      ws.getCell('D2').value = { formula: bumped };
    });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.sheet === 'Matching' && f.cell === 'D2')).toBe(true);
  });

  it('8949 (d) 引用 Matching 时行号 +1 → 自检 fail', async () => {
    const r = await corruptAndCheck((wb) => {
      const ws = wb.getWorksheet('8949')!;
      const cur = (ws.getCell('D3').value as { formula: string }).formula; // Matching!K2
      ws.getCell('D3').value = { formula: cur.replace(/(\d+)$/, (m) => String(Number(m) + 1)) };
    });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.sheet === '8949' && f.cell === 'D3')).toBe(true);
  });

  it('Matching 加法式被改成乘法式（丢掉 +G）→ 自检 fail（reportedBasis≠0 的 case）', async () => {
    const { ledger, engine } = load('synthetic-004');
    const built = buildWorkbook({ ledger, engine, checks: PASSING_CHECKS });
    const ws = built.workbook.getWorksheet('Matching')!;
    ws.getCell('F2').value = { formula: 'C2*D2' }; // 丢掉 +G2
    const buf = await built.workbook.xlsx.writeBuffer();
    const r = await selfCheck(buf as ArrayBuffer, built.expectations, serializeLedger(ledger));
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.cell === 'F2')).toBe(true);
  });

  it('term 公式用 >= 而非 >（满一年误判为长期）→ 自检 fail（边界 case）', async () => {
    const { ledger, engine } = load('synthetic-002');
    const built = buildWorkbook({ ledger, engine, checks: PASSING_CHECKS });
    const ws = built.workbook.getWorksheet('Matching')!;
    ws.getCell('I2').value = { formula: 'IF(J2>=EDATE(E2,12),"LT","ST")' };
    const buf = await built.workbook.xlsx.writeBuffer();
    const r = await selfCheck(buf as ArrayBuffer, built.expectations, serializeLedger(ledger));
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.cell === 'I2')).toBe(true);
  });

  it('_ledger 被篡改 → round-trip mismatch', async () => {
    const { ledger, engine } = load(caseName);
    const built = buildWorkbook({ ledger, engine, checks: PASSING_CHECKS });
    const other = load('synthetic-002');
    built.workbook.getWorksheet('_ledger')!.getCell('A1').value = encodeLedger(serializeLedger(other.ledger))[0]!;
    const buf = await built.workbook.xlsx.writeBuffer();
    const r = await selfCheck(buf as ArrayBuffer, built.expectations, serializeLedger(ledger));
    expect(r.ok).toBe(false);
    expect(r.ledgerRoundTrip).toBe('mismatch');
  });

  it('自检不通过 → generateXlsx 不交付（抛 InvariantViolation）', async () => {
    const { ledger, engine } = load(caseName);
    // 用一条 fail 的 check 触发「整份不生成」（§2.5）
    await expect(
      generateXlsx({ ledger, engine, checks: [{ id: 'C1', description: 'x', expected: '1', actual: '2', delta: '1', status: 'fail' }] }),
    ).rejects.toThrow(/InvariantViolation|refusing to generate/);
  });
});
