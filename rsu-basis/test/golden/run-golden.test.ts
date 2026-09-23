// Golden test（docs/06 §6.2）：把每个 case 的 expected/ledger.json 喂进引擎，
// 逐格比对 matches.json 与 form8949.json，金额零容差、股数零容差。
//
// 期望值来自合成构造并由 verify.py 独立验算（docs/06 §7、§10、D10）——
// 绝不用引擎自身输出当期望值。
//
// 同时锁 I7（determinism）：同一 ledger 连跑两次，输出深度相等。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRawLedger } from '../../src/engine/index.js';
import { serializeMatches, serializeForm8949 } from './serialize.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const caseDirs = readdirSync(HERE, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(HERE, d.name, 'expected', 'ledger.json')))
  .map((d) => d.name)
  .sort();

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

describe('golden set', () => {
  it('finds the two synthetic cases', () => {
    expect(caseDirs).toContain('synthetic-001');
    expect(caseDirs).toContain('synthetic-002');
  });

  for (const name of caseDirs) {
    describe(name, () => {
      const dir = join(HERE, name);
      const ledger = readJson(join(dir, 'expected', 'ledger.json'));
      const expectedMatches = readJson(join(dir, 'expected', 'matches.json'));
      const expectedForm = readJson(join(dir, 'expected', 'form8949.json'));

      const result = runRawLedger(ledger);

      it('engine runs without error', () => {
        if (!result.ok) throw new Error(`engine returned ${result.error.kind}: ${result.error.message}`);
      });

      it('matches.json — zero-tolerance', () => {
        if (!result.ok) throw new Error('engine errored');
        expect(serializeMatches(result.value)).toEqual(expectedMatches);
      });

      it('form8949.json — zero-tolerance', () => {
        if (!result.ok) throw new Error('engine errored');
        expect(serializeForm8949(result.value.form8949)).toEqual(expectedForm);
      });

      it('I7 — deterministic across two runs', () => {
        const a = runRawLedger(ledger);
        const b = runRawLedger(ledger);
        if (!a.ok || !b.ok) throw new Error('engine errored');
        expect(serializeMatches(a.value)).toEqual(serializeMatches(b.value));
        expect(serializeForm8949(a.value.form8949)).toEqual(serializeForm8949(b.value.form8949));
      });
    });
  }
});
