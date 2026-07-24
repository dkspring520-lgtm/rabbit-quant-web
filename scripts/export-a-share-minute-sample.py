#!/usr/bin/env python3
"""Export deterministic, unique A-share minute sessions from a yearly ZIP.

The archive contains one Parquet file per trading day.  This utility keeps the
archive untouched, streams selected members through a temporary file, and
exports a compact JSON fixture for causal Smart-T benchmarking.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import shutil
import tempfile
import zipfile
from pathlib import Path

import duckdb


def sql_path(path: Path) -> str:
    return str(path.resolve()).replace("\\", "/").replace("'", "''")


def eligible_codes(connection: duckdb.DuckDBPyConnection, parquet: Path) -> list[str]:
    source = sql_path(parquet)
    rows = connection.execute(
        f"""
        SELECT regexp_replace(CAST(code AS VARCHAR), '[^0-9]', '', 'g') AS code
        FROM read_parquet('{source}')
        WHERE regexp_matches(CAST(code AS VARCHAR), '^(000|001|002|003|300|301|600|601|603|605|688|689)')
          AND TRY_CAST(close AS DOUBLE) BETWEEN 1 AND 500
        GROUP BY 1
        HAVING count(*) >= 230
           AND sum(coalesce(TRY_CAST(amount AS DOUBLE), 0)) >= 50000000
           AND max(TRY_CAST(close AS DOUBLE)) / nullif(min(TRY_CAST(close AS DOUBLE)), 0) <= 1.20
        ORDER BY 1
        """
    ).fetchall()
    return [str(row[0]) for row in rows if row[0]]


def read_sessions(
    connection: duckdb.DuckDBPyConnection,
    parquet: Path,
    date: str,
    codes: list[str],
) -> list[dict[str, object]]:
    source = sql_path(parquet)
    code_list = ", ".join(f"'{code}'" for code in codes)
    rows = connection.execute(
        f"""
        SELECT
          regexp_replace(CAST(code AS VARCHAR), '[^0-9]', '', 'g') AS code,
          strftime(TRY_CAST(trade_time AS TIMESTAMP), '%H%M') AS time,
          TRY_CAST(close AS DOUBLE) AS price,
          greatest(0, coalesce(TRY_CAST(vol AS DOUBLE), 0)) AS volume,
          TRY_CAST(pre_close AS DOUBLE) AS pre_close
        FROM read_parquet('{source}')
        WHERE regexp_replace(CAST(code AS VARCHAR), '[^0-9]', '', 'g') IN ({code_list})
        ORDER BY code, trade_time
        """
    ).fetchall()
    grouped: dict[str, list[tuple[object, ...]]] = {code: [] for code in codes}
    for row in rows:
        grouped.setdefault(str(row[0]), []).append(row)

    sessions: list[dict[str, object]] = []
    for code in codes:
        points = grouped.get(code, [])
        if len(points) < 230:
            continue
        previous_close = float(points[0][4] or points[0][2])
        minutes = [
            {"time": str(row[1]), "price": float(row[2]), "volume": float(row[3])}
            for row in points
            if row[1] and row[2] is not None and math.isfinite(float(row[2]))
        ]
        if len(minutes) < 230:
            continue
        sessions.append(
            {
                "code": code,
                "date": date,
                "previousClose": previous_close,
                "minutes": minutes,
            }
        )
    return sessions


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--samples", type=int, default=200)
    parser.add_argument("--dates", type=int, default=20)
    parser.add_argument("--seed", default="smart-t-causal-2026")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    with zipfile.ZipFile(args.archive) as archive:
        members = sorted(
            member for member in archive.namelist()
            if member.lower().endswith(".parquet") and not member.endswith("/")
        )
        date_count = max(1, min(args.dates, len(members), args.samples))
        selected_members = sorted(rng.sample(members, date_count))
        per_date = math.ceil(args.samples / date_count)
        sessions: list[dict[str, object]] = []
        connection = duckdb.connect()
        with tempfile.TemporaryDirectory(prefix="smart-t-sample-") as temp_text:
            parquet = Path(temp_text) / "daily.parquet"
            for member in selected_members:
                with archive.open(member) as source, parquet.open("wb") as target:
                    shutil.copyfileobj(source, target, length=8 * 1024 * 1024)
                codes = eligible_codes(connection, parquet)
                rng.shuffle(codes)
                sessions.extend(
                    read_sessions(connection, parquet, Path(member).stem, codes[:per_date])
                )
                parquet.unlink(missing_ok=True)
        connection.close()

    sessions = sessions[: args.samples]
    dates = sorted({str(session["date"]) for session in sessions})
    cutoff = dates[max(1, math.floor(len(dates) * 0.8)) - 1] if dates else ""
    for session in sessions:
        session["partition"] = (
            "holdout-latest" if str(session["date"]) > cutoff else "train-older"
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {
                "archive": str(args.archive),
                "seed": args.seed,
                "samples": len(sessions),
                "dates": dates,
                "trainThrough": cutoff,
                "sessions": sessions,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "samples": len(sessions),
                "dates": len(dates),
                "train": sum(s["partition"] == "train-older" for s in sessions),
                "holdout": sum(s["partition"] == "holdout-latest" for s in sessions),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
