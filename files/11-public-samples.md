# 11 — 公开样本清单

给无法拿到真实 1099-B / Supplemental Information 的开发者。这些是公开的教育材料与官方表格，**用假数据填充**，可以合法自由使用。

已实际访问验证（2026-08）。链接可能变动，失效时按「怎么找」一列重搜。

---

## 1. 第一梯队：券商教育材料（版式来源）

### 1.1 Fidelity — Stock Plan Services 报税指南 ⭐ 最有价值

```
https://workplaceservices.fidelity.com/bin-public/070_NB_SPS_Pages/documents/dcl/shared/StockPlanServices/SPS_TaxGuide_RS_PA.pdf
```

标题：*Filing taxes for your restricted stock, restricted stock units, or performance awards*
版本标识：`RS-TAX-PDF-0126`（2026 年 1 月版，覆盖 2025 税年）

**为什么这份最有用**：它是唯一一份同时包含全套样本表格的公开文档：

| 页 | 内容 |
|---|---|
| 3 | Sample W-2，标注 Box 1/3/5、Box 2/4/6、**Box 14**、Box 16/18、Box 17/19 各自含义 |
| 5 | **Sample Form 1099-B**，标注长短期指示位、Cost or other basis、Gain/loss |
| 6 | **Sample Supplemental Information form**，标注 Adjusted cost basis、Adjusted gain/loss |
| 8–9 | Example Form 8949（短期 / 长期各一） |
| 10–11 | Example Schedule D（短期 / 长期各一） |

**从中直接确认的事实**（可写进适配器注释）：

- 该表的正式名称就是 **Supplemental Information form**，由 Fidelity 自己制作
- **明确说明其内容不报送 IRS**
- **调整后成本基础的定义是加法式的**：`归属时的普通所得 + 1099-B 上的成本基础`。注意这不等同于 `股数 × vest FMV`——当 1099-B 报的不是 $0 时两者不同。见 §5.1
- 明确说明 RSU 的成本基础在 1099-B 上常显示为 $0 或空白，因为 IRS 规则禁止券商报告这类补偿的完整基础
- **明确说明报税软件不会自动导入这份补充表，必须手工录入**——这是产品论证的直接证据

### 1.2 Schwab — Equity Award Center 教育页

```
https://eac.schwab.com/equity101/cost-basis
https://eac.schwab.com/equity101/restricted-stock
https://www.schwab.com/learn/story/rsu-taxes-and-psu-taxes
```

不是 PDF 样本，但有几条有用的确认：

- 成本基础定义为公司在归属时赋予股票的公允市值
- **Equity Award Center 账户的交易与其他 Schwab 账户是分开的，可能需要手工录入**——又一条独立佐证
- 有一个 RSU 触发 wash sale 的完整例子：亏损卖出后 30 天内有 vest，损失被 disallow。这印证了 `docs/01` §1 把 wash sale 排除在 V1 之外的判断，也说明它真实存在

**对你个人有用的一条**：Schwab 提到面向非美国居民有 *Global Tax Guide*，需登录 Equity Award Center 获取。如果你的 RSU 走 Schwab，这份指南会讲你自己辖区的处理。

### 1.3 其他券商

用这个模式搜：`"<券商名> stock plan tax guide RSU supplemental"` 或 `"<券商名> how to read your 1099"`。

E\*TRADE / Morgan Stanley at Work、Shareworks、Carta 都有类似材料，质量参差。**优先找带 "Sample" 或 "Example" 字样的 PDF**，网页版通常只有文字没有版式。

---

## 2. 第二梯队：IRS 官方表格（字段定义来源）

这些是权威的字段定义与 box 编号，**必须以它们为准**，券商材料只是版式参考。

| 表格 | 地址 | 用途 |
|---|---|---|
| Form 8949 空白表 | `https://www.irs.gov/pub/irs-pdf/f8949.pdf` | 列 (a)–(h) 的确切定义、Box A–L 的勾选规则 |
| Form 8949 说明 | `https://www.irs.gov/pub/irs-pdf/i8949.pdf`<br>`https://www.irs.gov/instructions/i8949` | **调整代码全表**、Worksheet for Basis Adjustments、示例 |
| Form 1099-B 说明 | `https://www.irs.gov/instructions/i1099b` | 各 box 的报告规则，covered security 定义 |
| §7216 信息中心 | `https://www.irs.gov/tax-professionals/section-7216-information-center` | `docs/07` 的一手来源 |
| Rev. Proc. 2013-14 | `https://www.irs.gov/pub/irs-drop/rp-13-14.pdf` | 同意书的规定格式与开头语原文 |

