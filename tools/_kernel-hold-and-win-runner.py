#!/usr/bin/env python3
"""tools/_kernel-hold-and-win-runner.py

Composite wrapper for sister-repo `hold_and_win` kernel.

Why this wrapper exists
  The sister-repo generic CLI runner (slot_math_kernels._cli) doesn't
  instantiate NESTED dataclasses. HoldAndWinParams composes:
    money_params: MoneyCollectParams        (dict[float, float] inside)
    jackpot_pots: tuple[MustHitByPot, ...]  (list of dataclass instances)

  JSON deserializes these as plain dicts/lists; the generic runner passes
  them to the dataclass __init__ unchanged → TypeError. This wrapper:
    1. Coerces money_params dict → MoneyCollectParams instance
    2. Coerces value_table string keys → float (JSON limitation)
    3. Coerces jackpot_pots list[dict] → tuple[MustHitByPot, ...]
    4. Invokes hold_and_win_rtp + emits unified JSON result

USAGE
  PYTHONPATH=<sister-repo>/packages/slot-math-kernels/src \\
    python3 tools/_kernel-hold-and-win-runner.py <config.json>

EXPECTED CONFIG SHAPE
  {
    "money_params": {
      "p_per_cell": 0.075, "n_cells": 15, "trigger_count_min": 6,
      "value_table": {"1": 0.5, "5": 0.3, ...}, "respins_reset": 3
    },
    "jackpot_pots": [
      {"name": "mini", "seed_x_bet": 5, "contribution_x": 0.001,
       "must_hit_by_x_bet": 50, "p_strike_per_spin": 0.01},
      ...
    ]
  }

EXIT
  0 — success, JSON on stdout
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
    from slot_math_kernels.hold_and_win import (
        hold_and_win_rtp,
        HoldAndWinParams,
    )
    from slot_math_kernels.money_collect import MoneyCollectParams
    from slot_math_kernels.must_hit_by import MustHitByPot
except ImportError as e:
    print(json.dumps({"error": f"sister-repo import failed: {e}"}))
    sys.exit(1)

cfg = json.loads(cfg_path.read_text())

# Build MoneyCollectParams with coerced value_table (string keys -> float)
mp_raw = cfg.get("money_params", {})
vt_raw = mp_raw.get("value_table", {})
value_table = {float(k): float(v) for k, v in vt_raw.items()}
try:
    money_params = MoneyCollectParams(
        p_per_cell=float(mp_raw["p_per_cell"]),
        n_cells=int(mp_raw["n_cells"]),
        trigger_count_min=int(mp_raw["trigger_count_min"]),
        value_table=value_table,
        respins_reset=int(mp_raw.get("respins_reset", 3)),
        grid_cap=mp_raw.get("grid_cap"),
    )
except (TypeError, ValueError, KeyError) as e:
    print(json.dumps({"error": f"money_params validation failed: {e}"}))
    sys.exit(2)

# Build jackpot_pots tuple
jp_raw = cfg.get("jackpot_pots", [])
if not jp_raw:
    print(json.dumps({"error": "jackpot_pots must be non-empty list"}))
    sys.exit(2)
try:
    jackpot_pots = tuple(
        MustHitByPot(
            name=str(p["name"]),
            seed_x_bet=float(p["seed_x_bet"]),
            contribution_x=float(p["contribution_x"]),
            must_hit_by_x_bet=float(p["must_hit_by_x_bet"]),
            p_strike_per_spin=float(p.get("p_strike_per_spin", 1e-6)),
        )
        for p in jp_raw
    )
except (TypeError, ValueError, KeyError) as e:
    print(json.dumps({"error": f"jackpot_pots validation failed: {e}"}))
    sys.exit(2)

try:
    params = HoldAndWinParams(money_params=money_params, jackpot_pots=jackpot_pots)
except (TypeError, ValueError) as e:
    print(json.dumps({"error": f"HoldAndWinParams validation: {e}"}))
    sys.exit(2)

result = hold_and_win_rtp(params)

# Flatten to JSON-safe output.
out = {
    "rtp_contribution": result["rtp_contribution"],
    "money_component": result["money_component"],
    "jackpot_component": {
        "rtp_contribution": result["jackpot_component"]["rtp_contribution"],
        "pots_count": result["jackpot_component"]["pots_count"],
    },
}
print(json.dumps(out))
sys.exit(0)
