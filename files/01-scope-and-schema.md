# 01 — V1 范围与 Schema 契约

---

## 1. V1 范围

窄到令人不适的程度是刻意的。每一项排除都对应一整类失败模式。

### 包含

- **仅 RSU**（restricted stock units），2014-01-01 之后 vest 的股票
- **两种交易类型**：sell-to-cover（代扣税卖出）与 open-market sale（用户主动卖出）
- **单一税年**
- **单一券商**
- **联邦层面**的 Form 8949 / Schedule D 调整
- **US tax resident**，filing status 不影响本工具的计算

### 明确排除（V1 不做，UI 必须显式告知并停止）

| 排除项 | 为什么单独排除 |
|---|---|
| ESPP | qualified vs disqualifying disposition 规则完全不同，ordinary income 有时不在 W-2 上，需要 Form 3922 |
| ISO / NSO | ISO 有 AMT 双重成本基础与跨年 credit 追踪；NSO 虽然机制接近 RSU 但 W-2 归属不同 |
| 多州分摊 | 按 grant→vest 期间工作地天数分摊，各州口径不一 |
| Wash sale | vest 本身构成「取得」，且券商只在单账户内追踪 |
| 跨年修正（1040-X） | 需要处理历史年度的规则差异与 corrected 1099-B |
| 多券商合并 | lot 在券商间转移后 basis 链断裂 |
| 非美国税务居民 | 涉及分摊与税收协定 |
| 现金分红、股票拆分、并购换股 | 会改变 lot 的股数与 basis |

**这些不是「以后再说」，是「检测到就阻断」。** 检测规则见 `docs/05-failure-paths.md` §2。

### 版本路线（不在 V1 实现，但 schema 要预留）

- V1.1：多券商合并、跨年 ledger
- V1.2：ESPP
- V2：多州分摊
- 不计划：ISO/AMT（复杂度与 V1 不是一个量级，应作为独立产品）

---

## 2. Schema 是产品本体

上游任何券商格式归一到它，下游所有产出物从它读。**这是唯一的契约。** 任何绕过 schema 直接从解析结果算数的代码都是 bug。

三张核心表 + 一张溯源表。

---

## 3. 核心表

### 3.1 `VestLot` — vest 事件产生的税务批次

一次 vest 产生一个 lot。sell-to-cover 卖掉的部分也属于这个 lot。

```ts
interface VestLot {
  id: LotId;                    // 稳定 ID：hash(grantId, vestDate, sharesVested)
  grantId: string | null;       // 券商给的 grant 编号，可能缺失
  vestDate: IsoDate;            // 必需。持有期起算日
  sharesVested: Shares;         // 必需。vest 的总股数（含被扣缴的）
  sharesWithheld: Shares | null;// 代扣税卖掉/扣留的股数
  sharesDelivered: Shares;      // 必需。实际进账户的股数
  vestFmv: Money;               // 必需。每股 FMV。这是 basis 的来源
  ordinaryIncome: Money;        // 必需。= sharesVested × vestFmv，但必须独立提取后交叉验证
  fmvConvention: FmvConvention; // 'close' | 'high_low_avg' | 'prior_close' | 'unknown'
  sources: SourceRef[];         // 见 §4
}
```

**关键约束**：`ordinaryIncome` 不得由 `sharesVested × vestFmv` 计算得出。它必须从补充表独立提取，然后与乘积比对。两者不一致（超出 §5 容差）说明 FMV 口径有问题或提取有误 → 阻断。这是最重要的交叉校验。

### 3.2 `SaleEvent` — 1099-B 上的一笔卖出

```ts
interface SaleEvent {
  id: SaleId;
  saleDate: IsoDate;            // 必需。trade date，不是 settlement date
  sharesSold: Shares;           // 必需
  proceeds: Money;              // 必需。1099-B Box 1d，净额还是毛额要记录
  proceedsBasis: ProceedsKind;  // 'gross' | 'net_of_fees'
  reportedBasis: Money | null;  // 1099-B Box 1e。RSU 场景下通常是 0 或 null
  reportedTerm: Term | null;    // 1099-B Box 2 券商标的长短期，用于交叉验证
  covered: boolean;             // Box 5 是否为 covered security
  basisReportedToIRS: boolean;  // 1099-B Box 12。决定 8949 的输出形态，见 §6.1
  saleKind: SaleKind;           // 'sell_to_cover' | 'open_market' | 'unknown'
  sources: SourceRef[];
}
```

`saleKind` 的判定不由 LLM 做。规则：卖出日期 == 某 lot 的 vestDate 且股数 == 该 lot 的 sharesWithheld → `sell_to_cover`。否则 `open_market`。判不出来 → `unknown`，进入用户裁决流程。

