#!/usr/bin/env python3
"""tools/_kernel-sticky-wilds-runner.py

Wrapper for sister-repo `sticky_wilds` kernel.

Schema coercion
  pay_per_wild_count : dict[int, float] — JSON string keys to int.

USAGE
  PYTHONPATH=<sister-repo>/packages/slot-math-kernels/src \\
    python3 tools/_kernel-sticky-wilds-runner.py <config.json>
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
    from slot_math_kernels.sticky_wilds import (
        sticky_wilds_rtp,
        StickyWildsParams,
    )
except ImportError as e:
    print(json.dumps({"error": f"sister-repo import failed: {e}"}))
    sys.exit(1)

cfg = json.loads(cfg_path.read_text())
ppwc_raw = cfg.get("pay_per_wild_count", {})
pay_per_wild_count = {int(k): float(v) for k, v in ppwc_raw.items()}

try:
    params = StickyWildsParams(
        trigger_p=float(cfg["trigger_p"]),
        n_respins=int(cfg["n_respins"]),
        n_cells=int(cfg["n_cells"]),
        p_wild_per_cell_per_respin=float(cfg["p_wild_per_cell_per_respin"]),
        pay_per_wild_count=pay_per_wild_count,
        initial_wilds=int(cfg.get("initial_wilds", 1)),
    )
except (TypeError, ValueError, KeyError) as e:
    print(json.dumps({"error": f"param validation: {e}"}))
    sys.exit(2)

print(json.dumps(sticky_wilds_rtp(params)))
sys.exit(0)
