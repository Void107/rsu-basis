// CI 断言 ③（docs/06 §4.3）：对所有 golden case 生成自检报告，grep 数字模式，
// 除白名单字段外必须为空。同时反向验证泄漏能被抓住（否则断言是空转的）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';
import { decodeLedger, runRawLedger } from '../../src/engine/index.js';
import { checkC1, checkC5 } from '../../src/extraction/crosschecks.js';
import {
  buildSelfCheckReport, renderReportText, scanReportForNumbers, assertReportClean,
  sanitizeColumnHeaders, ReportLeakError, KNOWN_COLUMN_HEADERS, type SelfCheckReport,
} from '../../src/report/selfCheckReport.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, '..', 'golden');
const CASES = readdirSync(GOLDEN, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(GOLDEN, d.name, 'expected', 'ledger.json')))
  .map((d) => d.name).sort();

/** 用 golden case 造一份真实报告：带 deltaMagnitude 的 fail + 带 userMessage 的 skip。 */
function reportFor(caseName: string): { report: SelfCheckReport; raw: Record<string, unknown> } {
  const raw = JSON.parse(readFileSync(join(GOLDEN, caseName, 'expected', 'ledger.json'), 'utf8'));
  const d = decodeLedger(raw);
  const e = runRawLedger(raw);
  if (!d.ok || !e.ok) throw new Error('fixture load failed');
  const checks = [
    checkC1([new Decimal('5000.00')], new Decimal('11200.00')), // fail，带 deltaMagnitude + detail
    checkC5(new Decimal('27420.00'), null, d.value.vestLots.length), // skip，带 userMessage
  ];
  const report = buildSelfCheckReport({
    appVersion: '0.4.0',
    brokerDetected: 'fidelity',
    brokerConfidence: 0.9,
    taxYear: d.value.taxYear,
    docPageCount: 12,
    supplementalFound: true,
    supplementalStartPage: 6,
    lotCount: d.value.vestLots.length,
    saleCount: d.value.saleEvents.length,
    checks,
    invariants: e.value.matches.length > 0 ? [{ id: 'I6', status: 'pass' }] : [],
    columnHeadersSeen: ['Date Acquired', 'Ordinary Income Reported', '  quantity  ', 'Totally Unknown Column'],
    durationMs: 3400,
  });
  return { report, raw };
}

