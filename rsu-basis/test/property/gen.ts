// fast-check 生成器：随机但【合法】的 lot / sale 组合（docs/06 §6.1）。
// 覆盖：分数股、跨 lot 卖出、单 lot 多次卖出、零卖出、全部卖出、闰日 vest、
// 两种 8949 输出形态（basisReportedToIRS true/false）。
//
// 「合法」= 构造上满足 I4（vested=withheld+delivered）、C2（oi=vested*fmv）、
// 无同日多 vest（vestDate 全不同 → STC 唯一配对）、open-market 总量 ≤ 可交付股数
// （不触发 I2/F7）。这样引擎必然成功，property 断言 I1–I7 恒成立。
import fc from 'fast-check';
import Decimal from 'decimal.js';

// vest 日全部在 2024（含闰日），open-market 卖出全部在 2025 之后 → FIFO 顺序确定、
// 且卖出晚于 vest。STC 卖出与 vest 同日。
const VEST_POOL = [
  '2024-01-15', '2024-02-15', '2024-02-29', '2024-03-15', '2024-05-15',
  '2024-06-30', '2024-08-15', '2024-09-01', '2024-11-15', '2024-12-01',
];
const SALE_POOL = ['2025-01-10', '2025-02-28', '2025-03-15', '2025-06-01', '2025-12-20'];

/** 股数：整数或 4 位小数（分数股）。 */
const sharesArb = (min: number, max: number) =>
  fc.oneof(
    fc.integer({ min, max }).map((n) => new Decimal(n)),
    fc
      .tuple(fc.integer({ min: Math.max(min, 0), max }), fc.integer({ min: 0, max: 9999 }))
      .map(([i, f]) => new Decimal(`${i}.${String(f).padStart(4, '0')}`)),
  );

/** 每股 FMV：$1.00 – $500.00（2dp）。 */
const fmvArb = fc.integer({ min: 100, max: 50000 }).map((cents) => new Decimal(cents).div(100));
/** 卖出成交价：$0.50 – $600.00（2dp），可高可低于 vest FMV。 */
const priceArb = fc.integer({ min: 50, max: 60000 }).map((cents) => new Decimal(cents).div(100));

interface RawSource {
  fileHash: string; fileName: string; page: number; rowIndex: number | null;
  columnLabel: string | null; method: string; confidence: number; rawText: string;
}
const SRC: RawSource = {
  fileHash: 'synthetic', fileName: 'synthetic', page: 1, rowIndex: null,
  columnLabel: null, method: 'manual', confidence: 1, rawText: 'synthetic',
};

export interface RawLedger {
  schemaVersion: number; taxYear: number; ticker: string;
  vestLots: unknown[]; saleEvents: unknown[]; w2Anchor: unknown;
}

const lotBodyArb = fc.record({
  delivered: sharesArb(1, 300),
  withheld: sharesArb(0, 100),
  fmv: fmvArb,
});

export const ledgerArb: fc.Arbitrary<RawLedger> = fc
  .uniqueArray(fc.constantFrom(...VEST_POOL), { minLength: 1, maxLength: 6 })
  .chain((dates) =>
    fc
      .tuple(...dates.map(() => lotBodyArb))
      .chain((bodies) => {
        const lots = bodies.map((b, i) => {
          const vested = b.delivered.add(b.withheld);
          const oi = vested.mul(b.fmv);
          return {
            id: `L${i}`,
            grantId: `G${i}`,
            vestDate: dates[i]!,
            delivered: b.delivered,
            withheld: b.withheld,
            vested,
            fmv: b.fmv,
            oi,
          };
        });
        const totalDelivered = lots.reduce((a, l) => a.add(l.delivered), new Decimal(0));

        // 每个 lot 一个 STC flag；最多 3 笔 open-market 卖出（各带一个百分比与价格）。
        return fc
          .record({
            stcFlags: fc.tuple(...lots.map(() => fc.boolean())),
            openBps: fc.array(
              fc.record({
                bps: fc.integer({ min: 1, max: 10000 }),
                date: fc.constantFrom(...SALE_POOL),
                price: priceArb,
                reported: fc.boolean(),
              }),
              { minLength: 0, maxLength: 3 },
            ),
            stcReported: fc.tuple(...lots.map(() => fc.boolean())),
            stcPrice: fc.tuple(...lots.map(() => priceArb)),
            useAnchor: fc.boolean(),
          })
          .map((cfg) => {
            const saleEvents: unknown[] = [];

            // —— STC 卖出（与 vest 同日、股数 = withheld）——
            lots.forEach((l, i) => {
              if (cfg.stcFlags[i] && l.withheld.greaterThan(0)) {
                const proceeds = l.withheld.mul(cfg.stcPrice[i]!).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
                saleEvents.push({
                  id: `C${i}`,
                  saleDate: l.vestDate,
                  sharesSold: l.withheld.toString(),
                  proceeds: proceeds.toFixed(2),
                  proceedsBasis: 'gross',
                  reportedBasis: '0.00',
                  reportedTerm: 'ST',
                  covered: true,
                  basisReportedToIRS: cfg.stcReported[i],
                  saleKind: 'sell_to_cover',
                  sources: [SRC],
                });
              }
            });

            // —— open-market 卖出：累计封顶在 totalDelivered，保证可全部匹配 ——
            let remaining = totalDelivered;
            cfg.openBps.forEach((o, n) => {
              if (remaining.lessThanOrEqualTo(0)) return;
              const requested = totalDelivered.mul(o.bps).div(10000).toDecimalPlaces(4, Decimal.ROUND_DOWN);
              const take = Decimal.min(remaining, requested);
              if (take.lessThanOrEqualTo(0)) return;
              remaining = remaining.sub(take);
              const proceeds = take.mul(o.price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
              saleEvents.push({
                id: `O${n}`,
                saleDate: o.date,
                sharesSold: take.toString(),
                proceeds: proceeds.toFixed(2),
                proceedsBasis: 'gross',
                reportedBasis: '0.00',
                reportedTerm: null,
                covered: true,
                basisReportedToIRS: o.reported,
                saleKind: 'open_market',
                sources: [SRC],
              });
            });

            const totalOi = lots.reduce((a, l) => a.add(l.oi), new Decimal(0));

            return {
              schemaVersion: 1,
              taxYear: 2024,
              ticker: 'TEST',
              vestLots: lots.map((l) => ({
                id: l.id,
                grantId: l.grantId,
                vestDate: l.vestDate,
                sharesVested: l.vested.toString(),
                sharesWithheld: l.withheld.toString(),
                sharesDelivered: l.delivered.toString(),
                vestFmv: l.fmv.toString(),
                ordinaryIncome: l.oi.toString(),
                fmvConvention: 'close',
                sources: [SRC],
              })),
              saleEvents,
              w2Anchor: {
                taxYear: 2024,
                box1Total: null,
                rsuIncomeReported: cfg.useAnchor ? totalOi.toString() : null,
                rsuIncomeSource: cfg.useAnchor ? 'box14' : null,
                sources: [SRC],
              },
            } satisfies RawLedger;
          });
      }),
  );
