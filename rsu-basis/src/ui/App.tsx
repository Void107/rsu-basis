// P4 单文件应用外壳。src/ui 不含任何计算逻辑（CLAUDE.md §2）——
// 全部数值来自 src/engine，全部解析来自 src/extraction，全部产出来自 src/output。
//
// R8：本文件及其依赖不发起任何网络请求；不写 IndexedDB / localStorage / sessionStorage。
// R9：自检报告只在本机生成与展示，由用户手动复制或下载，应用自身不发送。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeLedger, runLedger, type EngineOutput, type Ledger } from '../engine/index.js';
import { parsePdf, type ParseResult } from '../extraction/pdf/index.js';
import { fidelityAdapter } from '../extraction/brokers/fidelity.js';
import { runC1 } from '../extraction/c1.js';
import { checkC5 } from '../extraction/crosschecks.js';
import { generateXlsx } from '../output/xlsx/index.js';
import {
  buildSelfCheckReport, renderReportText, assertReportClean, type SelfCheckReport,
} from '../report/selfCheckReport.js';
import { copy, type Language, type CopyKey } from './i18n.js';
import { DEMO_LEDGER } from './demoLedger.js';

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

type Blocked = { title: CopyKey; message: CopyKey; detail?: string; failurePath?: string | undefined };

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
  const [language, setLanguage] = useState<Language>('en');
  const t = copy[language];
  const [copyStatus, setCopyStatus] = useState<'copyOk' | 'copyFailed' | null>(null);
  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    document.title = copy[language].title;
  }, [language]);
  const [engine, setEngine] = useState<EngineOutput | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [parse, setParse] = useState<ParseResult | null>(null);
  const [report, setReport] = useState<SelfCheckReport | null>(null);
  const [xlsxNote, setXlsxNote] = useState<{ fileName: string; cells: number; roundTrip: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => { setEngine(null); setLedger(null); setBlocked(null); setParse(null); setReport(null); setXlsxNote(null); setCopyStatus(null); };

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
          title: 'scanTitle', message: 'scanMessage',
          failurePath: 'F2',
        });
        makeReport({ l: null, e: null, p, broker: null, confidence: null, startPage: null, checks: [], ms: Date.now() - t0, headers: [] });
        return;
      }

      const confidence = fidelityAdapter.detect(p.pages);
      const range = fidelityAdapter.locateSupplemental(p.pages);
      // C1 能力门：hasPrintedTotalSupplemental='unknown' → 必然阻断（INDEX.md D16）
      const c1 = runC1({ hasPrintedTotal: fidelityAdapter.hasPrintedTotalSupplemental, perRowOrdinaryIncome: [], printedTotal: null });
      setBlocked({ title: 'brokerTitle', message: 'brokerMessage', failurePath: c1.failurePath });
      makeReport({
        l: null, e: null, p,
        broker: confidence > 0 ? fidelityAdapter.id : null,
        confidence: confidence > 0 ? confidence : null,
        startPage: range?.startPage ?? null,
        checks: [c1], ms: Date.now() - t0,
        headers: Object.keys(fidelityAdapter.columnMap),
      });
    } catch (err) {
      setBlocked({ title: 'readTitle', message: 'readMessage', detail: (err as Error).name });
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
      if (!d.ok) { setBlocked({ title: 'decodeTitle', message: 'decodeMessage' }); return; }
      const e = runLedger(d.value);
      if (!e.ok) { setBlocked({ title: 'engineTitle', message: 'engineMessage', detail: e.error.kind }); return; }
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
      setXlsxNote({ fileName: out.fileName, cells: out.selfCheck.cellsChecked, roundTrip: out.selfCheck.ledgerRoundTrip === 'ok' });
    } catch (err) {
      setXlsxNote(null);
      setBlocked({ title: 'exportTitle', message: 'exportMessage', detail: (err as Error).name });
    } finally {
      setBusy(false);
    }
  }, [ledger, engine]);

  const reportText = useMemo(() => (report ? renderReportText({ ...report, notice: t.reportNotice }) : ''), [report, t.reportNotice]);

  return (
    <main style={S.page}>
      <nav aria-label="Language / 语言" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button style={{ ...S.btn, fontWeight: language === 'en' ? 700 : 400, background: language === 'en' ? '#e8f0fe' : '#fff' }} lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button>
        <button style={{ ...S.btn, fontWeight: language === 'zh' ? 700 : 400, background: language === 'zh' ? '#e8f0fe' : '#fff' }} lang="zh-CN" aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button>
      </nav>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>{t.title}</h1>
      <p style={S.muted}>{t.version} {APP_VERSION} | {t.preview}</p>
      <div style={S.disclaimer}>{t.disclaimer}</div>
      <div style={S.card}><strong>{t.accessTitle}</strong><p style={S.muted}>{t.access}</p></div>
      <div style={S.card}><strong>{t.privacyTitle}</strong><p style={S.muted}>{t.privacy}</p></div>
      <div style={S.card}>
        <h2 style={{ fontSize: 17 }}>{t.pdfTitle}</h2>
        <input aria-label={t.choosePdf} ref={fileInput} type="file" accept="application/pdf" style={{ display: 'none' }}
          onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void onFile(f); }} />
        <button style={S.btn} disabled={busy} onClick={() => fileInput.current?.click()}>{t.choosePdf}</button>
        <p style={S.muted}>{t.pdfNote}</p>
        {parse && (
          <p style={S.muted}>
            {t.pages}: {parse.pageCount} | {t.textPages}: {parse.scan.textPageCount} | {t.scanned}: {parse.scan.isScanned ? t.yes : t.no}
          </p>
        )}
      </div>

      <div style={S.card}>
        <h2 style={{ fontSize: 17 }}>{t.demoTitle}</h2>
        <button style={S.btn} disabled={busy} onClick={onDemo}>{t.demo}</button>
        <p style={S.muted}>{t.demoNote}</p>
        {engine && ledger && (
          <div>
            <table style={{ borderCollapse: 'collapse', marginTop: 8, fontSize: 14 }}>
              <tbody>
                {([
                  [t.lots, `${ledger.vestLots.length} / ${ledger.saleEvents.length}`],
                  [t.rows, String(engine.form8949.rows.length)],
                  [t.adjustment, engine.reconcile.totalAdjustment.toFixed(2)],
                  [t.basis, engine.reconcile.totalAdjustedBasis.toFixed(2)],
                  [t.gain, engine.reconcile.totalCorrectGainLoss.toFixed(2)],
                  [t.phantom, engine.reconcile.phantomGain.toFixed(2)],
                ] as const).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ padding: '2px 12px 2px 0', color: '#555' }}>{k}</td>
                    <td style={{ padding: '2px 0', fontVariantNumeric: 'tabular-nums' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button style={S.btn} disabled={busy} onClick={() => void onDownloadXlsx()}>{t.download}</button>
            <p style={S.muted}>{t.workbookNote}</p>
            {xlsxNote && <p role="status" style={S.muted}>{t.generated} {xlsxNote.fileName} | {t.formulaCheck}: {xlsxNote.cells} | {t.roundTrip}: {xlsxNote.roundTrip ? t.yes : t.no}</p>}
          </div>
        )}
      </div>

      {blocked && (
        <div style={S.block}>
          <strong>{t[blocked.title]}</strong>
          <p style={{ margin: '6px 0 0' }}>{t[blocked.message]} {blocked.detail}</p>
          {blocked.failurePath && <p style={S.muted}>{t.reference}: {blocked.failurePath}</p>}
        </div>
      )}

      {report && (
        <div style={S.card}>
          <h2 style={{ fontSize: 17 }}>{t.reportTitle}</h2>
          <p style={S.muted}>
            {t.reportNote}
          </p>
          {copyStatus && <p role="status">{t[copyStatus]}</p>}
          <pre style={S.pre}>{reportText}</pre>
          <button style={S.btn} onClick={() => { void (async () => { try { await navigator.clipboard.writeText(reportText); setCopyStatus('copyOk'); } catch { setCopyStatus('copyFailed'); } })(); }}>{t.copy}</button>
          <button style={S.btn} onClick={() => downloadBlob(new Blob([reportText], { type: 'application/json' }), 'self-check-report.json')}>
            {t.json}
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
