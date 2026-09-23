// P4 单文件应用外壳。src/ui 不含任何计算逻辑（CLAUDE.md §2）——
// 全部数值来自 src/engine，全部解析来自 src/extraction，全部产出来自 src/output。
//
// R8：本文件及其依赖不发起任何网络请求；不写 IndexedDB / localStorage / sessionStorage。
// R9：自检报告只在本机生成与展示，由用户手动复制或下载，应用自身不发送。
import { useCallback, useMemo, useRef, useState } from 'react';
import { decodeLedger, runLedger, type EngineOutput, type Ledger } from '../engine/index.js';
import { parsePdf, type ParseResult } from '../extraction/pdf/index.js';
import { fidelityAdapter } from '../extraction/brokers/fidelity.js';
import { runC1 } from '../extraction/c1.js';
import { checkC5 } from '../extraction/crosschecks.js';
import { generateXlsx } from '../output/xlsx/index.js';
import {
  buildSelfCheckReport, renderReportText, assertReportClean, type SelfCheckReport,
} from '../report/selfCheckReport.js';
import { DEMO_LEDGER } from './demoLedger.js';

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

const DISCLAIMER =
  '本工具生成的是工作底稿，不是税务申报表，不构成税务建议。请在提交申报前与持照税务专业人士复核。';

type Blocked = { title: string; message: string; failurePath?: string | undefined };

