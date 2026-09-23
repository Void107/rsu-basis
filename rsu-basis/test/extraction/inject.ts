// 注入测试基建（docs/06 §8）。对每个 golden case 程序化注入【单字段】扰动，
// 跑 C1–C7，断言至少一条捕获并阻断。捕获率必须 100%（静默错误率 = 0）。
//
// 关键：C1/C4/C5 的锚点（印刷合计、标注行数、W-2 合计）取自【原始】数据——
// 它们在现实里来自独立来源（合计行、W-2），扰动只动某个逐行字段，锚点保持正确，
// 由此产生的不一致才是校验能抓到的东西。锚点若随扰动一起变，就什么都抓不到。
//
// 测试代码可同时依赖 engine 与 extraction（C6 需要引擎算 term）。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';
import { classifyHoldingPeriod } from '../../src/engine/index.js';
import { checkC2, checkC3, checkC4, checkC5, checkC6, type C6Pair } from '../../src/extraction/crosschecks.js';
import { runC1 } from '../../src/extraction/c1.js';
import { checkC9, type C9Field } from '../../src/extraction/c9.js';
import type { CheckResult } from '../../src/extraction/errors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, '..', 'golden');

export interface Lot {
  id: string;
  vestDate: string;
  sharesVested: Decimal;
  sharesWithheld: Decimal;
  sharesDelivered: Decimal;
  vestFmv: Decimal;
  ordinaryIncome: Decimal;
}
export interface Sale {
  id: string;
  saleDate: string;
  sharesSold: Decimal;
  proceeds: Decimal;
  reportedBasis: Decimal;
  reportedTerm: 'ST' | 'LT' | null;
  /** 文档原文（SourceRef.rawText）。扰动模拟【解析读错】：改 parsed 值，rawText 不变。 */
  raw: { saleDate: string; proceeds: string; reportedBasis: string };
}
export interface Model {
  caseName: string;
  lots: Lot[];
  sales: Sale[];
  matches: { saleId: string; lotId: string }[];
  w2: Decimal | null;
}

const D = (s: string) => new Decimal(s);

export function loadModel(caseName: string): Model {
  const ledger = JSON.parse(readFileSync(join(GOLDEN, caseName, 'expected', 'ledger.json'), 'utf8'));
  const matches = JSON.parse(readFileSync(join(GOLDEN, caseName, 'expected', 'matches.json'), 'utf8'));
  return {
    caseName,
    lots: ledger.vestLots.map((l: Record<string, string>) => ({
      id: l['id'],
      vestDate: l['vestDate'],
      sharesVested: D(l['sharesVested']!),
      sharesWithheld: D(l['sharesWithheld']!),
      sharesDelivered: D(l['sharesDelivered']!),
      vestFmv: D(l['vestFmv']!),
      ordinaryIncome: D(l['ordinaryIncome']!),
    })),
    sales: ledger.saleEvents.map((s: Record<string, string | null>) => ({
      id: s['id'],
      saleDate: s['saleDate'],
      sharesSold: D(s['sharesSold'] as string),
      proceeds: D(s['proceeds'] as string),
      reportedBasis: D((s['reportedBasis'] as string) ?? '0'),
      reportedTerm: (s['reportedTerm'] as 'ST' | 'LT' | null) ?? null,
      // 原文取自未扰动的 golden 值——它代表「文档上印的字」，扰动不改它。
      raw: {
        saleDate: s['saleDate'] as string,
        proceeds: s['proceeds'] as string,
        reportedBasis: (s['reportedBasis'] as string) ?? '0',
      },
    })),
    matches: matches.matches.map((m: Record<string, string>) => ({ saleId: m['saleId'], lotId: m['lotId'] })),
    w2: ledger.w2Anchor.rsuIncomeReported === null ? null : D(ledger.w2Anchor.rsuIncomeReported),
  };
}

export interface Anchors {
  printedTotal: Decimal; // C1：独立的印刷合计（原始 Σ oi）
  annotatedLotCount: number; // C4：文档标注的 lot 数（原始行数）
  w2Total: Decimal | null; // C5：W-2 RSU 合计（原始）
}

/** 锚点固定取自【原始】模型。 */
export function anchorsFrom(original: Model): Anchors {
  return {
    printedTotal: original.lots.reduce((a, l) => a.add(l.ordinaryIncome), new Decimal(0)),
    annotatedLotCount: original.lots.length,
    w2Total: original.w2,
  };
}

