// 轻量公式求值器（docs/04 §7 第 2 步）。
//
// 关键：它【只看读回来的文件】——单元格的值和公式都取自 exceljs 读回的工作簿，
// 不看生成期的任何中间状态。这样「公式引用行号偏移一行」才会暴露：
// 偏移后的公式在文件里照样能算出一个数，但那个数与引擎的期望值对不上。
//
// 全程用 Decimal 运算，不用 float —— 因此与引擎输出的比对是真正的零容差。
// 支持的语法严格对应 §5 的允许集：SUM / SUMIF / IF / EDATE / ROUND、基本算术、A1 引用。
import Decimal from 'decimal.js';

export type CellValue = Decimal | string | boolean | null;

/** 读回后的工作簿视图：单元格要么是字面值，要么是公式。 */
export interface SheetView {
  /** 'A1' → 字面值（数字用 Decimal，日期用 Excel 序列号 Decimal，文本用 string）。 */
  literals: Map<string, CellValue>;
  /** 'A1' → 公式字符串（不含前导 '='）。 */
  formulas: Map<string, string>;
  maxRow: number;
}
export type WorkbookView = Map<string, SheetView>; // sheetName → SheetView

export class FormulaEvalError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'FormulaEvalError';
  }
}

// —— Excel 日期序列号（1899-12-30 基准，兼容 1900 闰年 bug 的常规做法）——
const EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

export function dateToSerial(d: Date): Decimal {
  return new Decimal(Math.round((d.getTime() - EPOCH_UTC) / MS_PER_DAY));
}
export function serialToParts(serial: Decimal): { y: number; m: number; d: number } {
  const dt = new Date(EPOCH_UTC + serial.toNumber() * MS_PER_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
function partsToSerial(y: number, m: number, d: number): Decimal {
  return new Decimal(Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / MS_PER_DAY));
}
/** EDATE：加 months 个月，日超出目标月天数则 clamp 到月末（Excel 语义）。 */
export function edate(serial: Decimal, months: number): Decimal {
  const { y, m, d } = serialToParts(serial);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const daysInMonth = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return partsToSerial(ny, nm, Math.min(d, daysInMonth));
}

// —— 词法 ——
type Tok =
  | { t: 'num'; v: Decimal }
  | { t: 'str'; v: string }
  | { t: 'ref'; sheet: string | null; a: string; b: string | null } // b != null → 区间
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' };

const CELL = String.raw`\$?[A-Za-z]{1,3}\$?\d+`;
const COL = String.raw`\$?[A-Za-z]{1,3}`;
const SHEET = String.raw`(?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)`;
const REF_RE = new RegExp(
  String.raw`^(?:(${SHEET})!)?(?:(${CELL}):(${CELL})|(${COL}):(${COL})|(${CELL}))`,
);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') { s += '"'; j += 2; continue; }
          break;
        }
        s += src[j]!; j++;
      }
      if (src[j] !== '"') throw new FormulaEvalError(`unterminated string in: ${src}`);
      out.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    if (c === '(') { out.push({ t: 'lp' }); i++; continue; }
    if (c === ')') { out.push({ t: 'rp' }); i++; continue; }
    if (c === ',') { out.push({ t: 'comma' }); i++; continue; }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: new Decimal(m[0]) }); i += m[0].length; continue;
    }
    // 引用或函数名
    const rest = src.slice(i);
    const rm = REF_RE.exec(rest);
    if (rm && !/^\s*\(/.test(rest.slice(rm[0].length))) {
      const sheetRaw = rm[1] ?? null;
      const sheet = sheetRaw ? sheetRaw.replace(/^'|'$/g, '') : null;
      if (rm[2] && rm[3]) out.push({ t: 'ref', sheet, a: rm[2].replace(/\$/g, ''), b: rm[3].replace(/\$/g, '') });
      else if (rm[4] && rm[5]) out.push({ t: 'ref', sheet, a: rm[4].replace(/\$/g, '') + ':COL', b: rm[5].replace(/\$/g, '') + ':COL' });
      else out.push({ t: 'ref', sheet, a: rm[6]!.replace(/\$/g, ''), b: null });
      i += rm[0].length; continue;
    }
    const im = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
    if (im) { out.push({ t: 'id', v: im[0].toUpperCase() }); i += im[0].length; continue; }
    throw new FormulaEvalError(`unexpected character '${c}' in: ${src}`);
  }
  return out;
}

