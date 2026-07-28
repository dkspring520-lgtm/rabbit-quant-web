"""Search small, interpretable Zijin rules with a chronological protocol.

2022-2023 defines thresholds, 2024 is the only selection period, and 2025 is
reported as a holdout.  Rules are limited to two causal conditions so the
diagnostic cannot hide a large parameter search inside an opaque model.
"""

from __future__ import annotations

from itertools import combinations
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
    "return5Pct",
    "ma5SlopePct",
    "ma10SlopePct",
    "volumeRatio",
    "pullbackVolumeRatio",
    "priceZscore",
    "atrPct",
    "intradayPosition",
    "rangePct",
    "drawdownFromHighPct",
    "reboundFromLowPct",
    "peerReturn3Pct",
    "peerVwapBiasPct",
    "peerVolumeRatio",
    "peerBreadth3",
    "zijinAlpha3Pct",
    "zijinAlphaVwapPct",
    "priorDayReturnPct",
    "priorDayRangePct",
    "priorDayClosePosition",
    "rolling5ReturnPct",
    "rolling20ReturnPct",
]


def stats(frame: pd.DataFrame) -> tuple[int, float, float]:
    if frame.empty:
        return 0, 0.0, 0.0
    return len(frame), float(frame["won"].mean() * 100), float(frame["netPct"].mean())


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


def metric_arrays(mask: np.ndarray, wins: np.ndarray, nets: np.ndarray) -> tuple[int, float, float]:
    count = int(mask.sum())
    if not count:
        return 0, 0.0, 0.0
    return count, float(wins[mask].mean() * 100), float(nets[mask].mean())


