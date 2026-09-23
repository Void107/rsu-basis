// C9 逐字符回比（verbatim transcription check）—— 立即生效，不依赖 Gate C。
//
// 机制：任何进入 schema 的字段，其【归一后的值】必须能由 SourceRef.rawText
// 逐字符复现——即 parse(rawText) 必须存在且等于该值。
//
// 这【不是】跨源锚定（那是 C1/C8 的事），它挡的是【解析层读错】：
// 日期错一天、金额读错一位、列错位后取到别的单元格——注入测试模拟的正是这些。
// 文档本身写错（需要独立第二来源才能发现）不在 C9 覆盖范围内，由 C1/C5/C8 负责。
//
// 附加约束（docs/03 §5 + 本轮决策 D15）：这些字段的 method 只能是 'rule' / 'manual'，
// 不接受 'llm' 推断值——推断值无法逐字符回比，等于绕过本条校验。
import Decimal from 'decimal.js';
import type { CheckResult } from './errors.js';
import { parseMoney, parseShares, parseDate } from './normalize.js';

export type C9Kind = 'date' | 'money' | 'shares';

export interface C9Field {
  rowIndex: number;
  fieldName: string;
  /** 文档上的原始字符串（SourceRef.rawText），未经归一。 */
  rawText: string;
  /** 归一后进入 schema 的值：date → ISO 字符串；money/shares → Decimal。 */
  value: string | Decimal;
  kind: C9Kind;
  method: 'rule' | 'manual' | 'llm';
}

function reparse(kind: C9Kind, rawText: string): string | Decimal | null {
  switch (kind) {
    case 'date':
      return parseDate(rawText);
    case 'money':
      return parseMoney(rawText);
    case 'shares':
      return parseShares(rawText);
  }
}

function sameValue(a: string | Decimal, b: string | Decimal): boolean {
  if (a instanceof Decimal || b instanceof Decimal) {
    if (!(a instanceof Decimal) || !(b instanceof Decimal)) return false;
    return a.equals(b);
  }
  return a === b;
}

/**
 * 对一组字段做逐字符回比。任何一个字段回比失败 → HARD 阻断（F22）。
 * 空数组 → skip（没有可回比的字段说明调用方没接上，不当作通过）。
 */
export function checkC9(fields: C9Field[]): CheckResult {
  if (fields.length === 0) {
    return {
      check: 'C9',
      status: 'skip',
      level: 'HARD',
      detail: 'C9: no fields supplied for verbatim re-comparison',
    };
  }

  for (const f of fields) {
    if (f.method === 'llm') {
      return {
        check: 'C9',
        status: 'fail',
        level: 'HARD',
        failurePath: 'F22',
        userMessage:
          '这份文档里有字段是由模型推断得出的，而不是从原文逐字读取的。为保证每个数字都能回溯到原文，我们不接受推断值。请改用手工补录。',
        detail: `C9: row ${f.rowIndex} field ${f.fieldName} has method='llm' (inference not allowed)`,
      };
    }

    const reparsed = reparse(f.kind, f.rawText);
    if (reparsed === null) {
      return {
        check: 'C9',
        status: 'fail',
        level: 'HARD',
        failurePath: 'F22',
        userMessage:
          '有一处数据无法与文档原文对上：我们读到的原始文字无法按预期格式解析。请对照原始文档核对该处，或手工补录。',
        detail: `C9: row ${f.rowIndex} field ${f.fieldName} rawText not parseable as ${f.kind}`,
      };
    }

    if (!sameValue(reparsed, f.value)) {
      return {
        check: 'C9',
        status: 'fail',
        level: 'HARD',
        failurePath: 'F22',
        userMessage:
          '有一处数据与文档原文对不上：我们解析出的数值无法由原文逐字复现。这通常意味着读错了行、读错了列或读错了一位数字。请对照原始文档核对该处，或手工补录。',
        detail: `C9: row ${f.rowIndex} field ${f.fieldName} value does not round-trip from rawText`,
      };
    }
  }

  return { check: 'C9', status: 'pass', level: 'HARD' };
}
