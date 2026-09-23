# 02 — 计算引擎规格

`src/engine/**`。纯函数，无 I/O，无 LLM。这是整个产品里唯一被允许产生数字的地方。

---

## 1. 接口

```ts
// lots.ts
function normalizeVestEvents(raw: VestLot[]): Result<VestLot[], EngineError>;

// matching.ts
function matchSalesToLots(
  sales: SaleEvent[],
  lots: VestLot[],
  policy: MatchPolicy,
): Result<Match[], EngineError>;

// basis.ts
function computeAdjustedBasis(match: Match, lot: VestLot): Money;

// holding.ts
function classifyHoldingPeriod(vestDate: IsoDate, saleDate: IsoDate): Term;

// reconcile.ts
function reconcile(lots: VestLot[], anchor: W2Anchor, matches: Match[]): ReconcileReport;

// form8949.ts
function emit8949Rows(matches: Match[], sales: SaleEvent[], lots: VestLot[]): Form8949Row[];
```

全部返回 `Result<T, E>`，不用异常做控制流。只有「不应发生」的内部不变量违反才抛 `InvariantViolation`。

---

## 2. 关键算法

### 2.1 持有期判定

长期的条件是持有 **超过** 一年，不是满一年。

```
saleDate > vestDate + 1 year  →  long term
否则                            →  short term
```

边界用例（必须有测试）：
- vest 2024-03-15，sale 2025-03-15 → **short**（不是 more than one year）
- vest 2024-03-15，sale 2025-03-16 → long
- vest 2024-02-29，sale 2025-03-01 → long（闰日：2025 无 2/29，加一年落在 2025-02-28，3/1 超过）

日期比较用 UTC 的 `IsoDate` 字符串，不引入时区。

### 2.2 Sell-to-cover 配对（优先于 FIFO）

sell-to-cover 是确定性配对，不走 FIFO：

```
for each sale where saleDate == some lot.vestDate:
    if sale.sharesSold == lot.sharesWithheld:
        pair them, matchMethod = 'sell_to_cover_pairing'
```

同一天有多个 lot vest 时（多个 grant 同日 vest），若股数无法唯一配对 → `AmbiguousMatchError`，交用户裁决。

**不要用「最接近」来消歧。** 猜错会导致 basis 用错 FMV。

### 2.3 剩余卖出的 lot 匹配

默认 FIFO（按 vestDate 升序）。若 1099-B 明确标注了 specific identification 且给出了 acquisition date，优先按该日期精确匹配。

一笔卖出可能跨多个 lot，产生多条 `Match`。跨 lot 时 term 可能不同 → 拆成多行 8949，这是正确行为。

### 2.4 调整金额

**调整后基础的定义是加法式的**（`docs/11` §5.1）：

```
adjustedBasis    = ordinaryIncomePortion + reportedBasisPortion
                   其中 ordinaryIncomePortion = sharesMatched × lot.vestFmv
```

当 1099-B 报 $0（RSU 的绝大多数情形）时，等价于 `sharesMatched × lot.vestFmv`。当券商报了非零基础时，加法式才正确。

**`sharesMatched × lot.vestFmv` 因此是一致性校验，不是计算式。**

```
adjustmentAmount = -(adjustedBasis - reportedBasisPortion)
                 = -ordinaryIncomePortion
gainLoss         = proceedsPortion - reportedBasisPortion + adjustmentAmount
```

以上仅适用于「基础已报送 IRS」的情形。未报送时不产生 adjustment，正确基础直接进 8949 的 (e) 列——见 `docs/01` §6.1。

`adjustmentAmount` **只能为负或零**（负数代表增加 basis、减少 gain）。若算出正数，说明 1099-B 上报的 basis 高于 vest FMV —— 这不是 RSU 场景该出现的，必须阻断而不是照报。见不变量 I5。

proceeds 按股数比例分摊到各 Match，分摊余数归到最后一条 Match，保证求和精确等于原值。

---

## 3. 对账报告