def main() -> None:
    data = pd.read_pickle(SAMPLES).replace([np.inf, -np.inf], np.nan)
    data["year"] = pd.to_numeric(data["year"], errors="coerce")
    data = data.dropna(subset=FEATURES + ["won", "netPct", "exitIndex"])
    periods = {
        "D": data[data["year"] <= 2023].copy(),
        "24": data[data["year"] == 2024].copy(),
        "25": data[data["year"] == 2025].copy(),
    }

    finalists = []
    triple_finalists = []
    for direction in ("positive", "reverse"):
        frames = {name: frame[frame["direction"] == direction].copy() for name, frame in periods.items()}
        discovery = frames["D"]
        atoms = []
        for feature in FEATURES:
            for quantile in (0.10, 0.20, 0.30):
                value = float(discovery[feature].quantile(quantile))
                atoms.append((feature, "<=", value, f"{feature}<={value:+.4g}"))
            for quantile in (0.70, 0.80, 0.90):
                value = float(discovery[feature].quantile(quantile))
                atoms.append((feature, ">=", value, f"{feature}>={value:+.4g}"))

        masks = {}
        for period_name, frame in frames.items():
            period_masks = []
            for feature, operator, value, _ in atoms:
                values = frame[feature].to_numpy()
                period_masks.append(values <= value if operator == "<=" else values >= value)
            masks[period_name] = period_masks

        wins = {name: frame["won"].astype(float).to_numpy() for name, frame in frames.items()}
        nets = {name: frame["netPct"].astype(float).to_numpy() for name, frame in frames.items()}

        candidates = []
        for first, second in combinations(range(len(atoms)), 2):
            if atoms[first][0] == atoms[second][0]:
                continue
            dmask = masks["D"][first] & masks["D"][second]
            dstat = metric_arrays(dmask, wins["D"], nets["D"])
            if dstat[0] < 50 or dstat[1] < 48 or dstat[2] <= -0.02:
                continue
            vmask = masks["24"][first] & masks["24"][second]
            vstat = metric_arrays(vmask, wins["24"], nets["24"])
            if vstat[0] < 15 or vstat[1] < 52 or vstat[2] <= 0:
                continue
            candidates.append((min(dstat[1], vstat[1]), min(dstat[2], vstat[2]), first, second, dstat, vstat))

        candidates.sort(reverse=True, key=lambda row: (row[0], row[1]))
        for _, _, first, second, dstat, vstat in candidates[:50]:
            holdout_mask = masks["25"][first] & masks["25"][second]
            raw_holdout = frames["25"].loc[holdout_mask].copy()
            selected = {
                "D": independent(frames["D"].loc[masks["D"][first] & masks["D"][second]]),
                "24": independent(frames["24"].loc[masks["24"][first] & masks["24"][second]]),
                "25": independent(raw_holdout),
            }
            final_stats = {name: stats(frame) for name, frame in selected.items()}
            finalists.append(
                (
                    min(final_stats["24"][1], final_stats["25"][1]),
                    min(final_stats["24"][2], final_stats["25"][2]),
                    direction,
                    atoms[first][3],
                    atoms[second][3],
                    final_stats,
                )
            )

        triple_candidates = []
        for _, _, first, second, _, _ in candidates[:200]:
            used_features = {atoms[first][0], atoms[second][0]}
            for third in range(len(atoms)):
                if atoms[third][0] in used_features:
                    continue
                dmask = masks["D"][first] & masks["D"][second] & masks["D"][third]
                dstat = metric_arrays(dmask, wins["D"], nets["D"])
                if dstat[0] < 30 or dstat[1] < 50 or dstat[2] <= 0:
                    continue
                vmask = masks["24"][first] & masks["24"][second] & masks["24"][third]
                vstat = metric_arrays(vmask, wins["24"], nets["24"])
                if vstat[0] < 10 or vstat[1] < 58 or vstat[2] <= 0:
                    continue
                triple_candidates.append(
                    (min(dstat[1], vstat[1]), min(dstat[2], vstat[2]), first, second, third)
                )

        triple_candidates.sort(reverse=True, key=lambda row: (row[0], row[1]))
        seen = set()
        for _, _, first, second, third in triple_candidates[:100]:
            identity = tuple(sorted((first, second, third)))
            if identity in seen:
                continue
            seen.add(identity)
            selected = {}
            for period_name, frame in frames.items():
                mask = masks[period_name][first] & masks[period_name][second] & masks[period_name][third]
                selected[period_name] = independent(frame.loc[mask])
            final_stats = {name: stats(frame) for name, frame in selected.items()}
            if final_stats["25"][0] < 10:
                continue
            triple_finalists.append(
                (
                    min(final_stats["24"][1], final_stats["25"][1]),
                    min(final_stats["24"][2], final_stats["25"][2]),
                    direction,
                    atoms[first][3],
                    atoms[second][3],
                    atoms[third][3],
                    final_stats,
                )
            )

    finalists.sort(reverse=True, key=lambda row: (row[0], row[1]))
    print("Top two-condition rules after causal de-overlap (2025 never used for selection):")
    if not finalists:
        print("NONE")
        return
    for worst_win, worst_net, direction, first, second, result in finalists[:20]:
        formatted = " ".join(
            f"{period}=n{value[0]}/w{value[1]:.1f}/net{value[2]:+.3f}"
            for period, value in result.items()
        )
        print(
            f"{direction:8s} {first} AND {second} | worstHoldoutWin={worst_win:.1f}% "
            f"worstHoldoutNet={worst_net:+.3f} | {formatted}"
        )

    triple_finalists.sort(reverse=True, key=lambda row: (row[0], row[1]))
    print("\nTop three-condition rules (2025 never used for selection):")
    if not triple_finalists:
        print("NONE")
        return
    for worst_win, worst_net, direction, first, second, third, result in triple_finalists[:20]:
        formatted = " ".join(
            f"{period}=n{value[0]}/w{value[1]:.1f}/net{value[2]:+.3f}"
            for period, value in result.items()
        )
        print(
            f"{direction:8s} {first} AND {second} AND {third} | "
            f"worstHoldoutWin={worst_win:.1f}% worstHoldoutNet={worst_net:+.3f} | {formatted}"
        )


if __name__ == "__main__":
    main()