/** 对（可能被扰动的）模型跑 C1–C7，返回全部结果。 */
export function runChecks(m: Model, anchors: Anchors): CheckResult[] {
  const lotById = new Map(m.lots.map((l) => [l.id, l]));
  const saleById = new Map(m.sales.map((s) => [s.id, s]));
  const results: CheckResult[] = [];

  // C1：印刷合计能力设为 confirmed（合成 case 视为有合计锚点），锚点用原始 printedTotal。
  results.push(
    runC1({
      hasPrintedTotal: 'confirmed',
      perRowOrdinaryIncome: m.lots.map((l) => l.ordinaryIncome),
      printedTotal: anchors.printedTotal,
    }),
  );
  results.push(checkC2(m.lots.map((l, i) => ({ rowIndex: i, sharesVested: l.sharesVested, vestFmv: l.vestFmv, ordinaryIncome: l.ordinaryIncome }))));
  results.push(checkC3(m.lots.map((l, i) => ({ rowIndex: i, sharesVested: l.sharesVested, sharesWithheld: l.sharesWithheld, sharesDelivered: l.sharesDelivered }))));
  results.push(checkC4(m.lots.length, anchors.annotatedLotCount));
  const sumOi = m.lots.reduce((a, l) => a.add(l.ordinaryIncome), new Decimal(0));
  results.push(checkC5(sumOi, anchors.w2Total, m.lots.length));

  const pairs: C6Pair[] = [];
  m.matches.forEach((mt, i) => {
    const lot = lotById.get(mt.lotId);
    const sale = saleById.get(mt.saleId);
    if (!lot || !sale) return; // 被 drop 掉的行跳过（drop 由 C1/C4 抓）
    pairs.push({ rowIndex: i, computedTerm: classifyHoldingPeriod(lot.vestDate, sale.saleDate), brokerTerm: sale.reportedTerm });
  });
  results.push(checkC6(pairs));

  // C9 逐字符回比：1099-B 侧字段必须能由原文复现（挡解析层读错）。
  const c9: C9Field[] = [];
  m.sales.forEach((s, i) => {
    c9.push({ rowIndex: i, fieldName: 'saleDate', rawText: s.raw.saleDate, value: s.saleDate, kind: 'date', method: 'rule' });
    c9.push({ rowIndex: i, fieldName: 'proceeds', rawText: s.raw.proceeds, value: s.proceeds, kind: 'money', method: 'rule' });
    c9.push({ rowIndex: i, fieldName: 'reportedBasis', rawText: s.raw.reportedBasis, value: s.reportedBasis, kind: 'money', method: 'rule' });
  });
  results.push(checkC9(c9));

  return results;
}

/** 是否被阻断：存在 HARD 或 DECIDE 的 fail（WARN / skip 不算阻断）。 */
export function isBlocked(results: CheckResult[]): boolean {
  return results.some((r) => r.status === 'fail' && (r.level === 'HARD' || r.level === 'DECIDE'));
}
export function firedChecks(results: CheckResult[]): string[] {
  return results.filter((r) => r.status === 'fail' && (r.level === 'HARD' || r.level === 'DECIDE')).map((r) => r.check);
}

// —— 扰动 ——（每个只改一个字段）
export interface Perturbation {
  id: string; // 类别
  label: string; // 具体注入
  apply: (m: Model) => Model;
}

const cloneLots = (m: Model): Lot[] => m.lots.map((l) => ({ ...l }));
const cloneSales = (m: Model): Sale[] => m.sales.map((s) => ({ ...s }));
const bumpMoney = (d: Decimal) => d.add(1); // 改一位数字：$1（改 ones 位），且 > 容差
const bumpShares = (d: Decimal) => d.add(1);
const dayShift = (iso: string, days: number): string => {
  const [y, mo, dd] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, mo! - 1, dd!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};

