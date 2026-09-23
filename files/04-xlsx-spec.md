# 04 — xlsx 输出规格

`src/output/xlsx/`，用 `exceljs`。

这份 xlsx 是产品的最终交付物，同时也是跨年状态文件。它要能被三类人打开：用户自己、用户的 CPA、以及明年的这个工具。

---

## 1. 设计原则

**公式是活的，不是烘死的值。** 每一个计算格都写成引用其他格的 Excel 公式，而不是引擎算好的数字。

这不是为了让用户改数，是为了**可审计**：CPA 点开任意一格，能看到它从哪来。烘死的值是一个需要被信任的黑箱；活公式是一份可以被检查的推导。

代价是引擎要输出两份东西：数值（用于校验）和公式字符串（用于写入）。生成后必须用 `exceljs` 读回并验证公式计算结果与引擎数值一致（见 §7）。

---

## 2. Sheet 结构

| # | 名称 | 作用 | 可见 |
|---|---|---|---|
| 1 | `Summary` | 结论页：调整总额、按 term 分组、估算多缴 | ✅ |
| 2 | `8949` | 可直接誊抄的 Form 8949 行 | ✅ |
| 3 | `Lots` | vest lot 台账 | ✅ |
| 4 | `Sales` | 1099-B 卖出明细（原样） | ✅ |
| 5 | `Matching` | lot ↔ sale 匹配矩阵与 basis 推导 | ✅ |
| 6 | `Sources` | 每个数字的来源：文件、页码、行、原始字符串 | ✅ |
| 7 | `Checks` | 7 条不变量 + 7 条交叉校验的执行结果 | ✅ |
| 8 | `_ledger` | schema JSON，跨年读回用 | 隐藏 |

### 2.1 Summary

顶部三行是给人看的结论，其余是引用：

```
B2  调整总额          =SUM(Matching!H:H)
B3  短期调整          =SUMIF(Matching!I:I,"ST",Matching!H:H)
B4  长期调整          =SUMIF(Matching!I:I,"LT",Matching!H:H)
B6  边际税率（输入）   ← 用户填，默认空
B7  估算多缴           =IF(B6="","请填入边际税率",-B2*B6)
```

B7 在用户没填税率时**不显示数字**。不替用户猜税率。

顶部必须有一行免责声明，字号不小于正文：本表为工作底稿，非税务申报表，不构成税务建议。

### 2.2 8949

列严格对应 IRS Form 8949 Part I / II：

| 列 | 内容 | 来源 |
|---|---|---|
| a | Description | `"{shares} sh {ticker}"` |
| b | Date acquired | = lot.vestDate |
| c | Date sold | = sale.saleDate |
| d | Proceeds | **照抄 1099-B**，公式引用 `Sales` |
| e | Cost or other basis | **照抄 1099-B**，通常 0 |
| f | Code | 常量 `B` |
| g | Amount of adjustment | `=-(Matching!F{n}-E{n})` |
| h | Gain or loss | `=D{n}-E{n}+G{n}` |

按 box（A/B/C/D/E/F）分组，每组一个小计行。

**两种形态**（`docs/01` §6.1）：基础已报送 IRS 时，d 列与 e 列照抄 1099-B，修正只通过 g 列表达；基础未报送时，e 列直接填正确基础，f 与 g 留空。生成器必须两种都支持。

**逐行输出，不得提供汇总选项。** 带调整代码的行按 IRS 要求必须在 8949 上逐笔列示，汇总行无法编码「这个基础是错的」。见 `docs/11` §5.3。

### 2.3 Matching

每行一条 Match，展示完整推导链：

```
A  sale_id      B  lot_id       C  shares_matched
D  vest_fmv     E  vest_date    F  adjusted_basis  =C*D
G  reported_basis_portion       H  adjustment  =-(F-G)
I  term         =IF(sale_date>EDATE(vest_date,12),"LT","ST")
```

