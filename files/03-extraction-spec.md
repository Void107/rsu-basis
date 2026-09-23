# 03 — 提取层规格

`src/extraction/**`。职责单一：把 PDF 变成 schema。不做任何计算。

---

## 1. 三级策略

严格降级，不跳级：

```
L1  规则解析（pdfjs 文本层 + 券商适配器）    默认，不出网
L2  用户手工补录（表格界面）                 L1 失败时
L3  LLM 单页提取（默认关闭，逐页显式授权）    用户主动选择时
```

**L1 是主路径，必须覆盖 ≥ 95% 的文档。**

> **内部试用版不实现 L3。** 向第三方传输文档内容构成 IRC §7216 意义上的披露，需要 Rev. Proc. 2013-14 规定格式的独立同意书——为内部工具做这套不划算。砍掉 L3 后整个应用在架构上没有出网路径，「断网也能跑」无条件成立。新券商版式的覆盖改用 `docs/06` §3.1 的结构描述表。
>
> 本节 L3 规格保留，标记为**对外分支才实现**。届时的约束见 `docs/07` §4。

L3 若实现，被调用时 UI 必须显示：哪一页会被发送、脱敏后的预览、发往哪个服务商，用户逐页确认——**且这不能替代 §7216 同意书，两者都要**。

---

## 2. 管线

```
File
 → sha256                      文件哈希，用于 SourceRef 与幂等
 → pdfjs getTextContent()      逐页文本项 + 坐标
 → 版式识别                    判定券商与文档类型
 → 表格重建                    按 x 坐标聚类成列，按 y 聚类成行
 → 适配器字段映射              列头原文 → schema 字段
 → 归一                        parseMoney / parseShares / parseDate
 → 交叉校验                    见 §4
 → schema + SourceRef
```

### 表格重建注意

`pdfjs` 的 `textContent.items` 是散落的文本片段，不是表格。重建规则：

- 按 `transform[5]`（y）聚类成行，容差 2pt
- 按 `transform[4]`（x）聚类成列，用表头行的 x 位置定义列边界
- 数字右对齐时 x 是右边界，文本左对齐时 x 是左边界 —— 列匹配用区间包含，不用最近邻
- 跨页表格：识别重复表头，拼接时去掉表头行

**扫描件（无文本层）不支持。** 检测方式：整页 `items.length === 0` 或全页文本占比异常低 → 判为扫描件 → 走 L2 手工补录，明确告知用户，不做 OCR。

---

## 3. 券商适配器

每家一个文件：`src/extraction/brokers/{fidelity,schwab,etrade,morganstanley,shareworks}.ts`。

```ts
interface BrokerAdapter {
  id: BrokerId;
  detect(pages: PageText[]): number;        // 0..1 置信度
  locateSupplemental(pages: PageText[]): PageRange | null;
  columnMap: Record<string, SchemaField>;   // 列头原文 → 字段
  quirks: Quirk[];
  extract(range: PageRange): RawFieldCandidate[];
}
```

### 每个适配器必须记录的内容

在适配器文件顶部的注释块里写清楚，这是 P0 探测的产物：

```
版本样本：2024 tax year，样本哈希 xxx
补充表位置：第 N 页起，标题原文 "..."
必需列的列头原文：
  vest date            → "Date Acquired"
  FMV                  → "Adjusted Cost or Other Basis" / 每股 or 总额？
  ordinary income      → "Ordinary Income Reported"
合计锚点：有 / 无，位置
已知坑：
  - ...
```

### 已知需要处理的通用 quirk

| Quirk | 表现 | 处理 |
|---|---|---|
| 每股 vs 总额 | 有的券商 Adjusted Cost 列是总额，有的是每股 | 用 `总额 / 股数 ≈ 每股` 交叉判定，判不出来 → 阻断 |
| 括号负数 | `(1,234.56)` 表示 -1234.56 | `parseMoney` 统一处理 |
| 分数股 | `12.3456` 股 | Decimal 4 位小数，不四舍五入到整数 |
| 跨页 lot 表 | 一个 lot 的行被页分割 | 表头识别 + 行完整性校验（列数必须齐） |
| corrected 文档 | 页眉含 "CORRECTED" | 检测到必须提示用户并要求确认用哪一份 |
| 多 CUSIP 混排 | 同一表里有非 RSU 持仓 | 只取标注为 RSU / RS 的行，其余忽略但计数并展示 |

---

## 4. 交叉校验（提取层的核心）

**提取错误率可以不为零，但静默错误率必须为零。** 靠这几条实现：

| 校验 | 内容 | 失败处理 |
|---|---|---|
| C1 合计锚定 | 提取的逐行 ordinary income 之和 == 文档印刷合计 | 阻断 |
| C2 乘积一致 | `sharesVested × vestFmv ≈ ordinaryIncome`（独立提取的） | 阻断 |
| C3 股数守恒 | `sharesVested == sharesWithheld + sharesDelivered` | 阻断 |
| C4 行数一致 | 提取行数 == 文档上标注的 lot 数（若有） | 阻断 |
| C5 W-2 锚定 | Σ ordinaryIncome ≈ W-2 RSU 合计 | 阻断 |
| C6 长短期回验 | 引擎算出的 term == 1099-B Box 2 券商标注 | 不一致 → 警示，交用户裁决（券商也可能标错） |
| C7 二次提取 diff | 同一页跑两遍解析器，结果必须完全一致 | 不一致 → InvariantViolation |

**C1 是最重要的一条。** 如果某券商的补充表没有印刷合计行（P0 阶段确认），必须为该券商设计替代锚点，否则不支持该券商。没有锚点的提取是不可信的。

---

## 5. 置信度

- `method: 'rule'` → `confidence: 1.0`。规则解析要么命中要么不命中，不存在「大概是」
- `method: 'llm'` → 模型给出的置信度，且 **< 0.95 的一律进入用户复核队列**
- `method: 'manual'` → `1.0`

置信度不参与计算，只用于决定是否需要用户复核。**不允许「置信度够高就跳过校验」**——§4 的校验永远执行。

---

## 6. 确定性

同一文件多次解析必须产出字节级相同的 schema JSON（`sources[].rawText` 也相同）。

保证方式：
- 不使用 `Map` / `Set` 的迭代顺序做输出排序，显式 sort
- 聚类算法不含随机初始化
- L3 的 LLM 调用结果**只在内存中缓存**，key = `hash(file, page, promptVersion)`，会话结束即失效。**不得落盘**——那是持久化的纳税申报信息，见 `docs/07` §3

CI 检查：golden set 全部文件解析两次，diff 必须为空。

---

## 7. LLM 子目录的硬约束

`src/extraction/llm/`：

- 不得 import `src/engine/**`（CI 检查依赖方向）
- 输出类型只能是 `RawFieldCandidate[]`
- prompt 中文档内容必须包裹在数据边界内，并声明其中的指令性文字应作为普通文本处理（`CLAUDE.md` R6）
- 发送前必须过一遍 `redactPII()`：遮蔽 SSN 模式、账号模式、姓名（用已知的用户姓名做字符串替换）
- 不得请求模型做求和、比较、判断对错
- 每次调用记录 promptVersion，用于缓存 key 与回归追踪

允许的 prompt 形态：「以下是一页表格文本。返回 JSON 数组，每个元素是 `{rowIndex, columnLabel, rawText}`。不要计算，不要推断，只转录。」

禁止的 prompt 形态：任何包含「计算」「判断」「估计」「如果缺失则」的指令。
