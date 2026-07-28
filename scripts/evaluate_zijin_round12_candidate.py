"""Audit the frozen Round-12 mechanism candidate quarter by quarter.

The thresholds below were selected without 2025.  This script does not tune
them and does not open 2026.  It exists to reject a seemingly strong annual
headline when the signal is concentrated in too few quarters.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / ".round6-runtime" / "cache" / "causal-samples-through-2025.pkl"
BASE_COST_PCT = 0.12
STRESS_EXTRA_COST_PCT = 0.06


def independent(frame: pd.DataFrame, max_per_day: int = 2) -> pd.DataFrame:
    kept = []
    for _, day in frame.sort_values(["date", "rowIndex"]).groupby("date", sort=True):
        last_exit = -1
        count = 0
        for index, row in day.iterrows():
            if count >= max_per_day or int(row["rowIndex"]) <= last_exit:
                continue
            kept.append(index)
            last_exit = int(row["exitIndex"])
            count += 1
    return frame.loc[kept].copy() if kept else frame.iloc[0:0].copy()


def main() -> None:
    data = pd.read_pickle(SAMPLES)
    data["year"] = pd.to_numeric(data["year"], errors="coerce")
    date = pd.to_datetime(data["date"].astype(str))
    candidate = data[
        (data["direction"] == "reverse")
        & (data["intradayPosition"] <= 0.4412)
        & (data["zijinAlphaVwapPct"] >= 0.3034)
        & (data["return5Pct"] <= -0.1104)
    ].copy()
    candidate["quarter"] = date.loc[candidate.index].dt.to_period("Q").astype(str)

    selected_folds = []
    positive_quarters = 0
    print("Frozen rule: reverse AND intradayPosition<=0.4412 AND alphaVWAP>=0.3034 AND return5<=-0.1104")
    for quarter in [f"{year}Q{number}" for year in (2024, 2025) for number in range(1, 5)]:
        chosen = independent(candidate[candidate["quarter"] == quarter])
        selected_folds.append(chosen)
        count = len(chosen)
        win = float(chosen["won"].mean() * 100) if count else 0.0
        net = float(chosen["netPct"].mean()) if count else 0.0
        stress = net - STRESS_EXTRA_COST_PCT if count else 0.0
        if count and net > 0:
            positive_quarters += 1
        print(f"{quarter}: n={count:2d} win={win:5.1f}% net={net:+.3f}% stress={stress:+.3f}%")

    chosen = pd.concat(selected_folds, ignore_index=True)
    print("---")
    print(f"trades={len(chosen)}")
    print(f"winRate={chosen['won'].mean() * 100:.2f}%")
    print(f"averageNet={chosen['netPct'].mean():+.4f}%")
    print(f"stressAverageNet={chosen['netPct'].mean() - STRESS_EXTRA_COST_PCT:+.4f}%")
    print(f"positiveQuarters={positive_quarters}/8")
    print(f"targetTouchRate={chosen['targetTouched'].mean() * 100:.2f}%")
    print(f"medianHoldMinutes={chosen['holdMinutes'].median():.1f}")
    print("exitReasons=" + ",".join(f"{name}:{count}" for name, count in chosen["exitReason"].value_counts().items()))


if __name__ == "__main__":
    main()
