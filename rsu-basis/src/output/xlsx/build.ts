// 工作簿构建（docs/04 §2/§3）。
//
// 原则（§1）：每个计算格都是【活公式】，不是烘死的值——CPA 点开任意一格能看到它从哪来。
// 因此引擎要输出两份东西：数值（用于 §7 自检）与公式字符串（用于写入）。
// 本模块同时产出 expectations[]，供 selfcheck 逐格零容差比对。
//
// 所有公式都过 formula() 守卫（§5 允许集）。
import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import type { EngineOutput, Ledger } from '../../engine/index.js';
import { formula } from './formulaGuard.js';
import { dateToSerial } from './evaluate.js';
import { encodeLedger } from './ledgerBlob.js';

export interface CheckRow {
  id: string;
  description: string;
  expected: string;
  actual: string;
  delta: string;
  status: 'pass' | 'warn' | 'fail';
}

/** 一条自检期望：某 sheet 某格的公式，其求值结果必须等于 expected。 */
export interface CellExpectation {
  sheet: string;
  cell: string;
  expected: Decimal | string;
  what: string; // 诊断用描述（不含金额）
}

export interface BuildResult {
  workbook: ExcelJS.Workbook;
  expectations: CellExpectation[];
  ledgerChunks: string[];
  fileName: string;
}

const MONEY_FMT = '#,##0.00;(#,##0.00)'; // §3：负数用括号，会计惯例
const SHARES_FMT = '#,##0.0000';
const DATE_FMT = 'yyyy-mm-dd';
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };

const DISCLAIMER = '本表为工作底稿，不是税务申报表，不构成税务建议。请在提交申报前与持照税务专业人士复核。';

const utcDate = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
// 写入数值时【不得截断】：截到固定小数位会让分数股的乘积（如 12.3456 × 50.01）
// 与引擎的精确值对不上，自检会因此误报，或更糟——把截断后的错值写进交付物。
// 走 Decimal → 十进制字符串 → Number，读回时再由字符串构造回 Decimal，全程十进制无损。
const num = (d: Decimal): number => Number(d.toString());

function header(ws: ExcelJS.Worksheet, row: number, labels: string[]): void {
  const r = ws.getRow(row);
  labels.forEach((l, i) => {
    const c = r.getCell(i + 1);
    c.value = l;
    c.font = { bold: true };
    c.fill = HEADER_FILL;
  });
  r.commit();
}

function autoWidth(ws: ExcelJS.Worksheet): void {
  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value instanceof Object && 'formula' in cell.value ? cell.value.formula : cell.value ?? '').length;
      if (len + 2 > max) max = len + 2;
    });
    col.width = Math.min(40, Math.max(10, max));
  });
}

