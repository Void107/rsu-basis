// 注入测试 —— P2 的 gate（docs/06 §8），不是可选项。
//
// 对每个 golden case 程序化注入【单字段】扰动，断言至少一条 C1–C9 捕获并【阻断】。
// 捕获率必须是 100%：任何一种扰动能静默通过，就是必须修的漏洞。
// 「提取错误率可以不为零，静默错误率必须为零。」
//
// 扰动种类（docs/06 §8 + 本轮扩充的 1099-B 侧）：
//   改一位数字 / 相邻两行串行 / 漏掉一行 / 每股与总额口径互换 / 日期错一天 / 股数与金额错位
import { describe, it, expect } from 'vitest';
import { loadModel, anchorsFrom, runChecks, isBlocked, firedChecks, perturbations, type Model } from './inject.js';

const CASES = ['synthetic-001', 'synthetic-002', 'synthetic-003', 'synthetic-004'];

describe('injection test — P2 gate (docs/06 §8)', () => {
  const models: Model[] = CASES.map(loadModel);

  it('baseline：未扰动的 golden case 不得被阻断（否则校验是「永远报警」而非有效）', () => {
    for (const m of models) {
      const r = runChecks(m, anchorsFrom(m));
      expect(isBlocked(r), `${m.caseName} baseline fired ${firedChecks(r).join(',')}`).toBe(false);
    }
  });

  const ALL_KINDS = [
    'adjacent-row-serial',
    'date-off-by-one',
    'drop-row',
    'flip-digit',
    'per-share-vs-total',
    'shares-amount-misalign',
  ];
  // 「串行」需要两行且两值不同，单 lot 且两笔卖出金额相同的 case（synthetic-002）造不出来。
  // 因此：全集必须覆盖六类；每个 case 至少覆盖其余五类。不为了凑数造 no-op 扰动。
  const ALWAYS = ALL_KINDS.filter((k) => k !== 'adjacent-row-serial');

  it('扰动集覆盖全部六类（防止悄悄缩水）', () => {
    const union = new Set(models.flatMap((m) => perturbations(m).map((p) => p.id)));
    expect([...union].sort()).toEqual(ALL_KINDS);
  });

  it('每个 case 至少覆盖五类（串行类视该 case 是否造得出）', () => {
    for (const m of models) {
      const ids = new Set(perturbations(m).map((p) => p.id));
      for (const k of ALWAYS) expect(ids.has(k), `${m.caseName} 缺少扰动类别 ${k}`).toBe(true);
    }
  });

  // 逐 case × 逐扰动断言，失败时能直接看到是哪一条漏网。
  for (const caseName of CASES) {
    describe(caseName, () => {
      const m = loadModel(caseName);
      const anchors = anchorsFrom(m);
      for (const p of perturbations(m)) {
        it(`捕获 [${p.id}] ${p.label}`, () => {
          const results = runChecks(p.apply(m), anchors);
          expect(
            isBlocked(results),
            `SILENT ERROR: ${caseName} / ${p.label} 未被任何 C1–C9 捕获`,
          ).toBe(true);
        });
      }
    });
  }

  it('总捕获率 = 100%（0 条静默通过）', () => {
    const uncaught: string[] = [];
    let total = 0;
    for (const m of models) {
      const anchors = anchorsFrom(m);
      for (const p of perturbations(m)) {
        total++;
        if (!isBlocked(runChecks(p.apply(m), anchors))) uncaught.push(`${m.caseName} :: ${p.label}`);
      }
    }
    expect(total).toBeGreaterThanOrEqual(40); // 扰动集不得退化
    expect(uncaught, `未被捕获的扰动:\n${uncaught.join('\n')}`).toEqual([]);
  });
});
