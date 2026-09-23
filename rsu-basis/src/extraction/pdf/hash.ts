// 文件 sha256（docs/03 §2）。用于 SourceRef.fileHash 与幂等（docs/01 §7）。
// 纯本地计算、纯 TS 实现，无 node 依赖也无第三方库——单文件 HTML 打包要求（R8）。
import { sha256Hex } from './sha256.js';

export function sha256(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}
