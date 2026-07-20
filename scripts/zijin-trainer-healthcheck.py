#!/usr/bin/env python3
"""Docker healthcheck for the continuously supervised Zijin trainer."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from zijin_scheduler_health import scheduler_health


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--grace-seconds", type=int, default=180)
    args = parser.parse_args()
    try:
        state = json.loads(args.state.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"unhealthy: {error}") from error
    healthy, reason = scheduler_health(state, idle_grace_seconds=args.grace_seconds)
    print(reason)
    raise SystemExit(0 if healthy else 1)


if __name__ == "__main__":
    main()
