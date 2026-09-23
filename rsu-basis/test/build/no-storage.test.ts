// @vitest-environment jsdom
//
// CI 断言 ②：集成测试跑完后 IndexedDB 与 localStorage 为空。
//
// 做法：在 jsdom 里把 localStorage/sessionStorage 的写入方法与 indexedDB.open 全部插桩，
// 然后跑【完整流程】（解码 → 引擎 → xlsx 生成含 §7 自检 → 自检报告），
// 最后断言：一次写入都没发生，且三处存储皆空。
//
// R8：跨年状态只由用户下载的 xlsx 的 _ledger sheet 承载，不由浏览器存储承载。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';
import { decodeLedger, runLedger } from '../../src/engine/index.js';
import { generateXlsx } from '../../src/output/xlsx/index.js';
import { buildSelfCheckReport, assertReportClean } from '../../src/report/selfCheckReport.js';
import { checkC5 } from '../../src/extraction/crosschecks.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const LEDGER = join(ROOT, 'test', 'golden', 'synthetic-001', 'expected', 'ledger.json');

const writes: string[] = [];

beforeAll(() => {
  // 注意：jsdom 的 Storage 是 Proxy——给【实例】赋任意属性会真的写进一条 item。
  // 所以插桩必须打在 Storage.prototype 上，否则插桩本身就会污染被测对象。
  const proto = Storage.prototype;
  const origSet = proto.setItem;
  proto.setItem = function patched(this: Storage, k: string, v: string) {
    writes.push(`setItem(${k})`);
    return origSet.call(this, k, v);
  };
  const idb = (globalThis as { indexedDB?: { open?: unknown } }).indexedDB;
  if (idb && typeof idb.open === 'function') {
    const open = idb.open.bind(idb) as (...a: unknown[]) => unknown;
    idb.open = (...a: unknown[]) => { writes.push('indexedDB.open'); return open(...a); };
  }
});

describe('CI 断言 ② 集成测试后浏览器存储为空', () => {
  it('跑完整流程（引擎 → xlsx+自检 → 自检报告）不触碰任何浏览器存储', async () => {
    const raw = JSON.parse(readFileSync(LEDGER, 'utf8'));
    const d = decodeLedger(raw);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const e = runLedger(d.value);
    expect(e.ok).toBe(true);
    if (!e.ok) return;

    // xlsx 生成（内部含 §7 读回自检）
    const out = await generateXlsx({
      ledger: d.value, engine: e.value,
      checks: [{ id: 'I6', description: 'basis 恒等式', expected: '0', actual: '0', delta: '0', status: 'pass' }],
    });
    expect(out.selfCheck.ok).toBe(true);

    // 自检报告
    const r = buildSelfCheckReport({
      appVersion: '0.4.0', taxYear: d.value.taxYear, docPageCount: 0,
      supplementalFound: false, lotCount: d.value.vestLots.length, saleCount: d.value.saleEvents.length,
      checks: [checkC5(e.value.reconcile.totalOrdinaryIncome, d.value.w2Anchor.rsuIncomeReported, d.value.vestLots.length)],
      durationMs: 1,
    });
    assertReportClean(r);

    // —— 断言 ——
    expect(writes, `发生了存储写入:\n${writes.join('\n')}`).toEqual([]);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(Object.keys(localStorage)).toEqual([]);
    expect(Object.keys(sessionStorage)).toEqual([]);
  });

  it('源码中不存在任何浏览器存储 API 的引用（静态兜底）', () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(n) && !n.endsWith('.d.ts')) out.push(p);
      }
      return out;
    };
    // 匹配【使用】而非单词本身：UI 的隐私说明文案里会出现 "localStorage" 等字样
    // （"我们也不写任何浏览器存储（IndexedDB / localStorage / sessionStorage）"），
    // 那是给用户看的承诺，不是 API 调用。真正的使用一定带成员访问或下标。
    const banned = [
      /\blocalStorage\s*[.[]/,
      /\bsessionStorage\s*[.[]/,
      /\bindexedDB\s*[.[]/,
      /\bwindow\s*\.\s*(localStorage|sessionStorage|indexedDB)\b/,
      /\bopenDatabase\s*\(/,
      /\bcaches\s*\.\s*(open|match)\s*\(/,
    ];
    const offenders: string[] = [];
    for (const f of walk(join(ROOT, 'src'))) {
      const code = strip(readFileSync(f, 'utf8'));
      for (const re of banned) if (re.test(code)) offenders.push(`${f.replace(ROOT + '/', '')}: ${re}`);
    }
    expect(offenders, `源码引用了浏览器存储:\n${offenders.join('\n')}`).toEqual([]);
  });
});
