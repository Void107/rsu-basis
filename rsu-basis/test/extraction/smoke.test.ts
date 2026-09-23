// 冒烟测试：用 docs/11 §1.1 的公开样本（Fidelity SPS Tax Guide，假数据）跑通整条解析基建。
// 该 PDF 已作为离线 fixture 提交，测试不触网（R8）。
//
// 断言：sha256 稳定且已知、文本层抽取有内容、非扫描件、两次解析字节级一致（docs/03 §6）、
// extractCandidates 确定性。不断言具体字段——那是券商适配器的事（本层不做适配器）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, parsePdf, extractPages, detectScanned, extractCandidates } from '../../src/extraction/pdf/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'fixtures', 'fidelity-sps-taxguide.pdf');
const KNOWN_SHA256 = '72e850004cbf353db42b44e8fc41b1be8bcbba0d0310bf0cc6df99119093c56c';

const bytes = (): Uint8Array => new Uint8Array(readFileSync(FIXTURE));

describe('smoke: Fidelity public sample PDF', () => {
  it('sha256 稳定且等于已知值', () => {
    expect(sha256(bytes())).toBe(KNOWN_SHA256);
    expect(sha256(bytes())).toBe(sha256(bytes()));
  });

  it('pdfjs 文本层抽取出带坐标的文本项，判为非扫描件', { timeout: 30000 }, async () => {
    const pages = await extractPages(bytes());
    expect(pages.length).toBeGreaterThan(0);
    const total = pages.reduce((n, p) => n + p.items.length, 0);
    expect(total).toBeGreaterThan(50);
    // 坐标存在
    const first = pages.flatMap((p) => p.items)[0]!;
    expect(typeof first.x).toBe('number');
    expect(typeof first.y).toBe('number');
    const scan = detectScanned(pages);
    expect(scan.isScanned).toBe(false);
    expect(scan.textPageCount).toBeGreaterThan(0);
  });

  it('同一文件解析两次 → 字节级一致（docs/03 §6）', { timeout: 30000 }, async () => {
    const a = await parsePdf(bytes(), 'fidelity.pdf');
    const b = await parsePdf(bytes(), 'fidelity.pdf');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('extractCandidates（给定 Supplemental 表头提示）确定、非扫描件；候选确定性', { timeout: 30000 }, async () => {
    // docs/11 §4 的补充表列头原文（本层不内置券商知识，提示由调用方给出）。
    const hints = [
      'Adjusted Cost or Other Basis',
      'Ordinary Income Reported',
      'Date Acquired',
      'Quantity',
      'Adjusted cost basis',
      'Adjusted gain/loss',
    ];
    const a = await extractCandidates(bytes(), 'fidelity.pdf', hints);
    const b = await extractCandidates(bytes(), 'fidelity.pdf', hints);
    expect(a.unsupported).toBeNull();
    // 样本表可能是图片，候选数可能为 0——不强求命中；但必须确定性一致。
    expect(JSON.stringify(a.candidates)).toBe(JSON.stringify(b.candidates));
    for (const c of a.candidates) {
      expect(c.confidence).toBe(1);
      expect(c.source.method).toBe('rule');
      expect(c.source.fileHash).toBe(KNOWN_SHA256);
    }
  });
});
