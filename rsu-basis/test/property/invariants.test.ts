// Property test（docs/02 §4、docs/06 §6.1）：对随机但合法的输入，验证 7 条不变量恒成立。
// 这是本项目的主要测试形态。
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import Decimal from 'decimal.js';
import { decodeLedger, runLedger, type EngineOutput, type Ledger } from '../../src/engine/index.js';
import { serializeMatches, serializeForm8949 } from '../golden/serialize.js';
import { ledgerArb } from './gen.js';

function decodeOk(raw: unknown): Ledger {
  const d = decodeLedger(raw);
  if (!d.ok) throw new Error(`decode failed: ${d.error.message}`);
  return d.value;
}

const sum = (xs: Decimal[]) => xs.reduce((a, b) => a.add(b), new Decimal(0));

describe('engine invariants (I1–I7)', () => {
  it('generator always yields a runnable ledger and all invariants hold', () => {
    fc.assert(
      fc.property(ledgerArb, (raw) => {
        const ledger = decodeOk(raw);
        const res = runLedger(ledger);
        // 合法输入必然成功；失败即生成器或引擎有 bug。
        expect(res.ok, res.ok ? '' : `engine error: ${res.error.kind}`).toBe(true);
        if (!res.ok) return;
        const out: EngineOutput = res.value;
        const { matches } = out;

        // I1 — 每笔卖出 Σ matched == sharesSold
        for (const sale of ledger.saleEvents) {
          const matched = sum(matches.filter((m) => m.saleId === sale.id).map((m) => m.sharesMatched));
          expect(matched.equals(sale.sharesSold), `I1 ${sale.id}`).toBe(true);
        }

        // I2 — 每个 lot Σ matched ≤ sharesVested
        for (const lot of ledger.vestLots) {
          const matched = sum(matches.filter((m) => m.lotId === lot.id).map((m) => m.sharesMatched));
          expect(matched.lessThanOrEqualTo(lot.sharesVested), `I2 ${lot.id}`).toBe(true);
        }

        // I4 — sharesVested == sharesWithheld + sharesDelivered
        for (const lot of ledger.vestLots) {
          const w = lot.sharesWithheld ?? new Decimal(0);
          expect(w.add(lot.sharesDelivered).equals(lot.sharesVested), `I4 ${lot.id}`).toBe(true);
        }

        // I5 — 每条 adjustmentAmount ≤ 0
        for (const m of matches) {
          const adjustment = m.reportedBasisPortion.sub(m.adjustedBasis);
          expect(adjustment.lessThanOrEqualTo(0), `I5 ${m.saleId}/${m.lotId}`).toBe(true);
        }

        // I6 — Σ 普通所得部分 + Σ 未匹配 basis == Σ ordinaryIncome（精确）。
        // 普通所得部分 = adjustedBasis − reportedBasisPortion（docs/02 §2.4 加法式）。
        const totalOiPortion = sum(matches.map((m) => m.adjustedBasis.sub(m.reportedBasisPortion)));
        let unmatchedBasis = new Decimal(0);
        for (const lot of ledger.vestLots) {
          const matched = sum(matches.filter((m) => m.lotId === lot.id).map((m) => m.sharesMatched));
          unmatchedBasis = unmatchedBasis.add(lot.sharesVested.sub(matched).mul(lot.vestFmv));
        }
        const totalOi = sum(ledger.vestLots.map((l) => l.ordinaryIncome));
        expect(totalOiPortion.add(unmatchedBasis).equals(totalOi), 'I6').toBe(true);

        // proceeds 分摊：每笔卖出的 Σ proceedsPortion == proceeds（docs/02 §2.4）
        for (const sale of ledger.saleEvents) {
          const p = sum(matches.filter((m) => m.saleId === sale.id).map((m) => m.proceedsPortion));
          expect(p.equals(sale.proceeds), `proceeds-split ${sale.id}`).toBe(true);
        }

        // I7 — 两次运行深度相等
        const again = runLedger(ledger);
        expect(again.ok).toBe(true);
        if (again.ok) {
          expect(serializeMatches(again.value)).toEqual(serializeMatches(out));
          expect(serializeForm8949(again.value.form8949)).toEqual(serializeForm8949(out.form8949));
        }
      }),
      { numRuns: 300 },
    );
  });

  // I3 — 有 W-2 锚点时 Σ ordinaryIncome 与之相等（生成器在 useAnchor 时精确对齐）
  it('I3 — reconcile succeeds and anchors when W-2 total is present', () => {
    fc.assert(
      fc.property(ledgerArb, (raw) => {
        const ledger = decodeOk(raw);
        const res = runLedger(ledger);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        if (ledger.w2Anchor.rsuIncomeReported === null) {
          expect(res.value.reconcile.warnings).toContain('C5_SKIPPED_NO_W2_ANCHOR');
        } else {
          const totalOi = sum(ledger.vestLots.map((l) => l.ordinaryIncome));
          expect(totalOi.equals(ledger.w2Anchor.rsuIncomeReported)).toBe(true);
          expect(res.value.reconcile.warnings).toBeUndefined();
        }
      }),
      { numRuns: 200 },
    );
  });
});
