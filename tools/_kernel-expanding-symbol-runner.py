#!/usr/bin/env python3
"""tools/_kernel-expanding-symbol-runner.py

Wrapper for sister-repo `expanding_symbol` kernel.

Schema coercion
  pay_table : dict[int, float]  — JSON string keys must be coerced to int.

USAGE
  PYTHONPATH=<sister-repo>/packages/slot-math-kernels/src \\
    python3 tools/_kernel-expanding-symbol-runner.py <config.json>
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
    from slot_math_kernels.expanding_symbol import (
        expanding_symbol_rtp,
        ExpandingSymbolParams,
    )
except ImportError as e:
    print(json.dumps({"error": f"sister-repo import failed: {e}"}))
    sys.exit(1)

cfg = json.loads(cfg_path.read_text())
pt_raw = cfg.get("pay_table", {})
pay_table = {int(k): float(v) for k, v in pt_raw.items()}

try:
    params = ExpandingSymbolParams(
        fs_trigger_p=float(cfg["fs_trigger_p"]),
        fs_initial_spins=int(cfg["fs_initial_spins"]),
        reels=int(cfg["reels"]),
        rows=int(cfg["rows"]),
        p_per_cell_in_fs=float(cfg["p_per_cell_in_fs"]),
        pay_table=pay_table,
        symbol_name=str(cfg.get("symbol_name", "?")),
    )
except (TypeError, ValueError, KeyError) as e:
    print(json.dumps({"error": f"param validation: {e}"}))
    sys.exit(2)

print(json.dumps(expanding_symbol_rtp(params)))
sys.exit(0)