describe('自检报告 · 所有 golden case（CI 断言 ③）', () => {
  it.each(CASES)('%s：非白名单字段中无任何数字', (caseName) => {
    const { report } = reportFor(caseName);
    const offenders = scanReportForNumbers(report);
    expect(offenders, `泄漏字段:\n${offenders.join('\n')}`).toEqual([]);
    expect(() => assertReportClean(report)).not.toThrow();
  });

  it.each(CASES)('%s：报告全文不含 ticker / 文件名 / 哈希 / 金额 / 日期', (caseName) => {
    const { report, raw } = reportFor(caseName);
    const text = renderReportText(report);

    // ticker
    expect(text).not.toContain(String(raw['ticker']));
    // 文件名与哈希（fixture 里是 "synthetic"）
    expect(text.toLowerCase()).not.toContain('synthetic');

    // 金额/日期字符串都不得出现。
    // 只 grep【有区分度】的值：带小数点的金额与 ISO 日期。裸整数（如股数 "40"）会与
    // 白名单数字发生无意义的子串碰撞（"40" ⊂ durationMs 3400），对它们的保证由
    // scanReportForNumbers 的结构化扫描承担（非白名单字段一律不许出现任何数字）。
    const sensitive: string[] = [];
    for (const l of raw['vestLots'] as Record<string, string>[]) {
      sensitive.push(l['vestDate']!, l['vestFmv']!, l['ordinaryIncome']!);
    }
    for (const s of raw['saleEvents'] as Record<string, string>[]) {
      sensitive.push(s['saleDate']!, s['proceeds']!);
    }
    const distinctive = sensitive.filter((v) => v && (v.includes('.') || /^\d{4}-\d{2}-\d{2}$/.test(v)));
    expect(distinctive.length).toBeGreaterThan(0); // 确保这条断言不是空转
    for (const v of distinctive) {
      expect(text, `泄漏了 ${v}`).not.toContain(v);
    }
  });

  it.each(CASES)('%s：detail / userMessage 不进报告', (caseName) => {
    const { report } = reportFor(caseName);
    const text = renderReportText(report);
    expect(text).not.toContain('detail');
    expect(text).not.toContain('userMessage');
    expect(text).not.toContain('结构描述表'); // 用户文案不应出现在报告里
    // 但 deltaMagnitude 必须保留（判断「差了一行」还是「差了几分钱」的唯一依据）
    expect(report.checks.some((c) => c.deltaMagnitude === '1e3')).toBe(true);
  });

  it('报告顶部有声明，且字段集与 docs/06 §4.1 对齐', () => {
    const { report } = reportFor(CASES[0]!);
    expect(report.notice).toContain('不含任何金额');
    expect(Object.keys(report).sort()).toEqual([
      'appVersion', 'brokerConfidence', 'brokerDetected', 'checks', 'columnHeadersSeen',
      'docPageCount', 'durationMs', 'failurePath', 'invariants', 'lotCount', 'notice',
      'reportVersion', 'saleCount', 'supplementalFound', 'supplementalStartPage', 'taxYear',
    ]);
  });

  it('failurePath 记录首个失败路径（失败分布 = roadmap 优先级）', () => {
    const { report } = reportFor(CASES[0]!);
    expect(report.failurePath).toBe('F11');
  });
});

describe('列头白名单（§4.2 的唯一例外）', () => {
  it('未知列头被丢弃，已知列头输出规范写法', () => {
    const out = sanitizeColumnHeaders(['  date   acquired ', 'ORDINARY INCOME REPORTED', 'Employee SSN 123-45-6789']);
    expect(out).toEqual(['Date Acquired', 'Ordinary Income Reported']);
  });
  it('白名单里带数字的 1099-B 列头允许通过', () => {
    expect(sanitizeColumnHeaders(['1d Proceeds'])).toEqual(['1d Proceeds']);
    expect(KNOWN_COLUMN_HEADERS).toContain('12 Basis reported to IRS');
  });
});

describe('泄漏检测是非空转的（反向验证）', () => {
  const base = () => reportFor(CASES[0]!).report;

  it('往非白名单字段塞金额 → 被抓住', () => {
    const r = base() as unknown as Record<string, unknown>;
    r['brokerDetected'] = 'fidelity 27420.00';
    expect(scanReportForNumbers(r).length).toBeGreaterThan(0);
    expect(() => assertReportClean(r as unknown as SelfCheckReport)).toThrow(ReportLeakError);
  });

  it('新增未声明的数值字段 → 被抓住（防上游加字段静默泄漏）', () => {
    const r = base() as unknown as Record<string, unknown>;
    r['totalAdjustment'] = -22340;
    expect(scanReportForNumbers(r)).toContain('totalAdjustment (number)');
  });

  it('往 checks 里塞 detail → 被抓住', () => {
    const r = base();
    (r.checks[0] as unknown as Record<string, unknown>)['detail'] = 'row 3 product != 5000.00';
    expect(scanReportForNumbers(r).length).toBeGreaterThan(0);
  });

  it('columnHeadersSeen 被绕过白名单直接写入 → assertReportClean 抓住', () => {
    const r = base();
    r.columnHeadersSeen = ['Account 1234567'];
    expect(() => assertReportClean(r)).toThrow(ReportLeakError);
  });

  it('日期（taxYear 之外）泄漏 → 被抓住', () => {
    const r = base() as unknown as Record<string, unknown>;
    r['brokerDetected'] = '2024-02-15';
    expect(scanReportForNumbers(r).length).toBeGreaterThan(0);
  });
});
