"""Evaluate a strictly causal rolling Zijin classifier without touching 2026.

This diagnostic deliberately trains each validation quarter only on earlier
rows.  It is not an automatic promotion mechanism; its compact output is used
to decide whether a hypothesis is worth preregistering for forward shadowing.
"""

from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier


warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / ".round6-runtime" / "cache" / "causal-samples-through-2025.pkl"
FEATURES = [
    "minuteOfDay",
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
FOLDS = [
    (2024, 1),
    (2024, 2),
    (2024, 3),
    (2024, 4),
    (2025, 1),
    (2025, 2),
    (2025, 3),
    (2025, 4),
]


def independent(rows: pd.DataFrame, max_per_day: int = 2) -> pd.DataFrame:
    """Keep causal, non-overlapping candidates and cap daily executions."""
    kept = []
    for _, day in rows.sort_values(["date", "rowIndex"]).groupby("date", sort=True):
        exit_index = -1
        daily_count = 0
        for row in day.itertuples(index=False):
            if daily_count >= max_per_day or row.rowIndex <= exit_index:
                continue
            kept.append(row)
            exit_index = row.exitIndex
            daily_count += 1
    if not kept:
        return rows.iloc[0:0].copy()
    return pd.DataFrame(kept, columns=rows.columns)


def quarter_mask(frame: pd.DataFrame, year: int, quarter: int) -> pd.Series:
    month = pd.to_datetime(frame["date"].astype(str)).dt.month
    return (frame["year"] == year) & (((month - 1) // 3 + 1) == quarter)


def main() -> None:
    data = pd.read_pickle(SAMPLES).replace([np.inf, -np.inf], np.nan)
    data = data.dropna(subset=FEATURES + ["won", "netPct", "exitIndex"])
    data["date"] = data["date"].astype(str)

    for quantile in (0.90, 0.925, 0.95, 0.96, 0.97, 0.98, 0.99):
        selected_folds = []
        quarter_results = []
        for year, quarter in FOLDS:
            validation = data[quarter_mask(data, year, quarter)].copy()
            validation_start = validation["date"].min()
            training = data[data["date"] < validation_start].copy()
            # One full trading-day embargo between training and validation.
            if not training.empty:
                embargo_day = training["date"].max()
                training = training[training["date"] < embargo_day]

            fold_candidates = []
            for direction in ("positive", "reverse"):
                train_dir = training[training["direction"] == direction]
                valid_dir = validation[validation["direction"] == direction]
                if len(train_dir) < 500 or valid_dir.empty:
                    continue
                model = HistGradientBoostingClassifier(
                    max_iter=100,
                    learning_rate=0.04,
                    max_depth=2,
                    min_samples_leaf=80,
                    l2_regularization=3.0,
                    random_state=20260721,
                )
                model.fit(train_dir[FEATURES], train_dir["won"].astype(int))
                cutoff = float(np.quantile(model.predict_proba(train_dir[FEATURES])[:, 1], quantile))
                scored = valid_dir.copy()
                scored["score"] = model.predict_proba(valid_dir[FEATURES])[:, 1]
                fold_candidates.append(scored[scored["score"] >= cutoff])

            combined = pd.concat(fold_candidates, ignore_index=True) if fold_candidates else validation.iloc[0:0]
            chosen = independent(combined)
            selected_folds.append(chosen)
            quarter_results.append(
                f"{year}Q{quarter}:{len(chosen)}/{chosen['won'].mean() * 100:.0f}%"
                if len(chosen)
                else f"{year}Q{quarter}:0"
            )

        selected = pd.concat(selected_folds, ignore_index=True) if selected_folds else data.iloc[0:0]
        wins = float(selected["won"].mean() * 100) if len(selected) else 0.0
        net = float(selected["netPct"].mean()) if len(selected) else 0.0
        positive_quarters = sum(
            1 for fold in selected_folds if len(fold) and float(fold["netPct"].mean()) > 0
        )
        print(
            f"q={quantile:.3f} n={len(selected):3d} win={wins:5.2f}% "
            f"net={net:+.4f}% positiveQ={positive_quarters}/8 | {' '.join(quarter_results)}"
        )


if __name__ == "__main__":
    main()
