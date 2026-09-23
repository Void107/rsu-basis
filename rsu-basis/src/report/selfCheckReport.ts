// 自检报告（docs/06 §4）。预览测试拿到覆盖信号、又【不接触任何人文档】的关键机制。
//
// §4.2 硬性约束——报告中绝对不得包含：
//   任何金额、股数、日期（taxYear 除外）、姓名、雇主名、ticker、账号、
//   文件名、文件哈希、原始文本片段。
// deltaMagnitude 只给数量级（"1e2"），不给具体值。
// columnHeadersSeen 是唯一例外（列头是券商公开版式，不是用户数据），但必须过白名单，
// 不透传任意文本。
//
// R9：本模块只【生成】报告。不含任何发送逻辑——由用户看过全文后手动复制或下载。
import type { CheckResult } from '../extraction/errors.js';

export const REPORT_VERSION = 1;

/** 报告顶部声明（§4.3）。 */
export const REPORT_NOTICE =
  '本文件不含任何金额、股数、日期、姓名、雇主、ticker、账号、文件名或原始文本片段。可安全分享。';

/** §4.2 的列头白名单：只保留匹配已知模式的表头（来源 docs/11 §4）。 */
export const KNOWN_COLUMN_HEADERS = [
  // Supplemental Information
  'Adjusted cost basis',
  'Adjusted gain/loss',
  'Ordinary Income Reported',
  'Adjusted Cost or Other Basis',
  'Date Acquired',
  'Quantity',
  // Form 1099-B
  '1a Description of property',
  '1b Date acquired',
  '1c Date sold or disposed',
  '1d Proceeds',
  '1e Cost or other basis',
  '2 Short-term / Long-term',
  '5 Noncovered security',
  '12 Basis reported to IRS',
  // W-2
  'Box 1 Wages, tips, other compensation',
  'Box 14 Other',
] as const;

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
const HEADER_LOOKUP = new Map(KNOWN_COLUMN_HEADERS.map((h) => [norm(h), h]));

/** 过白名单：命中则输出【白名单里的规范写法】，未命中一律丢弃（不透传任意文本）。 */
export function sanitizeColumnHeaders(seen: string[]): string[] {
  const out = new Set<string>();
  for (const s of seen) {
    const hit = HEADER_LOOKUP.get(norm(s));
    if (hit) out.add(hit);
  }
  return [...out].sort();
}

export interface ReportCheckEntry {
  id: string;
  status: 'pass' | 'skip' | 'fail';
  deltaMagnitude?: string;
}

export interface SelfCheckReport {
  reportVersion: number;
  notice: string;
  appVersion: string;
  brokerDetected: string | null;
  brokerConfidence: number | null;
  taxYear: number;
  docPageCount: number;
  supplementalFound: boolean;
  supplementalStartPage: number | null;
  lotCount: number;
  saleCount: number;
  checks: ReportCheckEntry[];
  invariants: ReportCheckEntry[];
  failurePath: string | null;
  columnHeadersSeen: string[];
  durationMs: number;
}

export interface ReportInput {
  appVersion: string;
  brokerDetected?: string | null;
  brokerConfidence?: number | null;
  taxYear: number;
  docPageCount: number;
  supplementalFound: boolean;
  supplementalStartPage?: number | null;
  lotCount: number;
  saleCount: number;
  checks: CheckResult[];
  invariants?: ReportCheckEntry[];
  columnHeadersSeen?: string[];
  durationMs: number;
}

/**
 * 组装报告。刻意【只挑选】允许的字段，而不是「拿整个对象再删几个」——
 * 后者一旦上游新增字段就会静默泄漏。
 * checks 只取 id / status / deltaMagnitude：detail 里带 rowIndex 等结构信息，userMessage 是长文本，都不进报告。
 */
export function buildSelfCheckReport(input: ReportInput): SelfCheckReport {
  const checks: ReportCheckEntry[] = input.checks.map((c) => {
    const e: ReportCheckEntry = { id: c.check, status: c.status };
    if (c.deltaMagnitude !== undefined) e.deltaMagnitude = c.deltaMagnitude;
    return e;
  });
  // 首个 fail 的失败路径（docs/05 ID），用于统计失败路径分布 → roadmap 优先级
  const firstFail = input.checks.find((c) => c.status === 'fail' && c.failurePath);
  return {
    reportVersion: REPORT_VERSION,
    notice: REPORT_NOTICE,
    appVersion: input.appVersion,
    brokerDetected: input.brokerDetected ?? null,
    brokerConfidence: input.brokerConfidence ?? null,
    taxYear: input.taxYear,
    docPageCount: input.docPageCount,
    supplementalFound: input.supplementalFound,
    supplementalStartPage: input.supplementalStartPage ?? null,
    lotCount: input.lotCount,
    saleCount: input.saleCount,
    checks,
    invariants: input.invariants ?? [],
    failurePath: firstFail?.failurePath ?? null,
    columnHeadersSeen: sanitizeColumnHeaders(input.columnHeadersSeen ?? []),
    durationMs: input.durationMs,
  };
}

/** 报告的人类可读全文（§4.3：生成后先展示给用户看全文，再由他决定发不发）。 */
export function renderReportText(r: SelfCheckReport): string {
  return JSON.stringify(r, null, 2);
}

// —— §4.2 的程序化强制（防御纵深）——

/** 允许出现数字的字段路径。数组下标归一为 []。 */
export const NUMERIC_WHITELIST = new Set<string>([
  'reportVersion',
  'appVersion',
  'brokerConfidence',
  'taxYear',
  'docPageCount',
  'supplementalStartPage',
  'lotCount',
  'saleCount',
  'durationMs',
  'checks[].id',
  'checks[].deltaMagnitude',
  'invariants[].id',
  'invariants[].deltaMagnitude',
  'failurePath',
  'columnHeadersSeen[]',
]);

/** 扫描报告，返回「在非白名单字段里出现了数字」的路径清单。空数组 = 干净。 */
export function scanReportForNumbers(report: unknown): string[] {
  const offenders: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((v) => walk(v, `${path}[]`));
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path === '' ? k : `${path}.${k}`);
      }
      return;
    }
    if (typeof node === 'boolean') return;
    const isWhitelisted = NUMERIC_WHITELIST.has(path);
    if (typeof node === 'number') {
      if (!isWhitelisted) offenders.push(`${path} (number)`);
      return;
    }
    if (typeof node === 'string') {
      if (!isWhitelisted && /\d/.test(node)) offenders.push(`${path} (digits in string)`);
    }
  };
  walk(report, '');
  return offenders;
}

export class ReportLeakError extends Error {
  constructor(readonly offenders: string[]) {
    super(`ReportLeakError: disallowed values at ${offenders.join(', ')}`);
    this.name = 'ReportLeakError';
  }
}

/** 生成后必须调用：不干净就不给用户看/不给导出。 */
export function assertReportClean(report: SelfCheckReport): void {
  const offenders = scanReportForNumbers(report);
  const badHeaders = report.columnHeadersSeen.filter((h) => !HEADER_LOOKUP.has(norm(h)));
  if (badHeaders.length > 0) offenders.push(`columnHeadersSeen contains non-whitelisted entries`);
  if (offenders.length > 0) throw new ReportLeakError(offenders);
}