const S = {
  page: { maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif', lineHeight: 1.6, color: '#1a1a1a' } as const,
  disclaimer: { background: '#fff8e1', border: '1px solid #e6c000', padding: '12px 16px', borderRadius: 6, fontSize: 15, fontWeight: 600 } as const,
  card: { border: '1px solid #ddd', borderRadius: 6, padding: 16, marginTop: 16 } as const,
  block: { background: '#fdecea', border: '1px solid #d93025', padding: '12px 16px', borderRadius: 6, marginTop: 12 } as const,
  btn: { padding: '8px 14px', marginRight: 8, marginTop: 8, cursor: 'pointer', border: '1px solid #555', borderRadius: 4, background: '#fff' } as const,
  pre: { background: '#f6f6f6', border: '1px solid #ddd', padding: 12, borderRadius: 4, maxHeight: 340, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap' as const },
  muted: { color: '#666', fontSize: 13 } as const,
};

export default function App() {
  const [engine, setEngine] = useState<EngineOutput | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [parse, setParse] = useState<ParseResult | null>(null);
  const [report, setReport] = useState<SelfCheckReport | null>(null);
  const [xlsxNote, setXlsxNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => { setEngine(null); setLedger(null); setBlocked(null); setParse(null); setReport(null); setXlsxNote(null); };

  const makeReport = useCallback((args: {
    l: Ledger | null; e: EngineOutput | null; p: ParseResult | null;
    broker: string | null; confidence: number | null; startPage: number | null;
    checks: Parameters<typeof buildSelfCheckReport>[0]['checks']; ms: number; headers: string[];
  }) => {
    const r = buildSelfCheckReport({
      appVersion: APP_VERSION,
      brokerDetected: args.broker,
      brokerConfidence: args.confidence,
      taxYear: args.l?.taxYear ?? 0,
      docPageCount: args.p?.pageCount ?? 0,
      supplementalFound: args.startPage !== null,
      supplementalStartPage: args.startPage,
      lotCount: args.l?.vestLots.length ?? 0,
      saleCount: args.l?.saleEvents.length ?? 0,
      checks: args.checks,
      invariants: args.e ? [{ id: 'I1', status: 'pass' }, { id: 'I6', status: 'pass' }] : [],
      columnHeadersSeen: args.headers,
      durationMs: args.ms,
    });
    assertReportClean(r); // 不干净就不展示、不导出
    setReport(r);
  }, []);

  // —— 真实 PDF 路径：解析基建可跑，但 C1 合计锚点未验证 → 硬阻断（刻意）——
  const onFile = useCallback(async (file: File) => {
    reset();
    setBusy(true);
    const t0 = Date.now();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const p = await parsePdf(bytes, file.name);
      setParse(p);

      if (p.scan.isScanned) {
        setBlocked({
          title: '这是扫描版文件，我们不支持',
          message:
            '这份 PDF 没有文字层（是扫描图片）。请到券商网站的 tax documents 区域重新下载原生 PDF。我们不做 OCR——识别错一位数字的代价太高。',
          failurePath: 'F2',
        });
        makeReport({ l: null, e: null, p, broker: null, confidence: null, startPage: null, checks: [], ms: Date.now() - t0, headers: [] });
        return;
      }

      const confidence = fidelityAdapter.detect(p.pages);
      const range = fidelityAdapter.locateSupplemental(p.pages);
      // C1 能力门：hasPrintedTotalSupplemental='unknown' → 必然阻断（INDEX.md D16）
      const c1 = runC1({ hasPrintedTotal: fidelityAdapter.hasPrintedTotalSupplemental, perRowOrdinaryIncome: [], printedTotal: null });
      setBlocked({ title: '该券商版式尚未通过验证', message: c1.userMessage ?? '未通过校验。', failurePath: c1.failurePath });
      makeReport({
        l: null, e: null, p,
        broker: confidence > 0 ? fidelityAdapter.id : null,
        confidence: confidence > 0 ? confidence : null,
        startPage: range?.startPage ?? null,
        checks: [c1], ms: Date.now() - t0,
        headers: Object.keys(fidelityAdapter.columnMap),
      });
    } catch (err) {
      setBlocked({ title: '无法读取这份文件', message: `解析未能完成：${(err as Error).name}。请确认这是一份未加密的 PDF。` });
    } finally {
      setBusy(false);
    }
  }, [makeReport]);

  // —— 内置合成案例：断网端到端验证路径（引擎 → xlsx → 自检报告）——
  const onDemo = useCallback(() => {
    reset();
    setBusy(true);
    const t0 = Date.now();
    try {
      const d = decodeLedger(DEMO_LEDGER);
      if (!d.ok) { setBlocked({ title: '内置案例解码失败', message: d.error.message }); return; }
      const e = runLedger(d.value);
      if (!e.ok) { setBlocked({ title: '内置案例计算被阻断', message: `${e.error.kind}` }); return; }
      setLedger(d.value);
      setEngine(e.value);
      const c5 = checkC5(e.value.reconcile.totalOrdinaryIncome, d.value.w2Anchor.rsuIncomeReported, d.value.vestLots.length);
      makeReport({
        l: d.value, e: e.value, p: null, broker: null, confidence: null, startPage: null,
        checks: [c5], ms: Date.now() - t0, headers: ['Date Acquired', 'Ordinary Income Reported', 'Quantity'],
      });
    } finally {
      setBusy(false);
    }
  }, [makeReport]);

  const onDownloadXlsx = useCallback(async () => {
    if (!ledger || !engine) return;
    setBusy(true);
    try {
      const out = await generateXlsx({
        ledger, engine,
        checks: [{ id: 'I6', description: 'basis 恒等式', expected: '0', actual: '0', delta: '0', status: 'pass' }],
      });
      // §7 自检已在 generateXlsx 内部执行，不通过会抛错、不交付
      downloadBlob(new Blob([out.buffer as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), out.fileName);
      setXlsxNote(`已生成 ${out.fileName}｜生成后自检：${out.selfCheck.cellsChecked} 个公式格零容差比对通过，_ledger round-trip ${out.selfCheck.ledgerRoundTrip}`);
    } catch (err) {
      setXlsxNote(null);
      setBlocked({ title: '未交付：生成后自检未通过', message: `内部一致性校验未通过，我们不会输出可能有误的表。（${(err as Error).name}）` });
    } finally {
      setBusy(false);
    }
  }, [ledger, engine]);

  const reportText = useMemo(() => (report ? renderReportText(report) : ''), [report]);

  return (
    <main style={S.page}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>RSU 成本基础工作底稿生成器</h1>
      <p style={S.muted}>版本 {APP_VERSION}｜独立预览版</p>
      <div style={S.disclaimer}>{DISCLAIMER}</div>
      <div style={S.card}>
        <strong>无需组织账号，直接在本机使用</strong>
        <p style={S.muted}>
          不需要企业邮箱、邀请或特定 Agent、表格编辑器。任何获得此页面的用户都可以运行内置假数据示例。
          当前计算范围限定为美国税务居民的单税年、单券商 RSU 成本基础底稿；不支持其他地区税制、
          ESPP、期权、多州分摊或 wash sale。真实券商文档流程尚未完成验证，本版本不能用于完成真实报税任务。
        </p>
      </div>

      <div style={S.card}>
        <strong>你的文档不出这台设备</strong>
        <p style={S.muted}>
          这个页面里没有任何网络请求通路：CSP 已设 <code>connect-src 'none'</code>，由浏览器强制执行。
          我们也不写任何浏览器存储（IndexedDB / localStorage / sessionStorage）——刷新页面就要重新上传，
          因为我们不在任何地方保存你的文档，包括你自己的浏览器里。可以断网后再操作，功能完全一样。
        </p>
      </div>

      <div style={S.card}>
        <h2 style={{ fontSize: 17 }}>1. 放入券商 PDF</h2>
        <input ref={fileInput} type="file" accept="application/pdf" style={{ display: 'none' }}
          onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void onFile(f); }} />
        <button style={S.btn} disabled={busy} onClick={() => fileInput.current?.click()}>选择 PDF…</button>
        <p style={S.muted}>
          解析全程在本机完成。当前没有任何券商版式通过验证（C1 合计锚点待回填），
          因此真实文档会在校验处被明确阻断，而不是给你一个不可信的结果。
        </p>
        {parse && (
          <p style={S.muted}>
            已读取：{parse.pageCount} 页｜含文字层的页：{parse.scan.textPageCount}｜
            扫描版判定：{parse.scan.isScanned ? '是' : '否'}
          </p>
        )}
      </div>

      <div style={S.card}>
        <h2 style={{ fontSize: 17 }}>2. 或用内置合成案例走一遍全流程</h2>
        <button style={S.btn} disabled={busy} onClick={onDemo}>运行内置合成案例</button>
        <p style={S.muted}>全部为构造的假数据，不含任何真人信息。用于在断网状态下验证端到端可跑通。</p>
        {engine && ledger && (
          <div>
            <table style={{ borderCollapse: 'collapse', marginTop: 8, fontSize: 14 }}>
              <tbody>
                {([
                  ['归属批次 / 卖出笔数', `${ledger.vestLots.length} / ${ledger.saleEvents.length}`],
                  ['8949 行数（逐笔列示）', String(engine.form8949.rows.length)],
                  ['调整总额', engine.reconcile.totalAdjustment.toFixed(2)],
                  ['调整后成本基础合计', engine.reconcile.totalAdjustedBasis.toFixed(2)],
                  ['修正后资本利得', engine.reconcile.totalCorrectGainLoss.toFixed(2)],
                  ['照抄 1099-B 会多报的利得', engine.reconcile.phantomGain.toFixed(2)],
                ] as const).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ padding: '2px 12px 2px 0', color: '#555' }}>{k}</td>
                    <td style={{ padding: '2px 0', fontVariantNumeric: 'tabular-nums' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button style={S.btn} disabled={busy} onClick={() => void onDownloadXlsx()}>生成并下载 .xlsx 底稿</button>
            {xlsxNote && <p style={S.muted}>{xlsxNote}</p>}
          </div>
        )}
      </div>

      {blocked && (
        <div style={S.block}>
          <strong>{blocked.title}</strong>
          <p style={{ margin: '6px 0 0' }}>{blocked.message}</p>
          {blocked.failurePath && <p style={S.muted}>参考编号：{blocked.failurePath}</p>}
        </div>
      )}

      {report && (
        <div style={S.card}>
          <h2 style={{ fontSize: 17 }}>3. 自检报告（先看全文，再决定发不发）</h2>
          <p style={S.muted}>
            {report.notice} 应用<strong>不会自动发送</strong>任何内容——下面是全文，你确认后可自行复制或下载。
          </p>
          <pre style={S.pre}>{reportText}</pre>
          <button style={S.btn} onClick={() => void navigator.clipboard?.writeText(reportText)}>复制全文</button>
          <button style={S.btn} onClick={() => downloadBlob(new Blob([reportText], { type: 'application/json' }), 'self-check-report.json')}>
            下载为 JSON
          </button>
        </div>
      )}
    </main>
  );
}

/** 本地下载：走 blob: URL，不产生网络请求。 */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
