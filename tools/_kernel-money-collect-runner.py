#!/usr/bin/env python3
"""tools/_kernel-money-collect-runner.py

Bridge wrapper for sister-repo `money_collect` kernel.

The slot-math-kernels CLI runner does NOT coerce JSON string keys to
floats (value_table is `dict[float, float]` but JSON only allows string
keys). This script coerces keys before invoking the kernel.

USAGE
  PYTHONPATH=<sister-repo>/packages/slot-math-kernels/src \\
    python3 tools/_kernel-money-collect-runner.py <config.json>

OUTPUT
  Single JSON line on stdout with kernel result.

EXIT
  0 — success
  1 — config / import error
  2 — kernel validation failed
"""
import json
import sys
from pathlib import Path

if len(sys.argv) < 2:
    print(json.dumps({"error": "usage: <config.json>"}))
    sys.exit(1)

cfg_path = Path(sys.argv[1])
if not cfg_path.exists():
    print(json.dumps({"error": f"config not found: {cfg_path}"}))
    sys.exit(1)

try:
    from slot_math_kernels.money_collect import (
        money_collect_rtp_contribution,
        MoneyCollectParams,
    )
except ImportError as e:
    print(json.dumps({"error": f"sister-repo import failed: {e}"}))
    sys.exit(1)

cfg = json.loads(cfg_path.read_text())
value_table_raw = cfg.get("value_table", {})
# JSON string keys -> floats (kernel expects dict[float, float])
value_table = {float(k): float(v) for k, v in value_table_raw.items()}

try:
    params = MoneyCollectParams(
        p_per_cell=float(cfg["p_per_cell"]),
        n_cells=int(cfg["n_cells"]),
        trigger_count_min=int(cfg["trigger_count_min"]),
        value_table=value_table,
        respins_reset=int(cfg.get("respins_reset", 3)),
        grid_cap=cfg.get("grid_cap"),
    )
except (TypeError, ValueError) as e:
    print(json.dumps({"error": f"param validation failed: {e}"}))
    sys.exit(2)

result = money_collect_rtp_contribution(params)
# Convert dict-with-numeric-keys back to string for JSON.
out = {
    "trigger_p": result["trigger_p"],
    "expected_value_per_money": result["expected_value_per_money"],
    "expected_total_per_episode": result["expected_total_per_episode"],
    "rtp_contribution": result["rtp_contribution"],
}
print(json.dumps(out))
sys.exit(0)
