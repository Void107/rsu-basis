// 引擎入口。纯函数管线：decode → normalize → match → reconcile → emit 8949。
// 任一步出错都以 Result 的 Err 短路，绝不返回部分结果（docs/02 §6、CLAUDE.md R2）。
import {
  type Form8949Output,
  type Ledger,
  type Match,
  type MatchPolicy,
  type ReconcileReport,
  Ok,
  Err,
  type Result,
} from './types.js';
import type { EngineError } from './errors.js';
import { decodeLedger } from './decode.js';
import { normalizeVestEvents } from './lots.js';
import { matchSalesToLots } from './matching.js';
import { reconcile } from './reconcile.js';
import { buildForm8949 } from './form8949.js';

export * from './types.js';
export * from './errors.js';
export { decodeLedger } from './decode.js';
export { normalizeVestEvents } from './lots.js';
export { matchSalesToLots } from './matching.js';
export { computeAdjustedBasis } from './basis.js';
export { classifyHoldingPeriod, plusOneYear } from './holding.js';
export { reconcile } from './reconcile.js';
export { emit8949Rows, buildForm8949 } from './form8949.js';

export interface EngineOutput {
  matches: Match[];
  reconcile: ReconcileReport;
  form8949: Form8949Output;
}

const DEFAULT_POLICY: MatchPolicy = { method: 'fifo' };

/** 从已归一的 Ledger 跑完整管线。 */
export function runLedger(ledger: Ledger, policy: MatchPolicy = DEFAULT_POLICY): Result<EngineOutput, EngineError> {
  const norm = normalizeVestEvents(ledger.vestLots);
  if (!norm.ok) return norm;
  const lots = norm.value;

  const matched = matchSalesToLots(ledger.saleEvents, lots, policy);
  if (!matched.ok) return matched;
  const matches = matched.value;

  const rec = reconcile(lots, ledger.w2Anchor, matches);
  if (!rec.ok) return rec;

  const form8949 = buildForm8949(matches, ledger.saleEvents, lots, ledger.ticker);
  return Ok({ matches, reconcile: rec.value, form8949 });
}

/** 从原始 JSON 对象（已 JSON.parse）跑完整管线，含 R2 的 null 校验。 */
export function runRawLedger(raw: unknown, policy: MatchPolicy = DEFAULT_POLICY): Result<EngineOutput, EngineError> {
  const decoded = decodeLedger(raw);
  if (!decoded.ok) return Err(decoded.error);
  return runLedger(decoded.value, policy);
}
