// 持有期判定（docs/02 §2.1）。
// 长期的条件是持有【超过】一年，不是满一年：saleDate > vestDate + 1年 → LT。
// 纯字符串日期运算，UTC，不引入 Date 对象、不引入时区（CLAUDE.md R4）。
import type { IsoDate, Term } from './types.js';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(iso: IsoDate): { y: number; m: number; d: number } {
  const match = ISO.exec(iso);
  if (!match) throw new Error(`invalid IsoDate: ${iso}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

/**
 * vestDate 加一年。唯一的边界是闰日：2/29 的下一年必然非闰年，clamp 到 2/28
 * （与 verify.py 的 plus1y 行为一致：连续两年不可能都是闰年）。
 */
export function plusOneYear(iso: IsoDate): IsoDate {
  const { y, m, d } = parse(iso);
  if (m === 2 && d === 29) return `${pad(y + 1, 4)}-02-28`;
  return `${pad(y + 1, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/**
 * ISO 日期是零填充的，字符串字典序等价于时间序，直接比较即可，无需转 Date。
 */
export function classifyHoldingPeriod(vestDate: IsoDate, saleDate: IsoDate): Term {
  return saleDate > plusOneYear(vestDate) ? 'LT' : 'ST';
}
