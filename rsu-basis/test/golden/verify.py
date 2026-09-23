#!/usr/bin/env python3
"""独立验算 golden case 的期望值。构造新 case 后必须运行。
不依赖被测代码——这是它的全部意义（docs/06 §7：禁止用工具自身输出当期望值）。"""
import json, sys, pathlib
from decimal import Decimal as D
from datetime import date

def d(s): return date(*map(int, s.split("-")))
def plus1y(x):
    try: return x.replace(year=x.year + 1)
    except ValueError: return x.replace(year=x.year + 1, day=28)

def verify(case: pathlib.Path):
    L = json.loads((case / "expected/ledger.json").read_text())
    M = json.loads((case / "expected/matches.json").read_text())
    F = json.loads((case / "expected/form8949.json").read_text())
    lots = {l["id"]: l for l in L["vestLots"]}
    sales = {s["id"]: s for s in L["saleEvents"]}
    ms, r, e = M["matches"], M["reconcile"], []

    for l in lots.values():
        if D(l["sharesVested"]) != D(l["sharesWithheld"]) + D(l["sharesDelivered"]):
            e.append(f"I4 {l['id']}")
        if D(l["sharesVested"]) * D(l["vestFmv"]) != D(l["ordinaryIncome"]):
            e.append(f"C2 {l['id']}")
    for sid, s in sales.items():
        if sum((D(m["sharesMatched"]) for m in ms if m["saleId"] == sid), D(0)) != D(s["sharesSold"]):
            e.append(f"I1 {sid}")
        if sum((D(m["proceedsPortion"]) for m in ms if m["saleId"] == sid), D(0)) != D(s["proceeds"]):
            e.append(f"proceeds-split {sid}")
    for lid, l in lots.items():
        if sum((D(m["sharesMatched"]) for m in ms if m["lotId"] == lid), D(0)) > D(l["sharesVested"]):
            e.append(f"I2 {lid}")
    for m in ms:
        # docs/02 §2.4 加法式：adjustedBasis = ordinaryIncomePortion + reportedBasisPortion
        oi = D(m["sharesMatched"]) * D(lots[m["lotId"]]["vestFmv"])
        if oi + D(m["reportedBasisPortion"]) != D(m["adjustedBasis"]):
            e.append(f"basis {m['saleId']}/{m['lotId']}")
        exp = "LT" if d(sales[m["saleId"]]["saleDate"]) > plus1y(d(lots[m["lotId"]]["vestDate"])) else "ST"
        if exp != m["term"]:
            e.append(f"term {m['saleId']}/{m['lotId']}")

    sold = sum((D(m["adjustedBasis"]) for m in ms), D(0))
    # reported ≠ 0 时（docs/02 §2.4 加法式），adjustedBasis = 普通所得部分 + reportedBasisPortion。
    # 只有【普通所得部分】参与「普通所得守恒」与调整额，reportedBasisPortion 是独立的既报基础。
    reported_tot = sum((D(m["reportedBasisPortion"]) for m in ms), D(0))
    oi_portion = sold - reported_tot  # = Σ (sharesMatched × vestFmv)
    un = unb = D(0)
    for lid, l in lots.items():
        rem = D(l["sharesVested"]) - sum((D(m["sharesMatched"]) for m in ms if m["lotId"] == lid), D(0))
        un += rem; unb += rem * D(l["vestFmv"])
    oi_tot = sum((D(l["ordinaryIncome"]) for l in lots.values()), D(0))
    # I6（精确）：Σ 普通所得部分 + Σ 未匹配 basis == Σ ordinaryIncome。reported=0 时退化为旧式。
    if oi_portion + unb != oi_tot:
        e.append(f"I6-exact {oi_portion}+{unb}!={oi_tot}")
    proc = sum((D(m["proceedsPortion"]) for m in ms), D(0))
    for k, v in [("totalOrdinaryIncome", oi_tot), ("totalProceeds", proc),
                 ("totalAdjustedBasis", sold), ("totalAdjustment", -oi_portion),
                 ("totalCorrectGainLoss", proc - sold), ("gainLossIfUnadjusted", proc - reported_tot),
                 ("phantomGain", oi_portion), ("sharesUnmatchedThisYear", un),
                 ("basisOfUnmatchedShares", unb)]:
        if D(r[k]) != v: e.append(f"reconcile.{k} {r[k]}!={v}")

    if len(F["rows"]) != len(ms): e.append("8949-row-count")
    for row, m in zip(F["rows"], ms):
        reported = sales[m["saleId"]].get("basisReportedToIRS", True)
        if reported:
            adj = -(D(m["adjustedBasis"]) - D(m["reportedBasisPortion"]))
            if row.get("adjustmentCode") != "B": e.append(f"code {row['dateSold']}")
            if D(row["adjustmentAmount"]) != adj: e.append(f"adj {row['dateSold']}")
            if D(row["costBasisReported"]) != D(m["reportedBasisPortion"]): e.append(f"e-col {row['dateSold']}")
            if D(row["gainLoss"]) != D(m["proceedsPortion"]) - D(m["reportedBasisPortion"]) + adj:
                e.append(f"gl {row['dateSold']}")
            if D(row["adjustmentAmount"]) > 0: e.append("I5 VIOLATION")
            exp_box = "A" if row["term"] == "ST" else "D"
        else:
            # docs/01 §6.1 第二形态：正确基础直接进 (e)，无代码
            if row.get("adjustmentCode"): e.append(f"unexpected-code {row['dateSold']}")
            if D(row["costBasisReported"]) != D(m["adjustedBasis"]): e.append(f"e-col-direct {row['dateSold']}")
            exp_box = "B" if row["term"] == "ST" else "E"
        if row["box"] != exp_box: e.append(f"box {row['dateSold']}")
    t = F["totals"]
    for k in ["proceeds", "adjustmentAmount", "gainLoss"]:
        # Box B/E 行无 (g) 调整额（docs/01 §6.1 第二形态），行内缺该列按 0 计入合计。
        if D(t[k]) != sum((D(x.get(k, "0")) for x in F["rows"]), D(0)): e.append(f"totals.{k}")

    print(f"{case.name}: {'PASS' if not e else 'FAIL -> ' + '; '.join(e)}")
    return not e

if __name__ == "__main__":
    root = pathlib.Path(__file__).parent
    cases = sorted(p for p in root.iterdir() if p.is_dir() and (p / "meta.yaml").exists())
    sys.exit(0 if all([verify(c) for c in cases]) else 1)
