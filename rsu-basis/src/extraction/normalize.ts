// 归一（docs/03 §2「归一」+ §3 quirk 表）。把券商原始字符串转成 Decimal / ISO / Term。
// R2/D2：无法确证地解析 → 返回 null，绝不猜、绝不填默认。
// 用 decimal.js 直接运算，不 import src/engine（保持层独立）。
import Decimal from 'decimal.js';

const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * 金额归一。处理：$ 前缀、千分位逗号、括号负数 `(1,234.56)`（docs/03 §3 quirk）。
 * 无法解析 → null。
 */
export function parseMoney(raw: string): Decimal | null {
  let s = raw.trim();
  if (s === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[$\s]/g, '').replace(/,/g, '');
  if (!NUMERIC.test(s)) return null;
  const d = new Decimal(s);
  return negative ? d.negated() : d;
}

/**
 * 股数归一。千分位逗号，保留分数股 4 位小数（不四舍五入到整数，docs/03 §3 quirk）。
 * 无法解析 → null。
 */
export function parseShares(raw: string): Decimal | null {
  const s = raw.trim().replace(/\s/g, '').replace(/,/g, '');
  if (s === '' || !NUMERIC.test(s)) return null;
  return new Decimal(s);
}

/** 持有期归一（1099-B Box 2 文案 → 'ST' | 'LT'）。识别不了 → null。 */
export function parseTerm(raw: string): 'ST' | 'LT' | null {
  const t = raw.trim().toLowerCase();
  if (t === 'lt' || t.includes('long')) return 'LT';
  if (t === 'st' || t.includes('short')) return 'ST';
  return null;
}

/**
 * 日期归一 → ISO `YYYY-MM-DD`。仅处理无歧义格式：`MM/DD/YYYY`（美式）与已是 ISO 的。
 * 其它格式（如 `Mon DD, YYYY`、两位年份）刻意不猜 → null，由适配器按实际版式扩展（TODO）。
 */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return isValidYmd(+iso[1]!, +iso[2]!, +iso[3]!) ? s : null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) {
    const mm = +us[1]!;
    const dd = +us[2]!;
    const yyyy = +us[3]!;
    if (!isValidYmd(yyyy, mm, dd)) return null;
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  return null;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  return y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}
