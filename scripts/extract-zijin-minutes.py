#!/usr/bin/env python3
"""Extract Zijin Mining (601899.SH) minute bars from yearly market ZIP files.

The source archives stay untouched. Each worker streams one daily Parquet member
to a temporary file, filters only Zijin Mining with DuckDB, and writes a compact
yearly part. The final output is de-duplicated and sorted by trade date/time.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import shutil
import tempfile
import time
import zipfile
from pathlib import Path

try:
    import duckdb
except ImportError as exc:  # pragma: no cover - operator-facing dependency hint
    raise SystemExit("缺少 duckdb：请先运行 python -m pip install duckdb") from exc


STOCK_CODE = "601899"
NORMALIZED_COLUMNS = (
    "trade_date, trade_time, code, open, high, low, close, vol, amount, "
    "pre_close, change, pct_chg"
)


def sql_path(path: Path) -> str:
    return str(path.resolve()).replace("'", "''").replace("\\", "/")


def normalized_select(parquet_path: Path) -> str:
    source = sql_path(parquet_path)
    return f"""
        SELECT
          replace(substr(CAST(date AS VARCHAR), 1, 10), '-', '') AS trade_date,
          right(CAST(trade_time AS VARCHAR), 8) AS trade_time,
          CAST(code AS VARCHAR) AS code,
          TRY_CAST(open AS DOUBLE) AS open,
          TRY_CAST(high AS DOUBLE) AS high,
          TRY_CAST(low AS DOUBLE) AS low,
          TRY_CAST(close AS DOUBLE) AS close,
          TRY_CAST(vol AS DOUBLE) AS vol,
          TRY_CAST(amount AS DOUBLE) AS amount,
          TRY_CAST(pre_close AS DOUBLE) AS pre_close,
          TRY_CAST(change AS DOUBLE) AS change,
          TRY_CAST(pct_chg AS DOUBLE) AS pct_chg
        FROM read_parquet('{source}')
        WHERE regexp_replace(CAST(code AS VARCHAR), '[^0-9]', '', 'g') = '{STOCK_CODE}'
    """


def archive_members(archive: Path) -> list[str]:
    with zipfile.ZipFile(archive) as handle:
        return sorted(
            member
            for member in handle.namelist()
            if member.lower().endswith(".parquet") and not member.endswith("/")
        )


def extract_archive(archive_text: str, work_text: str) -> dict[str, object]:
    archive = Path(archive_text)
    work_dir = Path(work_text)
    year = archive.stem
    database = work_dir / f"zijin-{year}.duckdb"
    output = work_dir / f"zijin-{year}.parquet"
    members = archive_members(archive)
    if not members:
        return {"year": year, "archive": str(archive), "rows": 0, "days": 0, "part": None}

    con = duckdb.connect(str(database))
    con.execute(
        """
        CREATE TABLE zijin_minutes (
          trade_date VARCHAR,
          trade_time VARCHAR,
          code VARCHAR,
          open DOUBLE,
          high DOUBLE,
          low DOUBLE,
          close DOUBLE,
          vol DOUBLE,
          amount DOUBLE,
          pre_close DOUBLE,
          change DOUBLE,
          pct_chg DOUBLE
        )
        """
    )

    with zipfile.ZipFile(archive) as handle, tempfile.TemporaryDirectory(
        prefix=f"zijin-{year}-", dir=work_dir
    ) as temp_text:
        temp_dir = Path(temp_text)
        daily_file = temp_dir / "daily.parquet"
        for index, member in enumerate(members, start=1):
            with handle.open(member) as source, daily_file.open("wb") as target:
                shutil.copyfileobj(source, target, length=8 * 1024 * 1024)
            con.execute(f"INSERT INTO zijin_minutes {normalized_select(daily_file)}")
            daily_file.unlink(missing_ok=True)
            if index % 30 == 0 or index == len(members):
                print(f"[{year}] {index}/{len(members)} 个交易日", flush=True)

    part_source = sql_path(output)
    con.execute(
        f"""
        COPY (
          SELECT {NORMALIZED_COLUMNS}
          FROM zijin_minutes
          QUALIFY row_number() OVER (
            PARTITION BY trade_date, trade_time ORDER BY code
          ) = 1
          ORDER BY trade_date, trade_time
        ) TO '{part_source}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """
    )
    rows, days, first_date, last_date = con.execute(
        """
        SELECT count(*), count(DISTINCT trade_date), min(trade_date), max(trade_date)
        FROM zijin_minutes
        """
    ).fetchone()
    con.close()
    database.unlink(missing_ok=True)
    return {
        "year": year,
        "archive": str(archive),
        "members": len(members),
        "rows": rows,
        "days": days,
        "firstDate": first_date,
        "lastDate": last_date,
        "part": str(output),
    }


