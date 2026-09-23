// 纯 TypeScript base64。不用 Buffer（node 专属，进不了浏览器包），也不用 btoa/atob
// （需要中转 binary string，大数据要分块，且历史上有编码坑）。
// 同一份代码在 node 与浏览器里必须给出完全一致的结果——_ledger round-trip 依赖这一点。
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256).fill(255);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < n ? bytes[i + 1]! : 0;
    const b2 = i + 2 < n ? bytes[i + 2]! : 0;
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < n ? ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < n ? ALPHABET[b2 & 63] : '=';
  }
  return out;
}

export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const outLen = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = LOOKUP[clean.charCodeAt(i)]!;
    const c1 = LOOKUP[clean.charCodeAt(i + 1)]!;
    const c2 = i + 2 < clean.length ? LOOKUP[clean.charCodeAt(i + 2)]! : 255;
    const c3 = i + 3 < clean.length ? LOOKUP[clean.charCodeAt(i + 3)]! : 255;
    if (o < outLen) out[o++] = (c0 << 2) | (c1 >> 4);
    if (c2 !== 255 && o < outLen) out[o++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (c3 !== 255 && o < outLen) out[o++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}