### 3.3 `W2Anchor` — 用于对账的工资侧锚点

```ts
interface W2Anchor {
  taxYear: number;
  box1Total: Money;                 // 参考用，不参与计算
  rsuIncomeReported: Money | null;  // Box 14 或补充表上的 RSU 合计
  rsuIncomeSource: 'box14' | 'supplemental_total' | 'paystub' | null;
  sources: SourceRef[];
}
```

`rsuIncomeReported` 是全局对账的锚：所有 lot 的 `ordinaryIncome` 之和应当等于它。这是捕获「漏掉了一个 lot」的唯一手段。

---

## 4. 溯源

```ts
interface SourceRef {
  fileHash: string;             // sha256(文件字节)
  fileName: string;             // 仅本地展示，不上报
  page: number;                 // 1-indexed
  rowIndex: number | null;      // 表格内行号
  columnLabel: string | null;   // 提取时匹配到的列头原文
  method: 'rule' | 'llm' | 'manual';
  confidence: number;           // 0..1。rule=1.0，llm 由模型给出，manual=1.0
  rawText: string;              // 提取到的原始字符串，未经归一
}
```

`rawText` 是必需的。当归一逻辑出错时（例如把 `1,234.56` 解析成 `1.23456`），只有原始字符串能救回来。

**每个非 null 的 schema 字段必须至少有一条 SourceRef。** 用类型强制：

```ts
type Sourced<T> = { value: T; source: SourceRef };
```

---

## 5. 容差

金额比对使用绝对容差 **$0.01 × 涉及的 lot 数**，用于吸收券商在每股 FMV 上的四舍五入。

超出容差 → `ReconciliationError`，阻断。**不允许调大容差来让流程跑通**，容差变更需要人工决策（`CLAUDE.md` §5）。

股数比对零容差。分数股用 Decimal 保留 4 位小数。

---

## 6. 计算产物（引擎输出，不由提取层填充）

```ts
interface Match {
  saleId: SaleId;
  lotId: LotId;
  sharesMatched: Shares;
  adjustedBasis: Money;         // = sharesMatched × lot.vestFmv
  reportedBasisPortion: Money;  // 1099-B 上对应这部分的 basis，通常 0
  term: Term;                   // 由 vestDate 与 saleDate 计算
  matchMethod: 'fifo' | 'spec_id' | 'sell_to_cover_pairing';
}

interface Form8949Row {
  description: string;          // "N sh COMPANY"
  dateAcquired: IsoDate;        // = lot.vestDate
  dateSold: IsoDate;
  proceeds: Money;              // 照抄 1099-B
  costBasisReported: Money;     // 照抄 1099-B（通常 0）
  adjustmentCode: 'B';
  adjustmentAmount: Money;      // 负数，= -(adjustedBasis - costBasisReported)
  gainLoss: Money;
  term: Term;
  box: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
}
```

### 6.1 两种输出形态 ⚠️

**这不是同一套行加个标记，是两条不同的路径。** 判断依据是 1099-B 的 Box 12（基础是否报送 IRS），必须从表上读取，**不得由 `covered` 推断**。

| Box 12 | 短期 | 长期 | 填法 |
|---|---|---|---|
| **已报送**（含报了 $0） | A | D | (e) 照抄 1099-B 原值 → (f) 填 `B` → (g) 填调整额 |
| **未报送** | B | E | **(e) 直接填正确基础，(f) 与 (g) 留空** |
| 未收到 1099-B | C | F | 直接填正确基础 |

RSU 的绝大多数情形是第一行（券商报了 $0 并报送 IRS）。但第二种真实存在，且形态完全不同。

第一种情形下，`proceeds` 与 `costBasisReported` **必须照抄 1099-B 原值**，不得修正——修正只通过 `adjustmentCode` + `adjustmentAmount` 表达。这是 IRS 要求的呈现方式，也让 IRS 的匹配系统不报警。

第二种情形下没有 `adjustmentCode`，正确基础直接进 (e) 列。

来源与官方原文见 `docs/11` §5.2。

### 6.2 带调整代码的行不可汇总

Schedule D 允许部分交易汇总成一行，但带调整代码的行必须**逐笔列示**——IRS 需要看到调整过程。见 `docs/11` §5.3。

---

## 7. 序列化

schema 落盘为 JSON，金额与股数存字符串。文件名 `ledger-{taxYear}-{fileHash8}.json`。

**落盘后计算幂等**：同一份 ledger JSON 重复跑引擎，输出的 xlsx 字节级一致（除时间戳外）。CI 中有此项检查。
