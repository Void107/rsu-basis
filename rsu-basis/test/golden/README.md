# Golden cases

| Case | 覆盖 | 8949 行数 |
|---|---|---|
| `synthetic-001` | 代扣配对、同日多 grant、跨 lot FIFO、成交价≠vest FMV、部分消耗 lot、W-2 对账 | 9 |
| `synthetic-002` | 持有期边界（恰好一年 vs 一年零一天）、往年 vest lot | 2 |
| `synthetic-003` | 基础**未**报送 IRS → Box B/E，正确基础直接进 (e)，无代码 B；短期+长期各一行 | 2 |
| `synthetic-004` | 1099-B 报了**非零**基础 → 加法式 basis 定义（`docs/02` §2.4）；短期+长期 | 2 |

- 001/002：1099-B 基础已报送 IRS 且报为 $0 → Box A/D + 调整代码 B。
- 003：`docs/01` §6.1 第二形态 —— Box B/E，正确基础进 (e) 列，无代码/无 (g)。
- 004：`reportedBasis ≠ 0`，`adjustedBasis = 普通所得部分 + reportedBasisPortion`，
  与乘法式（`matched × vestFmv`）给出不同答案，只有加法式正确。

`docs/06` §10.1 列出的两个覆盖缺口至此均已补上（003、004）。

## verify.py 的两处泛化（reported ≠ 0 / Box B/E）

`verify.py` 原先在多处隐含「reportedBasis 全为 0」。补 003/004 时按 `docs/02` §2.4
的加法式定义独立泛化（不改任何 expected）：

- **I6 精确等式**改用【普通所得部分】而非 `adjustedBasis`：
  `Σ (adjustedBasis − reportedBasisPortion) + Σ 未匹配 basis == Σ ordinaryIncome`。
- `totalAdjustment / gainLossIfUnadjusted / phantomGain` 三项减去 `Σ reportedBasisPortion`。
- 合计循环对 Box B/E 行缺失的 `adjustmentAmount` 按 0 计入。

reportedBasis 全为 0 时这些泛化退化为旧式，001/002 不受影响。

期望值由 `verify.py` 独立验算，构造新 case 时必须跑：`python3 test/golden/verify.py`。
