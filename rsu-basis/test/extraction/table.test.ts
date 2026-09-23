// 表格重建单元测试（docs/03 §2）。用手工构造的文本项，精确锁住聚类/列带/候选逻辑，
// 不依赖真实 PDF（真实 PDF 见 smoke.test.ts）。
import { describe, it, expect } from 'vitest';
import {
  clusterRows,
  reconstructTable,
  gridToCandidates,
  joinPageTables,
  type PageText,
  type TextItem,
} from '../../src/extraction/pdf/index.js';

const ti = (str: string, x: number, y: number, width: number, height = 10): TextItem => ({ str, x, y, width, height });

// 三列表：Date Acquired(左对齐) | Quantity(右对齐) | Ordinary Income Reported(右对齐)
function samplePage(): PageText {
  return {
    page: 1,
    width: 612,
    height: 792,
    items: [
      // 表头 y=700
      ti('Date Acquired', 50, 700, 70),
      ti('Quantity', 200, 700, 50),
      ti('Ordinary Income Reported', 350, 700, 140),
      // 数据行1 y=680（数字右对齐，中心落在各自列带）
      ti('2024-02-15', 50, 680, 60),
      ti('100', 230, 680, 20),
      ti('5,000.00', 400, 680, 45),
      // 数据行2 y=660
      ti('2024-05-15', 50, 660, 60),
      ti('60', 235, 660, 15),
      ti('3,720.00', 400, 660, 45),
      // 脚注 y=620（只落一列 → 应被 ≥2 列过滤掉）
      ti('See reverse for details', 50, 620, 120),
    ],
  };
}

describe('clusterRows', () => {
  it('按 y 聚类，容差 2pt 内同行，行内按 x 升序', () => {
    const rows = clusterRows([
      ti('b', 200, 500, 10),
      ti('a', 50, 501, 10), // 与上一项 y 差 1pt → 同行
      ti('c', 100, 495, 10), // 差 6pt → 另一行
    ]);
    expect(rows.length).toBe(2);
    expect(rows[0]!.map((i) => i.str)).toEqual(['a', 'b']); // 行内 x 升序
    expect(rows[1]!.map((i) => i.str)).toEqual(['c']);
  });

  it('空输入 → 空', () => {
    expect(clusterRows([])).toEqual([]);
  });
});

describe('reconstructTable', () => {
  it('用表头定义列，数据按列带（区间包含）归位；脚注行被过滤', () => {
    const grid = reconstructTable(samplePage(), ['Date Acquired', 'Quantity', 'Ordinary Income Reported']);
    expect(grid).not.toBeNull();
    expect(grid!.columns.map((c) => c.label)).toEqual(['Date Acquired', 'Quantity', 'Ordinary Income Reported']);
    expect(grid!.rows.length).toBe(2); // 脚注行（单列）被剔除
    expect(grid!.rows[0]!.cells.map((c) => c?.text ?? null)).toEqual(['2024-02-15', '100', '5,000.00']);
    expect(grid!.rows[1]!.cells.map((c) => c?.text ?? null)).toEqual(['2024-05-15', '60', '3,720.00']);
    expect(grid!.rows[0]!.rowIndex).toBe(0);
    expect(grid!.rows[1]!.rowIndex).toBe(1);
  });

  it('表头提示不足（不成表：<2 列）→ 返回 null，不猜', () => {
    expect(reconstructTable(samplePage(), ['No Such Column', 'Another Missing'])).toBeNull();
    expect(reconstructTable(samplePage(), ['Date Acquired'])).toBeNull(); // 单列不成表
  });

  it('表头匹配大小写/空白不敏感（原文照抄进 label）', () => {
    const grid = reconstructTable(samplePage(), ['date acquired', 'ORDINARY INCOME REPORTED']);
    expect(grid).not.toBeNull();
    // label 是表头单元格原文，不是 hint
    expect(grid!.columns.map((c) => c.label)).toEqual(['Date Acquired', 'Ordinary Income Reported']);
  });
});

describe('gridToCandidates', () => {
  it('确定性顺序（行↓列→），空单元格跳过，method=rule/confidence=1', () => {
    const grid = reconstructTable(samplePage(), ['Date Acquired', 'Quantity', 'Ordinary Income Reported'])!;
    const cands = gridToCandidates(grid, { fileHash: 'h', fileName: 'f.pdf' });
    expect(cands.length).toBe(6); // 2 行 × 3 列
    expect(cands[0]).toMatchObject({ columnLabel: 'Date Acquired', rawText: '2024-02-15' });
    expect(cands[1]).toMatchObject({ columnLabel: 'Quantity', rawText: '100' });
    expect(cands[2]).toMatchObject({ columnLabel: 'Ordinary Income Reported', rawText: '5,000.00' });
    expect(cands[3]).toMatchObject({ columnLabel: 'Date Acquired', rawText: '2024-05-15' });
    for (const c of cands) {
      expect(c.confidence).toBe(1);
      expect(c.source.method).toBe('rule');
      expect(c.source.fileHash).toBe('h');
      expect(c.source.rawText).toBe(c.rawText);
    }
  });

  it('两次重建 + 转候选 深度相等（确定性，docs/03 §6）', () => {
    const a = gridToCandidates(reconstructTable(samplePage(), ['Date Acquired', 'Quantity', 'Ordinary Income Reported'])!, { fileHash: 'h', fileName: 'f' });
    const b = gridToCandidates(reconstructTable(samplePage(), ['Date Acquired', 'Quantity', 'Ordinary Income Reported'])!, { fileHash: 'h', fileName: 'f' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('joinPageTables', () => {
  it('列一致 → 行连续拼接并重编号', () => {
    const g1 = reconstructTable(samplePage(), ['Date Acquired', 'Quantity', 'Ordinary Income Reported'])!;
    const g2 = reconstructTable({ ...samplePage(), page: 2 }, ['Date Acquired', 'Quantity', 'Ordinary Income Reported'])!;
    const joined = joinPageTables([g1, g2])!;
    expect(joined.rows.length).toBe(4);
    expect(joined.rows.map((r) => r.rowIndex)).toEqual([0, 1, 2, 3]);
  });

  it('列不一致 → 抛错，不静默丢数据', () => {
    const g1 = reconstructTable(samplePage(), ['Date Acquired', 'Quantity', 'Ordinary Income Reported'])!;
    const g2 = reconstructTable(samplePage(), ['Date Acquired', 'Quantity'])!;
    expect(() => joinPageTables([g1, g2])).toThrow();
  });
});
