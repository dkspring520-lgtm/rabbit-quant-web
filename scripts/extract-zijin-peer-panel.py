#!/usr/bin/env python3
"""Extract Zijin Mining and a small causal peer basket from yearly A-share ZIPs.

The full-market archives remain untouched. Every daily Parquet member is streamed
to a temporary file, filtered to the configured securities, and merged into one
compact panel keyed by trade date, minute and stock code.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import shutil
import tempfile
import time
import zipfile
from pathlib import Path

import duckdb


SECURITIES = {
    "601899": {"name": "紫金矿业", "group": "target"},
    "603993": {"name": "洛阳钼业", "group": "copper"},
    "600362": {"name": "江西铜业", "group": "copper"},
    "000630": {"name": "铜陵有色", "group": "copper"},
    "600547": {"name": "山东黄金", "group": "gold"},
    "600489": {"name": "中金黄金", "group": "gold"},
    "601600": {"name": "中国铝业", "group": "nonferrous"},
}
NORMALIZED_COLUMNS = (
    "trade_date, trade_time, code, open, high, low, close, vol, amount, "
    "pre_close, change, pct_chg"
)


def sql_path(path: Path) -> str:
    return str(path.resolve()).replace("'", "''").replace("\\", "/")


def normalized_select(parquet_path: Path) -> str:
    source = sql_path(parquet_path)
    codes = ", ".join(f"'{code}'" for code in SECURITIES)
    return f"""
        SELECT
          replace(substr(CAST(date AS VARCHAR), 1, 10), '-', '') AS trade_date,
          right(CAST(trade_time AS VARCHAR), 8) AS trade_time,
          regexp_replace(CAST(code AS VARCHAR), '[^0-9]', '', 'g') AS code,
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
        WHERE regexp_replace(CAST(code AS VARCHAR), '[^0-9]', '', 'g') IN ({codes})
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
    database = work_dir / f"zijin-peers-{year}.duckdb"
    output = work_dir / f"zijin-peers-{year}.parquet"
    members = archive_members(archive)
    if not members:
        return {"year": year, "rows": 0, "days": 0, "part": None}

    con = duckdb.connect(str(database))
    con.execute(
        """
        CREATE TABLE peer_minutes (
          trade_date VARCHAR, trade_time VARCHAR, code VARCHAR,
          open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
          vol DOUBLE, amount DOUBLE, pre_close DOUBLE,
          change DOUBLE, pct_chg DOUBLE
        )
        """
    )
    with zipfile.ZipFile(archive) as handle, tempfile.TemporaryDirectory(
        prefix=f"zijin-peers-{year}-", dir=work_dir
    ) as temp_text:
        daily_file = Path(temp_text) / "daily.parquet"
        for index, member in enumerate(members, start=1):
            with handle.open(member) as source, daily_file.open("wb") as target:
                shutil.copyfileobj(source, target, length=8 * 1024 * 1024)
            con.execute(f"INSERT INTO peer_minutes {normalized_select(daily_file)}")
            daily_file.unlink(missing_ok=True)
            if index % 30 == 0 or index == len(members):
                print(f"[{year}] {index}/{len(members)} 个交易日", flush=True)

    con.execute(
        f"""
        COPY (
          SELECT {NORMALIZED_COLUMNS}
          FROM peer_minutes
          QUALIFY row_number() OVER (
            PARTITION BY trade_date, trade_time, code ORDER BY code
          ) = 1
          ORDER BY trade_date, trade_time, code
        ) TO '{sql_path(output)}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """
    )
    rows, days, first_date, last_date = con.execute(
        """
        SELECT count(*), count(DISTINCT trade_date), min(trade_date), max(trade_date)
        FROM peer_minutes
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


def build_final(parts: list[Path], output: Path) -> dict[str, object]:
    con = duckdb.connect()
    part_list = ", ".join(f"'{sql_path(part)}'" for part in parts)
    con.execute(
        f"""
        COPY (
          SELECT {NORMALIZED_COLUMNS}
          FROM read_parquet([{part_list}])
          QUALIFY row_number() OVER (
            PARTITION BY trade_date, trade_time, code ORDER BY code
          ) = 1
          ORDER BY trade_date, trade_time, code
        ) TO '{sql_path(output)}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """
    )
    rows, days, first_date, last_date, stocks = con.execute(
        f"""
        SELECT count(*), count(DISTINCT trade_date), min(trade_date), max(trade_date),
               count(DISTINCT code)
        FROM read_parquet('{sql_path(output)}')
        """
    ).fetchone()
    by_stock = con.execute(
        f"""
        SELECT code, count(*) AS rows, count(DISTINCT trade_date) AS days,
               min(trade_date) AS first_date, max(trade_date) AS last_date
        FROM read_parquet('{sql_path(output)}')
        GROUP BY code ORDER BY code
        """
    ).fetchall()
    con.close()
    return {
        "rows": rows,
        "tradingDays": days,
        "firstDate": first_date,
        "lastDate": last_date,
        "stockCount": stocks,
        "securities": [
            {
                "code": code,
                **SECURITIES[code],
                "rows": stock_rows,
                "tradingDays": stock_days,
                "firstDate": stock_first,
                "lastDate": stock_last,
            }
            for code, stock_rows, stock_days, stock_first, stock_last in by_stock
        ],
        "parquetBytes": output.stat().st_size,
        "output": str(output),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="提取紫金矿业及六只同业股票的历史1分钟面板")
    parser.add_argument("source", type=Path, help="包含2022.zip至2026.zip的目录")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()

    source = args.source.resolve()
    output = (
        args.output
        or source / "zijin-601899" / "zijin-peer-panel-2022-2026.parquet"
    ).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    archives = sorted(
        path
        for path in source.glob("20*.zip")
        if path.stem.isdigit() and 2022 <= int(path.stem) <= 2026
    )
    if not archives:
        raise SystemExit(f"在 {source} 没找到2022.zip至2026.zip")

    started = time.time()
    with tempfile.TemporaryDirectory(prefix="zijin-peer-parts-", dir=output.parent) as work_text:
        workers = max(1, min(args.workers, len(archives)))
        with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(extract_archive, str(path), work_text) for path in archives]
            annual = [future.result() for future in concurrent.futures.as_completed(futures)]
        annual.sort(key=lambda item: str(item["year"]))
        parts = [Path(str(item["part"])) for item in annual if item.get("part")]
        manifest = build_final(parts, output)

    manifest["sourceArchives"] = annual
    manifest["elapsedSeconds"] = round(time.time() - started, 2)
    manifest["generatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    manifest_path = output.with_suffix(".manifest.json")
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
