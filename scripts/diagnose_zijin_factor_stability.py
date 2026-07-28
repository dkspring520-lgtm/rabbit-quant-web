"""Find interpretable factor regions that remain useful across calendar years.

All bin boundaries are frozen from 2022-2023.  The script reports 2024 and
2025 separately so a visually attractive pooled average cannot hide regime
failure.  This is diagnosis, not a strategy promoter.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / ".round6-runtime" / "cache" / "causal-samples-through-2025.pkl"
FEATURES = [
    "gapPct",
    "openDeviationPct",
    "vwapBiasPct",
    "vwapSlope5Pct",
    "return3Pct",
    "ma5SlopePct",
    "volumeRatio",
    "priceZscore",
    "intradayPosition",
    "peerBreadth3",
    "priorDayReturnPct",
]


def metric(frame: pd.DataFrame) -> tuple[int, float, float]:
    if frame.empty:
        return 0, 0.0, 0.0
    return len(frame), float(frame["won"].mean() * 100), float(frame["netPct"].mean())


def main() -> None:
    data = pd.read_pickle(SAMPLES).replace([np.inf, -np.inf], np.nan)
    data = data.dropna(subset=FEATURES + ["won", "netPct"])
    data["year"] = pd.to_numeric(data["year"], errors="coerce")
    discovery = data[data["year"] <= 2023]
    periods = {
        "D": discovery,
        "24": data[data["year"] == 2024],
        "25": data[data["year"] == 2025],
    }
    rows = []
    for direction in ("positive", "reverse"):
        discovery_dir = discovery[discovery["direction"] == direction]
        for feature in FEATURES:
            edges = np.unique(discovery_dir[feature].quantile(np.linspace(0, 1, 11)).to_numpy())
            if len(edges) < 4:
                continue
            edges[0], edges[-1] = -np.inf, np.inf
            for index in range(len(edges) - 1):
                low, high = float(edges[index]), float(edges[index + 1])
                period_metrics = {}
                for name, period in periods.items():
                    subset = period[
                        (period["direction"] == direction)
                        & (period[feature] > low)
                        & (period[feature] <= high)
                    ]
                    period_metrics[name] = metric(subset)
                if min(period_metrics["24"][0], period_metrics["25"][0]) < 20:
                    continue
                minimum_win = min(period_metrics["24"][1], period_metrics["25"][1])
                minimum_net = min(period_metrics["24"][2], period_metrics["25"][2])
                rows.append((minimum_net, minimum_win, direction, feature, index, low, high, period_metrics))

    rows.sort(reverse=True, key=lambda row: (row[0], row[1]))
    print("Top frozen 2022-23 decile regions, ranked by worst 2024/2025 net:")
    for minimum_net, minimum_win, direction, feature, index, low, high, result in rows[:20]:
        formatted = " ".join(
            f"{period}=n{stats[0]}/w{stats[1]:.1f}/net{stats[2]:+.3f}"
            for period, stats in result.items()
        )
        print(
            f"{direction:8s} {feature:20s} bin{index} ({low:+.4g},{high:+.4g}] "
            f"worstWin={minimum_win:.1f}% worstNet={minimum_net:+.3f} | {formatted}"
        )


if __name__ == "__main__":
    main()