---

## 3. 这些能给你什么 / 不能给你什么

| 能 | 不能 |
|---|---|
| 字段定义与 box 编号（权威） | 补充表在真实 PDF 里的页码位置 |
| 列头原文与版式布局 | 跨页表格的断行方式 |
| 各券商的术语差异 | 修正版（CORRECTED）的标记形态 |
| 8949 各列的填法与代码 | 多 CUSIP 混排的实际样子 |
| 计算逻辑的官方确认 | 文本层质量 / 是否扫描件 |
| | **有没有印刷合计行**（C1 锚点） |

右列全部是 `docs/09` §7.4 的 Gate C，**只能靠符合美国税务适用范围的测试用户的结构描述表**（`docs/06` §3.1）。

---

## 4. 已确认的列头原文

从上述来源汇总，写适配器时先匹配这些字符串：

**Supplemental Information 表**
```
Adjusted cost basis
Adjusted gain/loss
Ordinary Income Reported
Adjusted Cost or Other Basis
Date Acquired
Quantity
```

**Form 1099-B**
```
1a  Description of property
1b  Date acquired
1c  Date sold or disposed
1d  Proceeds
1e  Cost or other basis
2   Short-term / Long-term
5   Noncovered security
12  Basis reported to IRS        ← 见 §5.2，这个 box 决定输出形态
```

**W-2**
```
Box 1   Wages, tips, other compensation
Box 14  Other                     ← RSU 金额可能在这，标签各公司不一
```

各券商会改写这些标签，**照抄你实际看到的原文**，不要规范化。

---

## 5. 由公开样本发现的规格修正

查阅官方材料时发现了两处原规格的问题。已改正，此处记录来由。

### 5.1 调整后基础的定义是加法式的

Fidelity 的定义是：

```
调整后成本基础 = 归属时的普通所得 + 1099-B 上报的成本基础
```

而 `docs/02` 原来写的是 `股数 × vest FMV`。

当 1099-B 报 $0 时两者相同，这是 RSU 的绝大多数情形。但**当券商报了非零基础时（例如部分券商对某些批次会报出佣金），加法式才是对的**。

`docs/02` 已改为加法式，并把 `股数 × vest FMV` 降级为一致性校验而非计算式。

### 5.2 Box 归属取决于「基础是否报送 IRS」，不是 `covered` ⚠️

这是更严重的一处。原规格用 `covered` 决定 box，实际规则是：

| 1099-B 上基础是否报送 IRS | 短期 box | 长期 box | 怎么填 |
|---|---|---|---|
| **是**（含报了 $0） | A | D | (e) 填 1099-B 原值 → (f) 填代码 `B` → (g) 填调整额 |
| **否** | B | E | **(e) 直接填正确基础，不用代码 B，(g) 留空** |
| 根本没收到 1099-B | C | F | 直接填正确基础 |

IRS 说明里的原话是：如果勾了 Box A 或 D 但报送给 IRS 的基础不正确，在 (e) 列填报送给 IRS 的基础，在 (g) 列填调整额。

**两种情形的输出形态完全不同**，不是同一套行加个标记。原规格只实现了第一种。

`covered` 与「基础是否报送」高度相关但不等同——判断依据是 1099-B 的 **Box 12** 勾选状态，必须从表上读，不能推断。schema 已新增 `basisReportedToIRS` 字段。

### 5.3 带代码 B 的行不能汇总申报

Schedule D 允许把某些交易汇总成一行，但**带调整代码的行必须逐笔列示在 8949 上**——IRS 需要看到调整过程，汇总行无法编码「这个基础是错的」。

`docs/04` 的 8949 sheet 因此必须逐行输出，不得提供「合并同类项」选项。

### 5.4 未来范围：代码组合 BW

如果同一批股票既需要基础调整、又构成 wash sale（亏损卖出后 30 天内有 vest），代码是 `BW` 而非单个 `B`。

V1 已把 wash sale 排除（`docs/01` §1），此处仅记录，供 V2 参考。

---

## 6. 使用建议

1. **先通读 Fidelity 那份 PDF**，它是理解整个文档链条最快的路径，比任何二手文章都清楚
2. 把 §4 的列头原文抄进适配器注释，作为初始匹配集
3. 用 IRS 的 f8949.pdf 逐列核对 `docs/01` §6 的 `Form8949Row` 定义
4. **不要把这些样本当作 golden case**——它们没有完整的、可验算的数据集。golden 用 `test/golden/` 里的合成案例
5. 每个税年重新下载一次券商指南，版式会改
