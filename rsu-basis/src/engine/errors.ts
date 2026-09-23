// 错误类型（docs/02 §5）。前四类是预期内、面向用户的阻断态，都对应 docs/05 的失败路径文案。
// InvariantViolation 是内部 bug，脱敏后上报，不向用户展示细节。
//
// CLAUDE.md R7：错误对象不得携带 PII（金额、姓名、账号、原始文本）。这里只带
// 字段名、lotId/saleId 这类结构标识、以及来源位置描述，不带任何金额。

export class MissingDataError extends Error {
  readonly kind = 'MissingDataError' as const;
  readonly field: string;
  readonly lotId?: string;
  readonly saleId?: string;
  readonly expectedSource: string;
  constructor(args: { field: string; lotId?: string; saleId?: string; expectedSource: string }) {
    super(`MissingDataError: ${args.field}`);
    this.name = 'MissingDataError';
    this.field = args.field;
    if (args.lotId !== undefined) this.lotId = args.lotId;
    if (args.saleId !== undefined) this.saleId = args.saleId;
    this.expectedSource = args.expectedSource;
  }
}

/** 交叉校验超出容差（C1/C2/C5…）。带两侧「数量级」标识用于诊断，但不带具体金额。 */
export class ReconciliationError extends Error {
  readonly kind = 'ReconciliationError' as const;
  readonly check: string;
  readonly detail: string;
  constructor(args: { check: string; detail: string }) {
    super(`ReconciliationError: ${args.check}`);
    this.name = 'ReconciliationError';
    this.check = args.check;
    this.detail = args.detail;
  }
}

/** lot 匹配有多解，交用户裁决（docs/05 F16/F18）。禁止用「最接近」自动消歧。 */
export class AmbiguousMatchError extends Error {
  readonly kind = 'AmbiguousMatchError' as const;
  readonly saleId: string;
  readonly candidateLotIds: string[];
  readonly reason: string;
  constructor(args: { saleId: string; candidateLotIds: string[]; reason: string }) {
    super(`AmbiguousMatchError: ${args.saleId}`);
    this.name = 'AmbiguousMatchError';
    this.saleId = args.saleId;
    this.candidateLotIds = args.candidateLotIds;
    this.reason = args.reason;
  }
}

/** 检测到 V1 范围外情形（docs/01 §1、docs/05 §2）。 */
export class OutOfScopeError extends Error {
  readonly kind = 'OutOfScopeError' as const;
  readonly scopeItem: string;
  constructor(args: { scopeItem: string }) {
    super(`OutOfScopeError: ${args.scopeItem}`);
    this.name = 'OutOfScopeError';
    this.scopeItem = args.scopeItem;
  }
}

/** 内部不变量违反。应发生 = 代码 bug（docs/02 §4）。 */
export class InvariantViolation extends Error {
  readonly kind = 'InvariantViolation' as const;
  readonly invariant: string;
  readonly detail: string;
  constructor(args: { invariant: string; detail: string }) {
    super(`InvariantViolation: ${args.invariant}`);
    this.name = 'InvariantViolation';
    this.invariant = args.invariant;
    this.detail = args.detail;
  }
}

export type EngineError =
  | MissingDataError
  | ReconciliationError
  | AmbiguousMatchError
  | OutOfScopeError
  | InvariantViolation;
