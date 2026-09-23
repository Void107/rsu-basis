// 提取层交叉校验的错误类型（docs/03 §4 → docs/05 失败路径）。
// 每个失败都携带：失败路径 ID（docs/05）、阻断级别、【用户文案】（不是 "Error: ..."）。
//
// R7（不记录 PII）：错误对象不带任何金额/股数/姓名/账号。诊断只放：校验号、失败路径、
// 结构标识（rowIndex/行数）、以及差额的【数量级】deltaMagnitude（如 "1e2"，同自检报告 §4.2），
// 不放具体数值。用户看到的具体数字由 UI 从内存中的数据渲染，不经过错误对象。

// C1–C7 见 docs/03 §4。C8/C9 为本仓库新增（决策记录见 INDEX.md D15/D16）：
//   C8 1099-B 合计锚定（对称于 C1，pending Gate C）
//   C9 逐字符回比（解析层自校验，立即生效）
export type CheckId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9';
export type CheckLevel = 'HARD' | 'DECIDE' | 'WARN';
export type CheckStatus = 'pass' | 'skip' | 'fail';

export interface CheckResult {
  check: CheckId;
  status: CheckStatus;
  level: CheckLevel;
  failurePath?: string; // docs/05，如 'F11'
  userMessage?: string; // 面向用户的中文文案
  detail?: string; // 脱敏诊断，无金额
  deltaMagnitude?: string; // 差额数量级，如 '1e2'；无具体值
}

/** 可抛出的交叉校验错误。由一条 fail 的 CheckResult 构造，保证一定带失败路径与文案。 */
export class CrossCheckError extends Error {
  readonly kind = 'CrossCheckError' as const;
  readonly check: CheckId;
  readonly failurePath: string;
  readonly level: CheckLevel;
  readonly userMessage: string;
  readonly detail: string;
  readonly deltaMagnitude: string | undefined;
  constructor(r: CheckResult) {
    if (r.status !== 'fail' || !r.failurePath || !r.userMessage) {
      throw new Error('CrossCheckError requires a failed CheckResult with failurePath and userMessage');
    }
    super(`${r.check}/${r.failurePath}`); // message 只含校验号+失败路径，无 PII
    this.name = 'CrossCheckError';
    this.check = r.check;
    this.failurePath = r.failurePath;
    this.level = r.level;
    this.userMessage = r.userMessage;
    this.detail = r.detail ?? '';
    this.deltaMagnitude = r.deltaMagnitude;
  }
}
