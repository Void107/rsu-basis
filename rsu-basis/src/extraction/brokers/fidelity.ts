// ============================================================================
// 券商适配器 · Fidelity（docs/03 §3 要求的注释块）
// ============================================================================
// 版本样本：仅【公开教育材料】——Fidelity Stock Plan Services 报税指南
//           "Filing taxes for your restricted stock, restricted stock units,
//            or performance awards"，版本标识 RS-TAX-PDF-0126（覆盖 2025 税年）。
//           来源 docs/11 §1.1。样本 sha256（已提交 fixture）:
//           72e850004cbf353db42b44e8fc41b1be8bcbba0d0310bf0cc6df99119093c56c
//           ⚠️ 这是【教育指南】，不是真实对账单；其样本表格是【图片】，无文本层。
//
// 补充表位置：指南第 6 页有 "Sample Supplemental Information form"。
//           真实对账单里补充表的【实际起始页码】未知 —— TODO(Gate C)。
//
// 必需列的列头原文（docs/11 §4，作为初始匹配集；真实文档可能改写）：
//   vest date        → "Date Acquired"
//   FMV / 调整后成本  → "Adjusted Cost or Other Basis"   // 每股 or 总额？TODO(Gate C)，靠 C2 判定
//   ordinary income  → "Ordinary Income Reported"
//   股数             → "Quantity"                        // 是 vested / delivered / sold？TODO(Gate C)
//
// 合计锚点（C1，docs/03 §4 最重要的一条）：
//   hasPrintedTotalSupplemental = 'unknown' —— 未验证。公开样本无法确认补充表是否有【印刷合计行】：
//      docs/11 §3 明确把「有没有印刷合计行 (C1 锚点)」列为公开样本【不能】提供、只能靠
//      美国同事结构描述表（docs/06 §3.1 / Gate C，docs/09 §7.4-§7.5）的项。
//   ⛔ 'unknown' 会在 runC1 运行时【硬阻断】（见 src/extraction/c1.ts），错误明确提示
//      「等待结构描述表回填」。不猜、不设替代锚点（需人工决策，CLAUDE.md §5）。
//   ✅ 拿到结构描述表后：若确认有合计行 → 把下面这行改成 'confirmed'；若确认没有 → 'absent'。
//
// 1099-B 主表合计锚点（C8，INDEX.md D16）：
//   hasPrintedTotal1099B = 'unknown' —— 同上，公开样本无法确认 1099-B 主表是否有印刷合计/
//   小计行（Box 1d proceeds / Box 1e cost basis 各自是否有合计）。⏸ 与补充表合计行是
//   【同一个待办】，一起等结构描述表回填。运行时由 runC8 硬阻断。
//
// 已知坑（docs/03 §3 通用 quirk，均待真实文档确认）：
//   - Adjusted Cost 每股 vs 总额（C2 判定）        TODO(Gate C)
//   - 括号负数 (1,234.56)（parseMoney 已处理）      confirmed(归一层)
//   - 分数股 12.3456（parseShares 已处理）          confirmed(归一层)
//   - 跨页 lot 表（表头识别 + joinPageTables）       suspected
//   - CORRECTED 标记（docs/05 F3）                  todo
//   - 多 CUSIP 混排（只取 RSU/RS 行）               todo
// ============================================================================
import { reconstructTable, gridToCandidates, type PageText, type RawFieldCandidate } from '../pdf/index.js';
import type { BrokerAdapter, PageRange, Quirk, SchemaField } from './types.js';

// 列头原文 → schema 字段（docs/11 §4）。TODO 标注见上方注释块，未确认的映射不写死。
const COLUMN_MAP: Record<string, SchemaField> = {
  'Date Acquired': 'vestDate',
  'Ordinary Income Reported': 'ordinaryIncome',
  'Adjusted Cost or Other Basis': 'vestFmv', // TODO(Gate C): 每股 or 总额，靠 C2 判定
  Quantity: 'sharesVested', // TODO(Gate C): 确认 vested / delivered / sold
  // 'Adjusted cost basis' / 'Adjusted gain/loss' 是 Fidelity 已算好的量，
  // 非本工具的提取输入（本工具自己算 basis/调整额）——刻意不映射，避免绕过引擎。
};

const QUIRKS: Quirk[] = [
  { id: 'adjusted-cost-per-share-vs-total', description: 'Adjusted Cost 列可能是总额而非每股', status: 'todo' },
  { id: 'paren-negatives', description: '括号负数由 parseMoney 处理', status: 'confirmed' },
  { id: 'fractional-shares', description: '分数股由 parseShares 保留 4 位', status: 'confirmed' },
  { id: 'cross-page-lot-table', description: '补充表可能跨页，需表头识别 + 拼接', status: 'suspected' },
  { id: 'corrected-marker', description: 'CORRECTED 标记检测（docs/05 F3）', status: 'todo' },
  { id: 'multi-cusip', description: '多 CUSIP 混排，只取 RSU/RS 行', status: 'todo' },
];

const SUPPLEMENTAL_MARKERS = ['supplemental information'];
const BROKER_MARKERS = ['fidelity', 'stock plan services'];

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
const pageText = (p: PageText): string => norm(p.items.map((it) => it.str).join(' '));

export const fidelityAdapter: BrokerAdapter = {
  id: 'fidelity',
  // ⛔ 未验证 → runC1 运行时硬阻断（docs/03 §4）。拿到结构描述表后改这一行：'confirmed' | 'absent'。
  hasPrintedTotalSupplemental: 'unknown',
  // ⛔ 同上，1099-B 主表合计锚点（C8，INDEX.md D16）。同一个待办，一起等结构描述表回填。
  hasPrintedTotal1099B: 'unknown',
  columnMap: COLUMN_MAP,
  quirks: QUIRKS,

  detect(pages: PageText[]): number {
    const all = pages.map(pageText).join(' ');
    const broker = BROKER_MARKERS.some((m) => all.includes(m));
    const supplemental = SUPPLEMENTAL_MARKERS.some((m) => all.includes(m));
    if (broker && supplemental) return 0.9;
    if (broker) return 0.5;
    return 0;
  },

  locateSupplemental(pages: PageText[]): PageRange | null {
    const hit = pages.filter((p) => SUPPLEMENTAL_MARKERS.some((m) => pageText(p).includes(m)));
    if (hit.length === 0) return null;
    // TODO(Gate C): 真实文档里补充表可能跨多页；此处仅取命中页的最小-最大范围。
    const nums = hit.map((p) => p.page).sort((a, b) => a - b);
    return { startPage: nums[0]!, endPage: nums[nums.length - 1]! };
  },

  extract(pages: PageText[], fileHash: string, fileName: string): RawFieldCandidate[] {
    // 用 columnMap 的列头原文作为表头提示（本层不内置券商知识，提示来自适配器）。
    const hints = Object.keys(COLUMN_MAP);
    const out: RawFieldCandidate[] = [];
    for (const page of pages) {
      const grid = reconstructTable(page, hints);
      if (grid) out.push(...gridToCandidates(grid, { fileHash, fileName }));
    }
    return out;
  },
};