```ts
interface ReconcileReport {
  status: 'ok' | 'blocked';
  checks: CheckResult[];
  totalOrdinaryIncome: Money;
  totalProceeds: Money;
  totalAdjustedBasis: Money;
  totalAdjustment: Money;              // = -totalAdjustedBasis（当 reported basis 全为 0）
  totalCorrectGainLoss: Money;
  gainLossIfUnadjusted: Money;
  phantomGain: Money;
  sharesUnmatchedThisYear: Shares;     // 见下方警告
  basisOfUnmatchedShares: Money;
  estimatedOverpayment: Money | null;  // 仅当用户提供了边际税率才计算
}
```

`estimatedOverpayment` 必须标注为估算，并且**只在用户显式输入边际税率后才出现**——不要替用户猜税率。

### 3.1 `sharesUnmatchedThisYear` 不等于「仍持有」

这个字段是 `Σ lot.sharesVested − Σ matched`，语义是「本年 ledger 中未被匹配的股数」。

只有当所有 lot 都在本税年 vest 时，它才等于仍持有股数。若 ledger 含往年 vest 的 lot，那批 lot 的代扣卖出发生在往年、不在本年 1099-B 上，会被计入「未匹配」——**但它们已经处置了**。

因此：
- UI 上**不得**把这个数字标为「你还持有 N 股」
- 该字段仅用于 I6 的恒等式验算，不作为持仓展示
- 真正的持仓需要跨年 ledger 才能得出（V1.1）

`test/golden/synthetic-002` 专门锁住这个区分。

---

## 4. 不变量（property test，`test/property/`）

用 `fast-check` 生成随机但合法的 lot / sale 组合，验证以下 7 条恒成立。这是本项目的主要测试形态。

| # | 不变量 | 违反意味着 |
|---|---|---|
| I1 | Σ `match.sharesMatched` == Σ `sale.sharesSold` | 有卖出没被匹配，或重复匹配 |
| I2 | 对每个 lot：Σ 匹配到它的股数 ≤ `lot.sharesVested` | lot 被超卖，说明混入了非 RSU 持仓 |
| I3 | Σ `lot.ordinaryIncome` ≈ `anchor.rsuIncomeReported`（§容差） | 漏了 lot，或 W-2 里混了别的股权收入 |
| I4 | 对每个 lot：`sharesVested` == `sharesWithheld` + `sharesDelivered` | 提取错误 |
| I5 | 每条 `adjustmentAmount` ≤ 0 | **方向反转，最危险的错误**。见下 |
| I6 | Σ `adjustedBasis` + Σ 未匹配股数的 basis == Σ `lot.ordinaryIncome`（**精确相等**） | 最强的内部一致性检查。见 §3.1 的语义说明 |
| I7 | 同一输入两次运行，输出深度相等 | 引入了非确定性 |

### 关于 I5

这条是整个产品的安全带。

产品的全部价值是「把被低报的 basis 调高」，方向永远是**增加 basis、减少应税所得**。任何一条调整让用户的应税所得**增加**，都意味着算错了，而这种错会让用户少缴税、收到 IRS 通知、承担罚息——比不用这个工具更糟。

I5 在引擎层是 assertion，在 UI 层是硬阻断。**不允许任何配置项关掉它。**

---

## 5. 错误类型

```ts
class MissingDataError    // 必需字段为 null。带字段名 + 期望来源位置
class ReconciliationError // 交叉校验超出容差。带两侧数值与差额
class AmbiguousMatchError // lot 匹配有多解。带候选列表，交用户裁决
class OutOfScopeError     // 检测到 V1 范围外情形。带具体是哪一类
class InvariantViolation  // 内部 bug。应上报（脱敏后），不应对用户展示细节
```

前四类都是**预期内的、面向用户的**阻断态，必须有对应文案（`docs/05-failure-paths.md`）。只有 `InvariantViolation` 是 bug。

---

## 6. 禁止事项

- 禁止任何形式的估算、内插、外推、默认值
- 禁止根据「市场数据」补全缺失的 vest FMV
- 禁止在匹配歧义时选择「最可能」的一个
- 禁止把 `ordinaryIncome` 由乘积算出（见 `docs/01` §3.1）
- 禁止调宽容差以让流程通过
- 禁止在引擎里做 `try { } catch { return partial }`
