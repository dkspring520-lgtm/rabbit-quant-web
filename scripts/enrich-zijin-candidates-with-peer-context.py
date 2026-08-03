#!/usr/bin/env python3
"""Attach strictly causal A-share peer context to Zijin candidate rows."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import duckdb


COPPER = ("000630", "600362", "603993")
GOLD = ("600489", "600547")
NONFERROUS = ("601600",)
TARGET = "601899"


def normalize_time(value: object) -> str:
    digits = "".join(character for character in str(value) if character.isdigit())
    if len(digits) < 4:
        raise ValueError(f"invalid candidate time: {value!r}")
    return digits[:4]


def load_candidates(path: Path) -> list[dict]:
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            row["date"] = str(row["date"]).replace("-", "")
            row["time"] = normalize_time(row["time"])
            row["_peerKey"] = f'{row["date"]}:{row["time"]}'
            row["_sourceLine"] = line_number
            rows.append(row)
    if not rows:
        raise ValueError(f"no candidates found in {path}")
    return rows


def build_context(panel: Path, minimum_date: str, maximum_date: str) -> dict[str, dict]:
    connection = duckdb.connect()
    sql = """
    WITH raw AS (
      SELECT
        trade_date,
        replace(substr(trade_time, 1, 5), ':', '') AS hhmm,
        trade_time,
        code,
        close,
        pre_close,
        vol,
        amount,
        lag(close, 1) OVER day_code AS lag1,
        lag(close, 3) OVER day_code AS lag3,
        lag(close, 5) OVER day_code AS lag5,
        lag(close, 10) OVER day_code AS lag10,
        lag(close, 15) OVER day_code AS lag15,
        sum(amount) OVER day_code_rows AS cumulative_amount,
        sum(vol) OVER day_code_rows AS cumulative_volume
      FROM read_parquet(?)
      WHERE trade_date BETWEEN ? AND ?
      WINDOW
        day_code AS (PARTITION BY trade_date, code ORDER BY trade_time),
        day_code_rows AS (
          PARTITION BY trade_date, code ORDER BY trade_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
    ), feature AS (
      SELECT
        trade_date,
        hhmm,
        code,
        100 * (close / nullif(pre_close, 0) - 1) AS session_return,
        100 * (close / nullif(lag1, 0) - 1) AS return1,
        100 * (close / nullif(lag3, 0) - 1) AS return3,
        100 * (close / nullif(lag5, 0) - 1) AS return5,
        100 * (close / nullif(lag10, 0) - 1) AS return10,
        100 * (close / nullif(lag15, 0) - 1) AS return15,
        100 * (close / nullif(cumulative_amount / nullif(cumulative_volume, 0), 0) - 1)
          AS vwap_deviation
      FROM raw
    ), target AS (
      SELECT * FROM feature WHERE code = '601899'
    ), peers AS (
      SELECT
        trade_date,
        hhmm,
        avg(session_return) AS peer_session_return,
        stddev_pop(session_return) AS peer_dispersion,
        avg(CASE WHEN session_return > 0 THEN 1.0 ELSE 0.0 END) AS peer_breadth_positive,
        avg(CASE WHEN vwap_deviation > 0 THEN 1.0 ELSE 0.0 END) AS peer_breadth_above_vwap,
        avg(return1) AS peer_return1,
        avg(return3) AS peer_return3,
        avg(return5) AS peer_return5,
        avg(return10) AS peer_return10,
        avg(return15) AS peer_return15,
        avg(vwap_deviation) AS peer_vwap_deviation,
        avg(session_return) FILTER (WHERE code IN ('000630','600362','603993')) AS copper_session_return,
        avg(return3) FILTER (WHERE code IN ('000630','600362','603993')) AS copper_return3,
        avg(return5) FILTER (WHERE code IN ('000630','600362','603993')) AS copper_return5,
        avg(return10) FILTER (WHERE code IN ('000630','600362','603993')) AS copper_return10,
        avg(vwap_deviation) FILTER (WHERE code IN ('000630','600362','603993')) AS copper_vwap_deviation,
        avg(session_return) FILTER (WHERE code IN ('600489','600547')) AS gold_session_return,
        avg(return3) FILTER (WHERE code IN ('600489','600547')) AS gold_return3,
        avg(return5) FILTER (WHERE code IN ('600489','600547')) AS gold_return5,
        avg(return10) FILTER (WHERE code IN ('600489','600547')) AS gold_return10,
        avg(vwap_deviation) FILTER (WHERE code IN ('600489','600547')) AS gold_vwap_deviation,
        avg(session_return) FILTER (WHERE code = '601600') AS nonferrous_session_return,
        avg(return3) FILTER (WHERE code = '601600') AS nonferrous_return3,
        avg(return5) FILTER (WHERE code = '601600') AS nonferrous_return5,
        avg(return10) FILTER (WHERE code = '601600') AS nonferrous_return10,
        avg(vwap_deviation) FILTER (WHERE code = '601600') AS nonferrous_vwap_deviation
      FROM feature
      WHERE code <> '601899'
      GROUP BY trade_date, hhmm
    )
    SELECT
      t.trade_date,
      t.hhmm,
      t.session_return AS target_session_return,
      t.vwap_deviation AS target_vwap_deviation,
      p.* EXCLUDE (trade_date, hhmm),
      t.session_return - p.peer_session_return AS peer_residual,
      t.session_return - p.copper_session_return AS copper_residual,
      t.session_return - p.gold_session_return AS gold_residual,
      t.session_return - p.nonferrous_session_return AS nonferrous_residual,
      t.return1 - p.peer_return1 AS peer_residual1,
      t.return3 - p.peer_return3 AS peer_residual3,
      t.return5 - p.peer_return5 AS peer_residual5,
      t.return10 - p.peer_return10 AS peer_residual10,
      t.return15 - p.peer_return15 AS peer_residual15,
      t.vwap_deviation - p.peer_vwap_deviation AS peer_relative_vwap,
      p.peer_return3 - t.return3 AS peer_lead3,
      p.copper_return3 - t.return3 AS copper_lead3,
      p.gold_return3 - t.return3 AS gold_lead3,
      p.nonferrous_return3 - t.return3 AS nonferrous_lead3
    FROM target t
    INNER JOIN peers p USING (trade_date, hhmm)
    ORDER BY t.trade_date, t.hhmm
    """
    cursor = connection.execute(sql, [str(panel), minimum_date, maximum_date])
    columns = [description[0] for description in cursor.description]
    result: dict[str, dict] = {}
    for values in cursor.fetchall():
        record = dict(zip(columns, values))
        key = f'{record.pop("trade_date")}:{record.pop("hhmm")}'
        result[key] = {
            name: (None if value is None else round(float(value), 8))
            for name, value in record.items()
        }
    connection.close()
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("candidates", type=Path)
    parser.add_argument("panel", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    candidates = load_candidates(args.candidates)
    minimum_date = min(row["date"] for row in candidates)
    maximum_date = max(row["date"] for row in candidates)
    context = build_context(args.panel, minimum_date, maximum_date)

    missing: list[str] = []
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="\n") as handle:
        for row in candidates:
            key = row.pop("_peerKey")
            source_line = row.pop("_sourceLine")
            values = context.get(key)
            if values is None:
                missing.append(f"line {source_line}: {key}")
                continue
            row.update(values)
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")

    if missing:
        args.output.unlink(missing_ok=True)
        preview = "; ".join(missing[:8])
        raise RuntimeError(f"missing peer context for {len(missing)} candidates: {preview}")

    print(json.dumps({
        "inputRows": len(candidates),
        "outputRows": len(candidates),
        "contextRows": len(context),
        "dateRange": [minimum_date, maximum_date],
        "peerCodes": list(COPPER + GOLD + NONFERROUS),
        "targetCode": TARGET,
        "causal": True,
        "futureRowsUsed": 0,
        "output": str(args.output),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