def build_final(parts: list[Path], output: Path, write_csv: bool) -> dict[str, object]:
    con = duckdb.connect()
    part_list = ", ".join(f"'{sql_path(part)}'" for part in parts)
    final_source = sql_path(output)
    con.execute(
        f"""
        COPY (
          SELECT {NORMALIZED_COLUMNS}
          FROM read_parquet([{part_list}])
          QUALIFY row_number() OVER (
            PARTITION BY trade_date, trade_time ORDER BY code
          ) = 1
          ORDER BY trade_date, trade_time
        ) TO '{final_source}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """
    )
    if write_csv:
        csv_source = sql_path(output.with_suffix(".csv"))
        con.execute(
            f"COPY (SELECT * FROM read_parquet('{final_source}') ORDER BY trade_date, trade_time) "
            f"TO '{csv_source}' (HEADER, DELIMITER ',')"
        )

    rows, days, first_date, last_date, duplicate_keys, invalid_prices = con.execute(
        f"""
        WITH source AS (SELECT * FROM read_parquet('{final_source}')),
        duplicate_summary AS (
          SELECT count(*) - count(DISTINCT trade_date || ' ' || trade_time) AS duplicate_keys
          FROM source
        )
        SELECT
          count(*), count(DISTINCT trade_date), min(trade_date), max(trade_date),
          (SELECT duplicate_keys FROM duplicate_summary),
          count(*) FILTER (WHERE close IS NULL OR close <= 0)
        FROM source
        """
    ).fetchone()
    day_shape = con.execute(
        f"""
        SELECT min(points), median(points), max(points)
        FROM (
          SELECT trade_date, count(*) AS points
          FROM read_parquet('{final_source}')
          GROUP BY trade_date
        )
        """
    ).fetchone()
    con.close()
    return {
        "stock": "601899.SH",
        "name": "紫金矿业",
        "rows": rows,
        "tradingDays": days,
        "firstDate": first_date,
        "lastDate": last_date,
        "duplicateMinuteKeys": duplicate_keys,
        "invalidCloseRows": invalid_prices,
        "pointsPerDay": {"min": day_shape[0], "median": day_shape[1], "max": day_shape[2]},
        "parquetBytes": output.stat().st_size,
        "output": str(output),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="只提取紫金矿业 601899.SH 的历史 1 分钟数据")
    parser.add_argument("source", type=Path, help="包含 2022.zip ... 2026.zip 的目录")
    parser.add_argument("--output", type=Path, help="输出 Parquet 路径")
    parser.add_argument("--workers", type=int, default=3, help="并行处理年度 ZIP 数（默认 3）")
    parser.add_argument("--csv", action="store_true", help="同时导出 CSV（体积会更大）")
    args = parser.parse_args()

    source = args.source.resolve()
    output = (args.output or source / "zijin-601899" / "601899.SH-1m-2022-2026.parquet").resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    archives = sorted(
        path for path in source.glob("20*.zip") if path.stem.isdigit() and 2022 <= int(path.stem) <= 2026
    )
    if not archives:
        raise SystemExit(f"在 {source} 没找到 2022.zip—2026.zip")

    started = time.time()
    with tempfile.TemporaryDirectory(prefix="zijin-parts-", dir=output.parent) as work_text:
        workers = max(1, min(args.workers, len(archives)))
        with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(extract_archive, str(archive), work_text) for archive in archives]
            annual = [future.result() for future in concurrent.futures.as_completed(futures)]
        annual.sort(key=lambda item: str(item["year"]))
        parts = [Path(str(item["part"])) for item in annual if item.get("part")]
        manifest = build_final(parts, output, args.csv)

    manifest["sourceArchives"] = annual
    manifest["elapsedSeconds"] = round(time.time() - started, 2)
    manifest["generatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    manifest_path = output.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2), flush=True)
    print(f"完成：{output}", flush=True)


if __name__ == "__main__":
    main()
