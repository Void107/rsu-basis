// §6 跨年 ledger：schema JSON → gzip + base64 → 隐藏 sheet `_ledger` 的 A1..An。
// 单元格字符串上限 32767，超出分片。读取时 schemaVersion 不兼容必须明确报错，不静默降级。
import { gzipSync, gunzipSync } from 'fflate';
import { bytesToBase64, base64ToBytes } from './base64.js';

export const CELL_LIMIT = 32767;
export const SUPPORTED_SCHEMA_VERSIONS = [1];

export class LedgerVersionError extends Error {
  constructor(readonly found: unknown) {
    super(`LedgerVersionError: unsupported schemaVersion ${String(found)}`);
    this.name = 'LedgerVersionError';
  }
}

const b64encode = bytesToBase64;
const b64decode = base64ToBytes;

/** ledger 对象 → 分片后的 base64 串数组（写入 A1..An）。 */
export function encodeLedger(ledger: unknown): string[] {
  const json = JSON.stringify(ledger);
  const gz = gzipSync(new TextEncoder().encode(json), { level: 9 });
  const b64 = b64encode(gz);
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += CELL_LIMIT) chunks.push(b64.slice(i, i + CELL_LIMIT));
  return chunks.length > 0 ? chunks : [''];
}

/** 分片 → ledger 对象。版本不支持 → LedgerVersionError（不静默降级）。 */
export function decodeLedger(chunks: string[]): unknown {
  const b64 = chunks.join('');
  const json = new TextDecoder().decode(gunzipSync(b64decode(b64)));
  const obj = JSON.parse(json) as { schemaVersion?: unknown };
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(Number(obj.schemaVersion))) {
    throw new LedgerVersionError(obj.schemaVersion);
  }
  return obj;
}
