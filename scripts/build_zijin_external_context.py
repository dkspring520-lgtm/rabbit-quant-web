#!/usr/bin/env python3
"""Build a causal external-context panel for Zijin Mining research.

Every value joined to an A-share minute must have a source timestamp less than
or equal to that minute.  The output is research-only and is never consumed by
Smart-T V4 automatically.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd


TARGET_CODE = "601899"
LOCAL_TIMEZONE = "Asia/Shanghai"


def load_table(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    if suffix in {".csv", ".txt"}:
        return pd.read_csv(path)
    raise ValueError(f"Unsupported input format: {path}")


def normalize_timestamp(series: pd.Series, timezone: str) -> pd.Series:
    values = pd.to_datetime(series, errors="coerce")
    if values.dt.tz is None:
        return values.dt.tz_localize(timezone, ambiguous="NaT", nonexistent="shift_forward")
    return values.dt.tz_convert(LOCAL_TIMEZONE)


def target_timeline(panel_path: Path) -> pd.DataFrame:
    panel = pd.read_parquet(
        panel_path,
        columns=["trade_date", "trade_time", "code"],
        filters=[("code", "==", TARGET_CODE)],
    )
    panel = panel.loc[panel["code"].astype(str).str.zfill(6) == TARGET_CODE].copy()
    stamp = panel["trade_date"].astype(str).str.replace("-", "", regex=False)
    stamp = stamp + " " + panel["trade_time"].astype(str).str[-8:]
    panel["target_timestamp"] = pd.to_datetime(
        stamp, format="%Y%m%d %H:%M:%S", errors="coerce"
    ).dt.tz_localize(LOCAL_TIMEZONE)
    return (
        panel[["trade_date", "trade_time", "target_timestamp"]]
        .dropna()
        .drop_duplicates("target_timestamp")
        .sort_values("target_timestamp")
        .reset_index(drop=True)
    )


def causal_asof_factor(
    timeline: pd.DataFrame,
    source: pd.DataFrame,
    *,
    factor_id: str,
    timestamp_column: str,
    value_column: str,
    source_timezone: str,
    max_staleness_minutes: int,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    required = {timestamp_column, value_column}
    missing = required.difference(source.columns)
    if missing:
        raise ValueError(f"{factor_id} missing columns: {sorted(missing)}")

    values = source[[timestamp_column, value_column]].copy()
    values["source_timestamp"] = normalize_timestamp(values[timestamp_column], source_timezone)
    values["source_value"] = pd.to_numeric(values[value_column], errors="coerce")
    values = (
        values.dropna(subset=["source_timestamp", "source_value"])
        .sort_values("source_timestamp")
        .drop_duplicates("source_timestamp", keep="last")
    )
    if values.empty:
        raise ValueError(f"{factor_id} has no usable timestamp/value rows")

    joined = pd.merge_asof(
        timeline.sort_values("target_timestamp"),
        values[["source_timestamp", "source_value"]],
        left_on="target_timestamp",
        right_on="source_timestamp",
        direction="backward",
        allow_exact_matches=True,
    )
    age = (joined["target_timestamp"] - joined["source_timestamp"]).dt.total_seconds() / 60
    future_mask = age < 0
    if bool(future_mask.fillna(False).any()):
        raise AssertionError(f"{factor_id} causal audit failed: future row joined")

    available = age.notna() & age.ge(0) & age.le(max_staleness_minutes)
    joined[f"{factor_id}_value"] = joined["source_value"].where(available)
    joined[f"{factor_id}_source_timestamp"] = joined["source_timestamp"].where(available)
    joined[f"{factor_id}_age_minutes"] = age.where(available)
    joined[f"{factor_id}_available"] = available
    joined = joined.drop(columns=["source_timestamp", "source_value"])

    audit = {
        "id": factor_id,
        "sourceRows": int(len(values)),
        "matchedRows": int(available.sum()),
        "coverage": round(float(available.mean()), 6) if len(available) else 0.0,
        "maxStalenessMinutes": int(max_staleness_minutes),
        "earliestSourceTimestamp": values["source_timestamp"].min().isoformat(),
        "latestSourceTimestamp": values["source_timestamp"].max().isoformat(),
        "futureRowsUsed": 0,
    }
    return joined, audit


def load_config(path: Path) -> dict[str, Any]:
    config = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(config.get("factors"), list) or not config["factors"]:
        raise ValueError("config.factors must contain at least one external factor")
    return config


def build_context(
    panel_path: Path,
    config_path: Path,
    output_path: Path,
    audit_path: Path,
) -> dict[str, Any]:
    config = load_config(config_path)
    timeline = target_timeline(panel_path)
    result = timeline.copy()
    audits: list[dict[str, Any]] = []

    for item in config["factors"]:
        factor_path = Path(item["path"]).expanduser()
        if not factor_path.is_absolute():
            factor_path = (config_path.parent / factor_path).resolve()
        source = load_table(factor_path)
        result, audit = causal_asof_factor(
            result,
            source,
            factor_id=item["id"],
            timestamp_column=item.get("timestampColumn", "timestamp"),
            value_column=item.get("valueColumn", "close"),
            source_timezone=item.get("timezone", LOCAL_TIMEZONE),
            max_staleness_minutes=int(item.get("maxStalenessMinutes", 1440)),
        )
        audit["path"] = str(factor_path)
        audits.append(audit)

    factor_columns = [column for column in result.columns if column not in {
        "trade_date", "trade_time", "target_timestamp"
    }]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result.to_parquet(output_path, index=False, compression="zstd")

    audit = {
        "schemaVersion": 1,
        "stage": 3,
        "stock": {"code": TARGET_CODE, "name": "紫金矿业"},
        "status": "external-context-built",
        "affectsV4": False,
        "causal": True,
        "asOfRule": "source_timestamp <= target_timestamp",
        "targetRows": int(len(result)),
        "factorColumns": factor_columns,
        "factors": audits,
        "futureRowsUsed": 0,
        "output": str(output_path),
        "message": "外部因子面板已完成因果对齐；仍需样本外验证和人工评审。",
    }
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    return audit


def self_test() -> None:
    timeline = pd.DataFrame({
        "trade_date": ["20260717"] * 3,
        "trade_time": ["09:30:00", "09:31:00", "09:32:00"],
        "target_timestamp": pd.to_datetime([
            "2026-07-17 09:30:00", "2026-07-17 09:31:00", "2026-07-17 09:32:00"
        ]).tz_localize(LOCAL_TIMEZONE),
    })
    source = pd.DataFrame({
        "timestamp": ["2026-07-17 09:29:00", "2026-07-17 09:31:30"],
        "close": [100.0, 101.0],
    })
    joined, audit = causal_asof_factor(
        timeline,
        source,
        factor_id="syntheticGold",
        timestamp_column="timestamp",
        value_column="close",
        source_timezone=LOCAL_TIMEZONE,
        max_staleness_minutes=10,
    )
    assert joined["syntheticGold_value"].tolist() == [100.0, 100.0, 101.0]
    assert audit["futureRowsUsed"] == 0
    assert audit["matchedRows"] == 3
    print("SELF_TEST_OK: future source rows were not visible before publication")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Zijin external causal context")
    parser.add_argument("--panel", type=Path)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--output", type=Path, default=Path("data/zijin-external-context.parquet"))
    parser.add_argument("--audit", type=Path, default=Path("public/research/zijin-external-context-audit.json"))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.panel or not args.config:
        parser.error("--panel and --config are required unless --self-test is used")
    audit = build_context(args.panel, args.config, args.output, args.audit)
    print(json.dumps(audit, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