// —— 求值上下文 ——
interface Ctx {
  wb: WorkbookView;
  sheet: string; // 当前 sheet（无限定引用的归属）
  memo: Map<string, CellValue>;
  stack: Set<string>;
}

const colToNum = (col: string): number => {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
const numToCol = (n: number): string => {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
const splitRef = (a1: string): { col: string; row: number } => {
  const m = /^([A-Za-z]{1,3})(\d+)$/.exec(a1);
  if (!m) throw new FormulaEvalError(`bad cell ref: ${a1}`);
  return { col: m[1]!.toUpperCase(), row: Number(m[2]) };
};

/** 取一个单元格的值（字面值或递归求值其公式）。 */
function cellValue(ctx: Ctx, sheetName: string, a1: string): CellValue {
  const key = `${sheetName}!${a1}`;
  if (ctx.memo.has(key)) return ctx.memo.get(key)!;
  if (ctx.stack.has(key)) throw new FormulaEvalError(`circular reference at ${key}`);
  const sheet = ctx.wb.get(sheetName);
  if (!sheet) throw new FormulaEvalError(`unknown sheet: ${sheetName}`);

  let val: CellValue;
  const f = sheet.formulas.get(a1);
  if (f !== undefined) {
    ctx.stack.add(key);
    val = evaluateFormula(f, ctx.wb, sheetName, ctx.memo, ctx.stack);
    ctx.stack.delete(key);
  } else {
    val = sheet.literals.get(a1) ?? null;
  }
  ctx.memo.set(key, val);
  return val;
}

/** 展开区间为单元格值数组。 */
function rangeValues(ctx: Ctx, tok: Extract<Tok, { t: 'ref' }>): CellValue[] {
  const sheetName = tok.sheet ?? ctx.sheet;
  const sheet = ctx.wb.get(sheetName);
  if (!sheet) throw new FormulaEvalError(`unknown sheet: ${sheetName}`);
  const out: CellValue[] = [];

  if (tok.a.endsWith(':COL')) {
    // 整列引用 A:A —— 扫到该 sheet 的 maxRow
    const c1 = colToNum(tok.a.slice(0, -4));
    const c2 = colToNum(tok.b!.slice(0, -4));
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      for (let r = 1; r <= sheet.maxRow; r++) out.push(cellValue(ctx, sheetName, `${numToCol(c)}${r}`));
    }
    return out;
  }
  const A = splitRef(tok.a);
  const B = splitRef(tok.b!);
  const ca = colToNum(A.col);
  const cb = colToNum(B.col);
  const c1 = Math.min(ca, cb);
  const c2 = Math.max(ca, cb);
  const r1 = Math.min(A.row, B.row);
  const r2 = Math.max(A.row, B.row);
  for (let c = c1; c <= c2; c++) for (let r = r1; r <= r2; r++) out.push(cellValue(ctx, sheetName, `${numToCol(c)}${r}`));
  return out;
}

const toNum = (v: CellValue): Decimal => {
  if (v instanceof Decimal) return v;
  if (v === null || v === '') return new Decimal(0);
  if (typeof v === 'boolean') return new Decimal(v ? 1 : 0);
  const d = new Decimal(String(v));
  if (d.isNaN()) throw new FormulaEvalError(`cannot coerce to number: ${String(v)}`);
  return d;
};

// —— 语法分析 + 求值（递归下降）——
function evaluateFormula(
  src: string,
  wb: WorkbookView,
  sheet: string,
  memo: Map<string, CellValue>,
  stack: Set<string>,
): CellValue {
  const ctx: Ctx = { wb, sheet, memo, stack };
  const toks = tokenize(src.replace(/^=/, ''));
  let p = 0;
  const peek = () => toks[p];
  const eat = () => toks[p++];

  function parseExpr(): CellValue {
    let left = parseAdd();
    const t = peek();
    if (t && t.t === 'op' && ['=', '<>', '>', '<', '>=', '<='].includes(t.v)) {
      eat();
      const right = parseAdd();
      const cmp = compare(left, right);
      switch (t.v) {
        case '=': return cmp === 0;
        case '<>': return cmp !== 0;
        case '>': return cmp > 0;
        case '<': return cmp < 0;
        case '>=': return cmp >= 0;
        case '<=': return cmp <= 0;
      }
    }
    return left;
  }
  function compare(a: CellValue, b: CellValue): number {
    if (typeof a === 'string' || typeof b === 'string') {
      const sa = a === null ? '' : typeof a === 'boolean' ? String(a) : a instanceof Decimal ? a.toString() : a;
      const sb = b === null ? '' : typeof b === 'boolean' ? String(b) : b instanceof Decimal ? b.toString() : b;
      return sa === sb ? 0 : sa < sb ? -1 : 1;
    }
    return toNum(a).comparedTo(toNum(b));
  }
  function parseAdd(): CellValue {
    let v = parseMul();
    for (;;) {
      const t = peek();
      if (t && t.t === 'op' && (t.v === '+' || t.v === '-')) {
        eat();
        const r = parseMul();
        v = t.v === '+' ? toNum(v).add(toNum(r)) : toNum(v).sub(toNum(r));
      } else return v;
    }
  }
  function parseMul(): CellValue {
    let v = parseUnary();
    for (;;) {
      const t = peek();
      if (t && t.t === 'op' && (t.v === '*' || t.v === '/')) {
        eat();
        const r = parseUnary();
        if (t.v === '*') v = toNum(v).mul(toNum(r));
        else {
          const d = toNum(r);
          if (d.isZero()) throw new FormulaEvalError('#DIV/0!');
          v = toNum(v).div(d);
        }
      } else return v;
    }
  }
  function parseUnary(): CellValue {
    const t = peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
      eat();
      const v = parseUnary();
      return t.v === '-' ? toNum(v).negated() : toNum(v);
    }
    return parsePrimary();
  }
  function parsePrimary(): CellValue {
    const t = eat();
    if (!t) throw new FormulaEvalError(`unexpected end of formula: ${src}`);
    if (t.t === 'num') return t.v;
    if (t.t === 'str') return t.v;
    if (t.t === 'lp') { const v = parseExpr(); const r = eat(); if (!r || r.t !== 'rp') throw new FormulaEvalError('missing )'); return v; }
    if (t.t === 'ref') {
      if (t.b !== null) throw new FormulaEvalError('range used outside a function');
      return cellValue(ctx, t.sheet ?? ctx.sheet, t.a);
    }
    if (t.t === 'id') return callFunction(t.v);
    throw new FormulaEvalError(`unexpected token in: ${src}`);
  }

  function parseArgs(): { values: CellValue[]; ranges: (Extract<Tok, { t: 'ref' }> | null)[] } {
    const lp = eat();
    if (!lp || lp.t !== 'lp') throw new FormulaEvalError('expected (');
    const values: CellValue[] = [];
    const ranges: (Extract<Tok, { t: 'ref' }> | null)[] = [];
    if (peek()?.t === 'rp') { eat(); return { values, ranges }; }
    for (;;) {
      const t = peek();
      if (t && t.t === 'ref' && t.b !== null) { eat(); ranges.push(t); values.push(null); }
      else { ranges.push(null); values.push(parseExpr()); }
      const n = eat();
      if (!n) throw new FormulaEvalError('missing )');
      if (n.t === 'rp') break;
      if (n.t !== 'comma') throw new FormulaEvalError('expected , or )');
    }
    return { values, ranges };
  }

  function callFunction(name: string): CellValue {
    // IF 需要惰性求值分支，单独处理
    if (name === 'IF') {
      const lp = eat();
      if (!lp || lp.t !== 'lp') throw new FormulaEvalError('expected (');
      const cond = parseExpr();
      if (eat()?.t !== 'comma') throw new FormulaEvalError('IF expects 3 args');
      const a = parseExpr();
      const nx = eat();
      let b: CellValue = false;
      if (nx && nx.t === 'comma') { b = parseExpr(); if (eat()?.t !== 'rp') throw new FormulaEvalError('missing )'); }
      else if (!nx || nx.t !== 'rp') throw new FormulaEvalError('missing )');
      const truthy = typeof cond === 'boolean' ? cond : cond instanceof Decimal ? !cond.isZero() : cond !== '' && cond !== null;
      return truthy ? a : b;
    }

    const { values, ranges } = parseArgs();
    const flat = (i: number): CellValue[] => (ranges[i] ? rangeValues(ctx, ranges[i]!) : [values[i] ?? null]);

    switch (name) {
      case 'SUM': {
        let s = new Decimal(0);
        for (let i = 0; i < values.length; i++) {
          for (const v of flat(i)) {
            if (v === null || v === '' || typeof v === 'string' || typeof v === 'boolean') continue; // SUM 忽略文本
            s = s.add(toNum(v));
          }
        }
        return s;
      }
      case 'SUMIF': {
        const range = ranges[0] ? rangeValues(ctx, ranges[0]) : [values[0] ?? null];
        const criterion = values[1];
        const sumRange = ranges[2] ? rangeValues(ctx, ranges[2]) : range;
        let s = new Decimal(0);
        for (let i = 0; i < range.length; i++) {
          if (matchCriterion(range[i] ?? null, criterion ?? null) && i < sumRange.length) {
            const v = sumRange[i]!;
            if (v === null || v === '' || typeof v === 'string' || typeof v === 'boolean') continue;
            s = s.add(toNum(v));
          }
        }
        return s;
      }
      case 'ROUND': {
        const v = toNum(values[0] ?? null);
        const digits = toNum(values[1] ?? new Decimal(0)).toNumber();
        return v.toDecimalPlaces(digits, Decimal.ROUND_HALF_UP);
      }
      case 'EDATE': {
        const serial = toNum(values[0] ?? null);
        const months = toNum(values[1] ?? new Decimal(0)).toNumber();
        return edate(serial, months);
      }
      default:
        throw new FormulaEvalError(`unsupported function: ${name}`);
    }
  }

  function matchCriterion(cell: CellValue, criterion: CellValue): boolean {
    if (typeof criterion === 'string') {
      const op = /^(>=|<=|<>|>|<|=)(.*)$/.exec(criterion);
      if (op) {
        const rhsRaw = op[2]!.trim();
        const rhs: CellValue = /^-?\d*\.?\d+$/.test(rhsRaw) ? new Decimal(rhsRaw) : rhsRaw;
        const c = compare(cell, rhs);
        switch (op[1]) {
          case '>': return c > 0;
          case '<': return c < 0;
          case '>=': return c >= 0;
          case '<=': return c <= 0;
          case '<>': return c !== 0;
          case '=': return c === 0;
        }
      }
      const s = cell === null ? '' : cell instanceof Decimal ? cell.toString() : String(cell);
      return s === criterion;
    }
    return compare(cell, criterion ?? null) === 0;
  }

  const result = parseExpr();
  if (p !== toks.length) throw new FormulaEvalError(`trailing tokens in: ${src}`);
  return result;
}

/** 对外入口：求某个 sheet 上一条公式的值。 */
export function evaluate(src: string, wb: WorkbookView, sheet: string): CellValue {
  return evaluateFormula(src, wb, sheet, new Map(), new Set());
}

/** 对外入口：求某个单元格的值（字面值或公式）。 */
export function evaluateCell(wb: WorkbookView, sheet: string, a1: string): CellValue {
  const ctx: Ctx = { wb, sheet, memo: new Map(), stack: new Set() };
  return cellValue(ctx, sheet, a1);
}