I 列的公式要正确处理「超过一年」而非「满一年」：用 `>` 不是 `>=`。

### 2.4 Sources

每行一个字段值：

```
A  target_sheet   B  target_cell   C  file_name
D  page           E  row_index     F  column_label
G  raw_text       H  method        I  confidence
```

`Lots` 与 `Sales` 中每个提取来的数值格，都要能在这张表里找到对应行。用 A/B 列做定位。

条件格式：`method = 'llm'` 的行标黄，`confidence < 0.95` 的标橙。让复核者一眼看到哪些数字需要重点看。

### 2.5 Checks

```
A  check_id   B  描述   C  期望   D  实际   E  差额   F  状态
```

状态列条件格式：pass 绿、warn 黄、fail 红。

**若有任何 fail，整份 xlsx 不应被生成。** Checks 页存在的意义是记录「这份文件生成时全部校验通过」，以及展示容差内的实际差额供复核。

---

## 3. 样式

克制。这是底稿不是仪表盘。

- 表头行：加粗 + 浅灰底 + 冻结首行
- 金额格式：`#,##0.00`，负数用括号 `(1,234.56)` —— 匹配会计惯例，CPA 期望看到这个
- 日期格式：`yyyy-mm-dd`，避免美式/欧式歧义
- 股数格式：`#,##0.0000`
- 列宽按内容自适应，最小 10 最大 40
- 不用颜色编码语义，除了 Sources 与 Checks 两页的条件格式

---

## 4. 命名

`RSU-basis-{ticker}-{taxYear}.xlsx`

不在文件名里放姓名、SSN 后四位或账号。

---

## 5. 兼容性

必须在三处打开且公式不报错：Excel（Win/Mac）、Numbers、Google Sheets。

因此禁用：
- 动态数组函数（`FILTER`、`XLOOKUP`、`LET`）—— Numbers 与旧版 Excel 不支持
- 结构化引用（`Table[Column]`）—— Numbers 支持不完整
- `EDATE` 之外的日期函数（`EDATE` 三方都支持）

只用：`SUM`、`SUMIF`、`IF`、`EDATE`、`ROUND`、基本算术、A1 引用。

---

## 6. 跨年 ledger

`_ledger` 隐藏 sheet 的 A1 存放完整 schema JSON（gzip + base64）。

明年用户回来时，上传去年的 xlsx，工具读出 `_ledger`，就拿到了历史 lot 台账，可以处理跨年卖出。

**这是这个产品留存的全部来源**，也是它区别于一次性计算器的地方。用户的交付物同时是他的存档文件。

约束：
- 单元格字符串上限 32767，超出则分片到 A1..An
- 写入前后做一次 round-trip 测试（写→读→深度比对）
- ledger 里不含姓名与 SSN，只有 lot 与 sale 数据
- 版本号字段 `schemaVersion`，读取时不兼容要明确报错而非静默降级

**不使用 IndexedDB / localStorage / sessionStorage。** 全部数据在内存中，标签页关闭即释放。见 `CLAUDE.md` R8 与 `docs/07` §2.2。

xlsx 是唯一的持久化产物。刷新页面需重新上传，这是刻意的——在 UI 上讲成特性：

> 刷新后需要重新上传，因为我们不在任何地方保存你的文档，包括你自己的浏览器里。

---

## 7. 生成后自检（必须实现）

生成完成后、交付用户前，在浏览器内执行：

1. 用 `exceljs` 读回文件
2. 用一个轻量公式求值器（或对关键格做手工重算）计算所有公式格
3. 与引擎输出的数值逐格比对，**零容差**
4. 验证 `_ledger` round-trip 一致
5. 任何一项不通过 → 不交付，报 `InvariantViolation`

理由：公式字符串是手写拼接出来的，最容易出现的 bug 是引用行号偏移一行。这类 bug 不会抛异常，只会产出一份看起来完全正常但数字全错的表。**自检是唯一能抓住它的手段。**
