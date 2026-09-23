// §5 兼容性守卫。必须在 Excel(Win/Mac) / Numbers / Google Sheets 三处打开且公式不报错。
//
// 只允许：SUM、SUMIF、IF、EDATE、ROUND、基本算术、A1 引用。
// 禁用：动态数组函数（FILTER / XLOOKUP / LET 等，Numbers 与旧版 Excel 不支持）、
//       结构化引用（Table[Column]，Numbers 支持不完整）、EDATE 之外的日期函数。
//
// 这是【构建期】强制：每个写入的公式都过一遍 assertFormulaAllowed，不合规直接抛错，
// 而不是等到用户在 Numbers 里打开才发现 #NAME?。

export const ALLOWED_FUNCTIONS = ['SUM', 'SUMIF', 'IF', 'EDATE', 'ROUND'] as const;
const ALLOWED = new Set<string>(ALLOWED_FUNCTIONS);

/** 公式里出现的函数名：标识符后紧跟左括号。 */
const FUNC_CALL = /([A-Za-z][A-Za-z0-9._]*)\s*\(/g;
/** 结构化引用：Name[Column] */
const STRUCTURED_REF = /[A-Za-z_][A-Za-z0-9_.]*\s*\[/;

export class FormulaCompatibilityError extends Error {
  readonly kind = 'FormulaCompatibilityError' as const;
  constructor(readonly formula: string, readonly reason: string) {
    super(`FormulaCompatibilityError: ${reason}`);
    this.name = 'FormulaCompatibilityError';
  }
}

/** 去掉字符串字面量，避免把 "SUM(" 这类文本误判为函数调用。 */
function stripStringLiterals(f: string): string {
  return f.replace(/"(?:[^"]|"")*"/g, '""');
}

export function assertFormulaAllowed(formula: string): void {
  const body = stripStringLiterals(formula);

  if (STRUCTURED_REF.test(body)) {
    throw new FormulaCompatibilityError(formula, 'structured reference (Table[Column]) is not portable to Numbers');
  }
  // 动态数组溢出运算符 A1#
  if (/[A-Za-z]\$?\d+#/.test(body)) {
    throw new FormulaCompatibilityError(formula, 'dynamic array spill operator (#) is not portable');
  }

  FUNC_CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FUNC_CALL.exec(body)) !== null) {
    const name = m[1]!.toUpperCase();
    if (!ALLOWED.has(name)) {
      throw new FormulaCompatibilityError(formula, `function ${name} is not in the allowed set (${[...ALLOWED].join(', ')})`);
    }
  }
}

/** 写公式的统一入口：先守卫再返回，杜绝绕过。 */
export function formula(f: string): string {
  assertFormulaAllowed(f);
  return f;
}