export function perturbations(m: Model): Perturbation[] {
  const out: Perturbation[] = [];
  const lotMoneyFields: (keyof Lot)[] = ['vestFmv', 'ordinaryIncome'];
  const lotShareFields: (keyof Lot)[] = ['sharesVested', 'sharesWithheld', 'sharesDelivered'];

  // 1) 改一位数字：lot 的每个数值字段（改 lot 0）
  for (const f of lotMoneyFields) {
    out.push({
      id: 'flip-digit',
      label: `flip-digit lot0.${String(f)}`,
      apply: (x) => { const lots = cloneLots(x); lots[0] = { ...lots[0]!, [f]: bumpMoney(lots[0]![f] as Decimal) }; return { ...x, lots }; },
    });
  }
  for (const f of lotShareFields) {
    out.push({
      id: 'flip-digit',
      label: `flip-digit lot0.${String(f)}`,
      apply: (x) => { const lots = cloneLots(x); lots[0] = { ...lots[0]!, [f]: bumpShares(lots[0]![f] as Decimal) }; return { ...x, lots }; },
    });
  }
  // 1b) 改一位数字：1099-B 侧字段（proceeds / reportedBasis）
  out.push({ id: 'flip-digit', label: 'flip-digit sale0.proceeds', apply: (x) => { const sales = cloneSales(x); sales[0] = { ...sales[0]!, proceeds: bumpMoney(sales[0]!.proceeds) }; return { ...x, sales }; } });
  out.push({ id: 'flip-digit', label: 'flip-digit sale0.reportedBasis', apply: (x) => { const sales = cloneSales(x); sales[0] = { ...sales[0]!, reportedBasis: bumpMoney(sales[0]!.reportedBasis) }; return { ...x, sales }; } });

  // 2) 相邻两行串行（补充表侧）：交换 lot0/lot1 的 ordinaryIncome
  //    —— 和保持不变，专打 C1（合计）抓不到的情形，靠 C2 兜。
  //    仅当两值不同才是真扰动（相同则是 no-op，不计入捕获率统计）。
  if (m.lots.length >= 2 && !m.lots[0]!.ordinaryIncome.equals(m.lots[1]!.ordinaryIncome)) {
    out.push({
      id: 'adjacent-row-serial',
      label: 'swap ordinaryIncome lot0<->lot1',
      apply: (x) => { const lots = cloneLots(x); const a = lots[0]!.ordinaryIncome; lots[0] = { ...lots[0]!, ordinaryIncome: lots[1]!.ordinaryIncome }; lots[1] = { ...lots[1]!, ordinaryIncome: a }; return { ...x, lots }; },
    });
  }
  // 2b) 相邻两行串行（1099-B 侧）：交换 sale0/sale1 的 proceeds。
  //     单 lot 的 case 无法做补充表侧串行，这条补上该类别的覆盖。
  if (m.sales.length >= 2 && !m.sales[0]!.proceeds.equals(m.sales[1]!.proceeds)) {
    out.push({
      id: 'adjacent-row-serial',
      label: 'swap proceeds sale0<->sale1',
      apply: (x) => { const sales = cloneSales(x); const a = sales[0]!.proceeds; sales[0] = { ...sales[0]!, proceeds: sales[1]!.proceeds }; sales[1] = { ...sales[1]!, proceeds: a }; return { ...x, sales }; },
    });
  }

  // 3) 漏掉一行：删除 lot0
  out.push({ id: 'drop-row', label: 'drop lot0', apply: (x) => ({ ...x, lots: x.lots.slice(1) }) });

  // 4) 每股与总额口径互换：vestFmv 取成总额（= ordinaryIncome）
  out.push({ id: 'per-share-vs-total', label: 'lot0.vestFmv := total(ordinaryIncome)', apply: (x) => { const lots = cloneLots(x); lots[0] = { ...lots[0]!, vestFmv: lots[0]!.ordinaryIncome }; return { ...x, lots }; } });

  // 5) 日期错一天：远离一年边界（sale0）与紧邻边界（若存在）各一
  out.push({ id: 'date-off-by-one', label: 'sale0.saleDate +1d', apply: (x) => { const sales = cloneSales(x); sales[0] = { ...sales[0]!, saleDate: dayShift(sales[0]!.saleDate, 1) }; return { ...x, sales }; } });
  // 找一个「恰好一年」的边界卖出（reportedTerm=ST 且 saleDate == vestDate+1y）来测边界
  const boundary = m.matches.find((mt) => {
    const lot = m.lots.find((l) => l.id === mt.lotId);
    const sale = m.sales.find((s) => s.id === mt.saleId);
    if (!lot || !sale) return false;
    return classifyHoldingPeriod(lot.vestDate, dayShift(sale.saleDate, 1)) !== classifyHoldingPeriod(lot.vestDate, sale.saleDate);
  });
  if (boundary) {
    out.push({ id: 'date-off-by-one', label: `boundary sale ${boundary.saleId} +1d`, apply: (x) => { const sales = cloneSales(x); const idx = sales.findIndex((s) => s.id === boundary.saleId); sales[idx] = { ...sales[idx]!, saleDate: dayShift(sales[idx]!.saleDate, 1) }; return { ...x, sales }; } });
  }

  // 6) 股数与金额错位：交换 lot0 的 sharesVested 与 ordinaryIncome（列错位）
  out.push({ id: 'shares-amount-misalign', label: 'swap sharesVested<->ordinaryIncome lot0', apply: (x) => { const lots = cloneLots(x); const v = lots[0]!.sharesVested; lots[0] = { ...lots[0]!, sharesVested: lots[0]!.ordinaryIncome, ordinaryIncome: v }; return { ...x, lots }; } });

  return out;
}
