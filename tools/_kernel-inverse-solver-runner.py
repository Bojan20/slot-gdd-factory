#!/usr/bin/env python3
"""tools/_kernel-inverse-solver-runner.py

Bridges sister-repo `inverse_solver` to JSON IPC.

The solver primitives accept Python callables — not directly JSON-bridgeable.
This wrapper takes a config that names a TARGET kernel + parameter to solve
for + fixed params, builds an RTP-from-param callback INSIDE Python, then
runs Newton-Raphson (or bisection fallback) to find param value that hits
target_rtp.

Supported scenarios (extensible):
  - kernel='hold_and_win',  solve_for='p_per_cell',
    fixed={'n_cells', 'trigger_count_min', 'value_table', 'respins_reset',
           'jackpot_pots'}
  - kernel='cluster_pays',  solve_for='min_cluster_size' (integer-discrete),
    fixed={'cluster_count_distribution', 'pay_table'}
  - kernel='money_collect', solve_for='p_per_cell',
    fixed={'n_cells', 'trigger_count_min', 'value_table', 'respins_reset'}
  - kernel='expanding_symbol', solve_for='p_per_cell_in_fs',
    fixed={'fs_trigger_p', 'fs_initial_spins', 'reels', 'rows', 'pay_table'}

USAGE
  PYTHONPATH=<sister>/packages/slot-math-kernels/src \\
    python3 tools/_kernel-inverse-solver-runner.py <config.json>

EXAMPLE CONFIG
  {
    "kernel": "money_collect",
    "solve_for": "p_per_cell",
    "target_rtp": 0.40,
    "initial_guess": 0.075,
    "param_lo": 0.001,
    "param_hi": 0.5,
    "method": "bisection",
    "fixed": { "n_cells": 15, "trigger_count_min": 6,
               "value_table": {"1": 0.5, "5": 0.3, "10": 0.15, "50": 0.05},
               "respins_reset": 3 }
  }

OUTPUT
  { "solved_param": 0.142, "iterations": 17, "converged": true,
    "achieved_rtp": 0.4001, "target_rtp": 0.40, "method": "bisection" }
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
    from slot_math_kernels.inverse_solver import bisection_1d, newton_raphson_1d
except ImportError as e:
    print(json.dumps({"error": f"sister-repo import failed: {e}"}))
    sys.exit(1)

cfg = json.loads(cfg_path.read_text())
kernel_name = cfg.get("kernel")
solve_for = cfg.get("solve_for")
target_rtp = float(cfg["target_rtp"])
initial = float(cfg.get("initial_guess", 0.1))
lo = float(cfg.get("param_lo", 0.0))
hi = float(cfg.get("param_hi", 1.0))
method = cfg.get("method", "bisection")
fixed = cfg.get("fixed", {})


def _rtp_for_money_collect(p_value: float) -> float:
    from slot_math_kernels.money_collect import (
        money_collect_rtp_contribution, MoneyCollectParams,
    )
    vt = {float(k): float(v) for k, v in fixed.get("value_table", {}).items()}
    params = MoneyCollectParams(
        p_per_cell=p_value,
        n_cells=int(fixed.get("n_cells", 15)),
        trigger_count_min=int(fixed.get("trigger_count_min", 6)),
        value_table=vt,
        respins_reset=int(fixed.get("respins_reset", 3)),
    )
    return money_collect_rtp_contribution(params)["rtp_contribution"]


def _rtp_for_expanding_symbol(p_value: float) -> float:
    from slot_math_kernels.expanding_symbol import (
        expanding_symbol_rtp, ExpandingSymbolParams,
    )
    pt = {int(k): float(v) for k, v in fixed.get("pay_table", {}).items()}
    params = ExpandingSymbolParams(
        fs_trigger_p=float(fixed.get("fs_trigger_p", 0.01)),
        fs_initial_spins=int(fixed.get("fs_initial_spins", 10)),
        reels=int(fixed.get("reels", 5)),
        rows=int(fixed.get("rows", 3)),
        p_per_cell_in_fs=p_value,
        pay_table=pt,
        symbol_name=str(fixed.get("symbol_name", "?")),
    )
    return expanding_symbol_rtp(params)["rtp_contribution"]


RTP_BUILDERS = {
    ("money_collect", "p_per_cell"):         _rtp_for_money_collect,
    ("expanding_symbol", "p_per_cell_in_fs"): _rtp_for_expanding_symbol,
}

key = (kernel_name, solve_for)
if key not in RTP_BUILDERS:
    print(json.dumps({"error": f"unsupported (kernel, solve_for): {key}",
                      "supported": [list(k) for k in RTP_BUILDERS.keys()]}))
    sys.exit(2)

rtp_fn = RTP_BUILDERS[key]

try:
    if method == "bisection":
        result = bisection_1d(rtp_fn, target_rtp, param_lo=lo, param_hi=hi)
    else:
        result = newton_raphson_1d(
            rtp_fn,
            gradient_func=lambda p, _eps=1e-5: (rtp_fn(p + _eps) - rtp_fn(p - _eps)) / (2 * _eps),
            target_rtp=target_rtp,
            initial_guess=initial,
            param_lo=lo,
            param_hi=hi,
        )
except Exception as e:
    print(json.dumps({"error": f"solver failed: {e}"}))
    sys.exit(2)

# SolveResult dataclass fields: converged, iterations, final_param,
# final_rtp, error, target_rtp, history.
out = {
    "solved_param":  result.final_param,
    "achieved_rtp":  result.final_rtp,
    "target_rtp":    target_rtp,
    "iterations":    result.iterations,
    "converged":     result.converged,
    "error_at_solution": result.error,
    "method":        method,
    "kernel":        kernel_name,
    "solve_for":     solve_for,
}
print(json.dumps(out))
sys.exit(0)