export function buildWorkbook(args: {
  ledger: Ledger;
  engine: EngineOutput;
  checks: CheckRow[];
}): BuildResult {
  const { ledger, engine, checks } = args;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RSU Cost Basis Reconciler';
  const exp: CellExpectation[] = [];

  // —— 3. Lots ——（全字面值）
  const wsLots = wb.addWorksheet('Lots');
  header(wsLots, 1, ['lot_id', 'grant_id', 'vest_date', 'shares_vested', 'shares_withheld', 'shares_delivered', 'vest_fmv', 'ordinary_income']);
  const lotRow = new Map<string, number>();
  ledger.vestLots.forEach((l, i) => {
    const r = i + 2;
    lotRow.set(l.id, r);
    wsLots.getCell(`A${r}`).value = l.id;
    wsLots.getCell(`B${r}`).value = l.grantId ?? '';
    wsLots.getCell(`C${r}`).value = utcDate(l.vestDate);
    wsLots.getCell(`C${r}`).numFmt = DATE_FMT;
    wsLots.getCell(`D${r}`).value = num(l.sharesVested);
    wsLots.getCell(`E${r}`).value = l.sharesWithheld === null ? '' : num(l.sharesWithheld);
    wsLots.getCell(`F${r}`).value = num(l.sharesDelivered);
    wsLots.getCell(`G${r}`).value = num(l.vestFmv);
    wsLots.getCell(`H${r}`).value = num(l.ordinaryIncome);
    for (const c of ['D', 'E', 'F']) wsLots.getCell(`${c}${r}`).numFmt = SHARES_FMT;
    for (const c of ['G', 'H']) wsLots.getCell(`${c}${r}`).numFmt = MONEY_FMT;
  });

  // —— 4. Sales ——（1099-B 原样）
  const wsSales = wb.addWorksheet('Sales');
  header(wsSales, 1, ['sale_id', 'sale_date', 'shares_sold', 'proceeds', 'reported_basis', 'basis_reported_to_irs', 'sale_kind', 'reported_term']);
  const saleRow = new Map<string, number>();
  ledger.saleEvents.forEach((s, i) => {
    const r = i + 2;
    saleRow.set(s.id, r);
    wsSales.getCell(`A${r}`).value = s.id;
    wsSales.getCell(`B${r}`).value = utcDate(s.saleDate);
    wsSales.getCell(`B${r}`).numFmt = DATE_FMT;
    wsSales.getCell(`C${r}`).value = num(s.sharesSold);
    wsSales.getCell(`C${r}`).numFmt = SHARES_FMT;
    wsSales.getCell(`D${r}`).value = num(s.proceeds);
    wsSales.getCell(`D${r}`).numFmt = MONEY_FMT;
    wsSales.getCell(`E${r}`).value = s.reportedBasis === null ? '' : num(s.reportedBasis);
    wsSales.getCell(`E${r}`).numFmt = MONEY_FMT;
    wsSales.getCell(`F${r}`).value = s.basisReportedToIRS ? 'YES' : 'NO';
    wsSales.getCell(`G${r}`).value = s.saleKind;
    wsSales.getCell(`H${r}`).value = s.reportedTerm ?? '';
  });

  // —— 5. Matching ——（推导链；H=adjustment、I=term 与 §2.1 的 Summary 公式对齐）
  const wsM = wb.addWorksheet('Matching');
  header(wsM, 1, [
    'sale_id', 'lot_id', 'shares_matched', 'vest_fmv', 'vest_date',
    'adjusted_basis', 'reported_basis_portion', 'adjustment', 'term', 'sale_date', 'proceeds_portion',
  ]);
  const matchRow: number[] = [];
  engine.matches.forEach((m, i) => {
    const r = i + 2;
    matchRow.push(r);
    const lr = lotRow.get(m.lotId)!;
    const sr = saleRow.get(m.saleId)!;
    wsM.getCell(`A${r}`).value = m.saleId;
    wsM.getCell(`B${r}`).value = m.lotId;
    wsM.getCell(`C${r}`).value = num(m.sharesMatched);
    wsM.getCell(`C${r}`).numFmt = SHARES_FMT;
    // 引用 Lots / Sales —— 行号偏移一行就会在自检里暴露
    wsM.getCell(`D${r}`).value = { formula: formula(`Lots!G${lr}`) };
    wsM.getCell(`D${r}`).numFmt = MONEY_FMT;
    wsM.getCell(`E${r}`).value = { formula: formula(`Lots!C${lr}`) };
    wsM.getCell(`E${r}`).numFmt = DATE_FMT;
    // docs/02 §2.4 / INDEX D13 加法式：adjustedBasis = 股数×FMV + 已报基础
    // （docs/04 §2.3 的 =C*D 是加法式确立前的写法，此处按 D13 修正）
    wsM.getCell(`F${r}`).value = { formula: formula(`C${r}*D${r}+G${r}`) };
    wsM.getCell(`F${r}`).numFmt = MONEY_FMT;
    wsM.getCell(`G${r}`).value = num(m.reportedBasisPortion);
    wsM.getCell(`G${r}`).numFmt = MONEY_FMT;
    wsM.getCell(`H${r}`).value = { formula: formula(`-(F${r}-G${r})`) };
    wsM.getCell(`H${r}`).numFmt = MONEY_FMT;
    // 「超过一年」而非「满一年」：用 > 不是 >=
    wsM.getCell(`I${r}`).value = { formula: formula(`IF(J${r}>EDATE(E${r},12),"LT","ST")`) };
    wsM.getCell(`J${r}`).value = { formula: formula(`Sales!B${sr}`) };
    wsM.getCell(`J${r}`).numFmt = DATE_FMT;
    wsM.getCell(`K${r}`).value = num(m.proceedsPortion); // 按股数分摊，余数归最后一条（非简单公式）
    wsM.getCell(`K${r}`).numFmt = MONEY_FMT;

    const lot = ledger.vestLots.find((l) => l.id === m.lotId)!;
    const sale = ledger.saleEvents.find((s) => s.id === m.saleId)!;
    exp.push({ sheet: 'Matching', cell: `D${r}`, expected: lot.vestFmv, what: `match ${i} vest_fmv ref` });
    exp.push({ sheet: 'Matching', cell: `E${r}`, expected: dateToSerial(utcDate(lot.vestDate)), what: `match ${i} vest_date ref` });
    exp.push({ sheet: 'Matching', cell: `F${r}`, expected: m.adjustedBasis, what: `match ${i} adjusted_basis` });
    exp.push({ sheet: 'Matching', cell: `H${r}`, expected: m.reportedBasisPortion.sub(m.adjustedBasis), what: `match ${i} adjustment` });
    exp.push({ sheet: 'Matching', cell: `I${r}`, expected: m.term, what: `match ${i} term` });
    exp.push({ sheet: 'Matching', cell: `J${r}`, expected: dateToSerial(utcDate(sale.saleDate)), what: `match ${i} sale_date ref` });
  });

  // —— 2. 8949 ——（两种形态；逐行输出，不提供汇总选项）
  const ws49 = wb.addWorksheet('8949');
  ws49.getCell('A1').value = DISCLAIMER;
  ws49.getCell('A1').font = { bold: true };
  header(ws49, 2, [
    '(a) Description', '(b) Date acquired', '(c) Date sold', '(d) Proceeds',
    '(e) Cost or other basis', '(f) Code', '(g) Adjustment', '(h) Gain or loss', 'Box', 'Term',
  ]);

  // 按 box 分组（组内保持原顺序，逐笔列示）
  const boxes = [...new Set(engine.form8949.rows.map((r) => r.box))].sort();
  let r49 = 3;
  for (const box of boxes) {
    const idxs = engine.form8949.rows.map((row, i) => ({ row, i })).filter((x) => x.row.box === box);
    const first = r49;
    for (const { row, i } of idxs) {
      const mr = matchRow[i]!;
      ws49.getCell(`A${r49}`).value = row.description;
      ws49.getCell(`B${r49}`).value = { formula: formula(`Matching!E${mr}`) };
      ws49.getCell(`B${r49}`).numFmt = DATE_FMT;
      ws49.getCell(`C${r49}`).value = { formula: formula(`Matching!J${mr}`) };
      ws49.getCell(`C${r49}`).numFmt = DATE_FMT;
      ws49.getCell(`D${r49}`).value = { formula: formula(`Matching!K${mr}`) };
      ws49.getCell(`D${r49}`).numFmt = MONEY_FMT;

      if (row.adjustmentCode) {
        // 形态一（基础已报送 IRS）：(e) 照抄 1099-B，(f)=B，(g) 表达修正
        ws49.getCell(`E${r49}`).value = { formula: formula(`Matching!G${mr}`) };
        ws49.getCell(`F${r49}`).value = 'B';
        ws49.getCell(`G${r49}`).value = { formula: formula(`-(Matching!F${mr}-E${r49})`) };
        ws49.getCell(`H${r49}`).value = { formula: formula(`D${r49}-E${r49}+G${r49}`) };
        exp.push({ sheet: '8949', cell: `E${r49}`, expected: row.costBasisReported, what: `8949 row ${i} (e)` });
        exp.push({ sheet: '8949', cell: `G${r49}`, expected: row.adjustmentAmount!, what: `8949 row ${i} (g)` });
      } else {
        // 形态二（基础未报送 IRS）：正确基础直接进 (e)，(f)/(g) 留空
        ws49.getCell(`E${r49}`).value = { formula: formula(`Matching!F${mr}`) };
        ws49.getCell(`H${r49}`).value = { formula: formula(`D${r49}-E${r49}`) };
        exp.push({ sheet: '8949', cell: `E${r49}`, expected: row.costBasisReported, what: `8949 row ${i} (e) direct` });
      }
      ws49.getCell(`E${r49}`).numFmt = MONEY_FMT;
      ws49.getCell(`G${r49}`).numFmt = MONEY_FMT;
      ws49.getCell(`H${r49}`).numFmt = MONEY_FMT;
      ws49.getCell(`I${r49}`).value = row.box;
      ws49.getCell(`J${r49}`).value = row.term;
      // (b)/(c) 也必须逐格比对——它们是报到 8949 上的取得日/卖出日，
      // 只验「公式可求值」挡不住行号偏移（会算出另一行的日期）。
      exp.push({ sheet: '8949', cell: `B${r49}`, expected: dateToSerial(utcDate(row.dateAcquired)), what: `8949 row ${i} (b)` });
      exp.push({ sheet: '8949', cell: `C${r49}`, expected: dateToSerial(utcDate(row.dateSold)), what: `8949 row ${i} (c)` });
      exp.push({ sheet: '8949', cell: `D${r49}`, expected: row.proceeds, what: `8949 row ${i} (d)` });
      exp.push({ sheet: '8949', cell: `H${r49}`, expected: row.gainLoss, what: `8949 row ${i} (h)` });
      r49++;
    }
    // 每组一个小计行（§2.2）。这是展示用小计，不改变「逐笔列示」。
    const last = r49 - 1;
    ws49.getCell(`A${r49}`).value = `Box ${box} subtotal`;
    ws49.getCell(`A${r49}`).font = { bold: true };
    for (const col of ['D', 'E', 'G', 'H'] as const) {
      ws49.getCell(`${col}${r49}`).value = { formula: formula(`SUM(${col}${first}:${col}${last})`) };
      ws49.getCell(`${col}${r49}`).numFmt = MONEY_FMT;
      ws49.getCell(`${col}${r49}`).font = { bold: true };
    }
    const grp = idxs.map((x) => x.row);
    const sumOf = (f: (x: (typeof grp)[number]) => Decimal) => grp.reduce((a, x) => a.add(f(x)), new Decimal(0));
    exp.push({ sheet: '8949', cell: `D${r49}`, expected: sumOf((x) => x.proceeds), what: `8949 box ${box} subtotal (d)` });
    exp.push({ sheet: '8949', cell: `E${r49}`, expected: sumOf((x) => x.costBasisReported), what: `8949 box ${box} subtotal (e)` });
    exp.push({ sheet: '8949', cell: `G${r49}`, expected: sumOf((x) => x.adjustmentAmount ?? new Decimal(0)), what: `8949 box ${box} subtotal (g)` });
    exp.push({ sheet: '8949', cell: `H${r49}`, expected: sumOf((x) => x.gainLoss), what: `8949 box ${box} subtotal (h)` });
    r49 += 2;
  }

  // —— 1. Summary ——
  const wsS = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsS.getCell('A1').value = DISCLAIMER;
  wsS.getCell('A1').font = { bold: true, size: 12 };
  const rec = engine.reconcile;
  const srow = (row: number, label: string, f: string, expected: Decimal | string, what: string, fmt = MONEY_FMT) => {
    wsS.getCell(`A${row}`).value = label;
    wsS.getCell(`B${row}`).value = { formula: formula(f) };
    wsS.getCell(`B${row}`).numFmt = fmt;
    exp.push({ sheet: 'Summary', cell: `B${row}`, expected, what });
  };
  srow(2, '调整总额', 'SUM(Matching!H:H)', rec.totalAdjustment, 'summary total adjustment');
  srow(3, '短期调整', 'SUMIF(Matching!I:I,"ST",Matching!H:H)', sumAdjByTerm(engine, 'ST'), 'summary ST adjustment');
  srow(4, '长期调整', 'SUMIF(Matching!I:I,"LT",Matching!H:H)', sumAdjByTerm(engine, 'LT'), 'summary LT adjustment');
  srow(5, '调整后成本基础合计', 'SUM(Matching!F:F)', rec.totalAdjustedBasis, 'summary total adjusted basis');
  srow(6, 'Proceeds 合计', 'SUM(Matching!K:K)', rec.totalProceeds, 'summary total proceeds');

  wsS.getCell('A8').value = '边际税率（请填写，例如 0.32）';
  wsS.getCell('B8').value = null; // 用户填，默认空——不替用户猜税率
  wsS.getCell('B8').numFmt = '0.00%';
  wsS.getCell('A9').value = '估算多缴（仅在填入税率后显示）';
  wsS.getCell('B9').value = { formula: formula('IF(B8="","请填入边际税率",-B2*B8)') };
  wsS.getCell('B9').numFmt = MONEY_FMT;
  // B8 为空 → B9 必须是提示文本，不显示任何数字
  exp.push({ sheet: 'Summary', cell: 'B9', expected: '请填入边际税率', what: 'summary estimate hidden when no rate' });

  // —— 6. Sources ——
  const wsSrc = wb.addWorksheet('Sources');
  header(wsSrc, 1, ['target_sheet', 'target_cell', 'file_name', 'page', 'row_index', 'column_label', 'raw_text', 'method', 'confidence']);
  let sr = 2;
  const pushSources = (targetSheet: string, cell: string, sources: Ledger['vestLots'][number]['sources']) => {
    for (const s of sources) {
      wsSrc.getCell(`A${sr}`).value = targetSheet;
      wsSrc.getCell(`B${sr}`).value = cell;
      wsSrc.getCell(`C${sr}`).value = s.fileName;
      wsSrc.getCell(`D${sr}`).value = s.page;
      wsSrc.getCell(`E${sr}`).value = s.rowIndex;
      wsSrc.getCell(`F${sr}`).value = s.columnLabel;
      wsSrc.getCell(`G${sr}`).value = s.rawText;
      wsSrc.getCell(`H${sr}`).value = s.method;
      wsSrc.getCell(`I${sr}`).value = s.confidence;
      // §2.4 条件格式：llm 标黄、confidence<0.95 标橙
      if (s.method === 'llm') wsSrc.getRow(sr).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3B0' } };
      else if (s.confidence < 0.95) wsSrc.getRow(sr).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD8A8' } };
      sr++;
    }
  };
  ledger.vestLots.forEach((l) => pushSources('Lots', `A${lotRow.get(l.id)}`, l.sources));
  ledger.saleEvents.forEach((s) => pushSources('Sales', `A${saleRow.get(s.id)}`, s.sources));

  // —— 7. Checks ——
  const wsC = wb.addWorksheet('Checks');
  header(wsC, 1, ['check_id', '描述', '期望', '实际', '差额', '状态']);
  checks.forEach((c, i) => {
    const r = i + 2;
    wsC.getCell(`A${r}`).value = c.id;
    wsC.getCell(`B${r}`).value = c.description;
    wsC.getCell(`C${r}`).value = c.expected;
    wsC.getCell(`D${r}`).value = c.actual;
    wsC.getCell(`E${r}`).value = c.delta;
    wsC.getCell(`F${r}`).value = c.status;
    const argb = c.status === 'pass' ? 'FFC6EFCE' : c.status === 'warn' ? 'FFFFEB9C' : 'FFFFC7CE';
    wsC.getCell(`F${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  });

  // —— 8. _ledger（隐藏）——
  const wsL = wb.addWorksheet('_ledger');
  wsL.state = 'veryHidden';
  const ledgerChunks = encodeLedger(serializeLedger(ledger));
  ledgerChunks.forEach((chunk, i) => {
    wsL.getCell(`A${i + 1}`).value = chunk;
  });

  for (const ws of [wsS, ws49, wsLots, wsSales, wsM, wsSrc, wsC]) {
    ws.views = [{ state: 'frozen', ySplit: ws === ws49 ? 2 : 1 }];
    autoWidth(ws);
  }

  return {
    workbook: wb,
    expectations: exp,
    ledgerChunks,
    fileName: `RSU-basis-${ledger.ticker}-${ledger.taxYear}.xlsx`,
  };
}

function sumAdjByTerm(engine: EngineOutput, term: 'ST' | 'LT'): Decimal {
  return engine.matches
    .filter((m) => m.term === term)
    .reduce((a, m) => a.add(m.reportedBasisPortion.sub(m.adjustedBasis)), new Decimal(0));
}

/** Ledger → 可 JSON 化（金额/股数存字符串，docs/01 §7）。ledger 里不含姓名与 SSN。 */
export function serializeLedger(l: Ledger): unknown {
  return {
    schemaVersion: l.schemaVersion,
    taxYear: l.taxYear,
    ticker: l.ticker,
    vestLots: l.vestLots.map((v) => ({
      id: v.id,
      grantId: v.grantId,
      vestDate: v.vestDate,
      sharesVested: v.sharesVested.toString(),
      sharesWithheld: v.sharesWithheld === null ? null : v.sharesWithheld.toString(),
      sharesDelivered: v.sharesDelivered.toString(),
      vestFmv: v.vestFmv.toString(),
      ordinaryIncome: v.ordinaryIncome.toString(),
      fmvConvention: v.fmvConvention,
      sources: v.sources,
    })),
    saleEvents: l.saleEvents.map((s) => ({
      id: s.id,
      saleDate: s.saleDate,
      sharesSold: s.sharesSold.toString(),
      proceeds: s.proceeds.toString(),
      proceedsBasis: s.proceedsBasis,
      reportedBasis: s.reportedBasis === null ? null : s.reportedBasis.toString(),
      reportedTerm: s.reportedTerm,
      covered: s.covered,
      basisReportedToIRS: s.basisReportedToIRS,
      saleKind: s.saleKind,
      sources: s.sources,
    })),
    w2Anchor: {
      taxYear: l.w2Anchor.taxYear,
      box1Total: l.w2Anchor.box1Total === null ? null : l.w2Anchor.box1Total.toString(),
      rsuIncomeReported: l.w2Anchor.rsuIncomeReported === null ? null : l.w2Anchor.rsuIncomeReported.toString(),
      rsuIncomeSource: l.w2Anchor.rsuIncomeSource,
      sources: l.w2Anchor.sources,
    },
  };
}
