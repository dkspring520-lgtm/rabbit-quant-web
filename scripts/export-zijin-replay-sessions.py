#!/usr/bin/env python3
"""Export Zijin minute parquet into one causal replay session per JSONL row."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import duckdb


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source = str(args.input.resolve()).replace("'", "''").replace("\\", "/")
    connection = duckdb.connect()
    rows = connection.execute(
        f"""
        SELECT CAST(trade_date AS VARCHAR), CAST(trade_time AS VARCHAR),
               TRY_CAST(close AS DOUBLE), TRY_CAST(vol AS DOUBLE),
               TRY_CAST(pre_close AS DOUBLE)
        FROM read_parquet('{source}')
        WHERE TRY_CAST(close AS DOUBLE) > 0
        ORDER BY trade_date, trade_time
        """
    ).fetchall()
    connection.close()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    current_date: str | None = None
    previous_close: float | None = None
    minutes: list[dict[str, float | str]] = []

    def write_session(handle) -> None:
        if current_date is None or len(minutes) < 120:
            return
        handle.write(json.dumps({
            "date": current_date,
            "previousClose": previous_close,
            "minutes": minutes,
        }, ensure_ascii=False, separators=(",", ":")))
        handle.write("\n")

    with args.output.open("w", encoding="utf-8", newline="\n") as handle:
        for trade_date, trade_time, close, volume, pre_close in rows:
            normalized_date = str(trade_date).replace("-", "")[:8]
            if normalized_date != current_date:
                write_session(handle)
                current_date = normalized_date
                previous_close = float(pre_close) if pre_close else float(close)
                minutes = []
            digits = "".join(character for character in str(trade_time) if character.isdigit())
            time = digits[:4].zfill(4)
            minutes.append({
                "time": time,
                "price": float(close),
                "volume": float(volume or 0),
            })
        write_session(handle)


if __name__ == "__main__":
    main()
