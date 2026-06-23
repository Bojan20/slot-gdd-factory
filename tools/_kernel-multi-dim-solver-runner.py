#!/usr/bin/env python3
"""tools/_kernel-multi-dim-solver-runner.py

Bridges sister-repo `multi_dim_inverse_solver.newton_raphson_nd` to JSON IPC.

For multi-target inversion: "find p_per_cell AND trigger_count_min that
TOGETHER hit (RTP_money=0.40, trigger_p=0.05)". Composes multi-output
RTP-from-params callback INSIDE Python.

Supported scenarios:
  - kernel='money_collect', solve_for=['p_per_cell', 'trigger_count_min']
    targets=[rtp_target, trigger_p_target]
    fixed={'n_cells', 'value_table', 'respins_reset'}
  - kernel='expanding_symbol', solve_for=['p_per_cell_in_fs', 'fs_trigger_p']
    targets=[rtp_target, ?]  (illustrative)

USAGE
  PYTHONPATH=<sister>/packages/slot-math-kernels/src \\
    python3 tools/_kernel-multi-dim-solver-runner.py <config.json>

EXIT
  0 — success, JSON on stdout
  1 — import / config error
  2 — solver failed
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
    from slot_math_kernels.multi_dim_inverse_solver import newton_raphson_nd
except ImportError as e:
    print(json.dumps({"error": f"sister-repo import failed: {e}"}))
    sys.exit(1)

cfg = json.loads(cfg_path.read_text())
kernel_name = cfg.get("kernel")
solve_for = cfg.get("solve_for", [])  # list of param names
targets   = tuple(float(t) for t in cfg.get("targets", []))
initial   = tuple(float(g) for g in cfg.get("initial_guess", []))
bounds    = cfg.get("bounds")  # optional list of [lo, hi] pairs
if bounds:
    bounds = tuple((float(lo), float(hi)) for lo, hi in bounds)
fixed     = cfg.get("fixed", {})


def _build_money_collect_fn(solve_names):
    """Returns a callable θ → (rtp, trigger_p) for money_collect."""
    from slot_math_kernels.money_collect import (
        money_collect_rtp_contribution, MoneyCollectParams,
    )
    vt = {float(k): float(v) for k, v in fixed.get("value_table", {}).items()}

    def fn(theta):
        # solve_names tells us which slot of theta goes where.
        kwargs = {
            "p_per_cell":         fixed.get("p_per_cell", 0.075),
            "n_cells":            int(fixed.get("n_cells", 15)),
            "trigger_count_min":  int(fixed.get("trigger_count_min", 6)),
            "value_table":        vt,
            "respins_reset":      int(fixed.get("respins_reset", 3)),
        }
        for i, name in enumerate(solve_names):
            kwargs[name] = theta[i] if name != "trigger_count_min" else int(round(theta[i]))
        params = MoneyCollectParams(**kwargs)
        r = money_collect_rtp_contribution(params)
        return (r["rtp_contribution"], r["trigger_p"])
    return fn


CALLBACKS = {
    "money_collect": _build_money_collect_fn,
}

if kernel_name not in CALLBACKS:
    print(json.dumps({"error": f"unsupported kernel: {kernel_name}",
                      "supported": list(CALLBACKS.keys())}))
    sys.exit(2)

fn = CALLBACKS[kernel_name](solve_for)
try:
    result = newton_raphson_nd(
        f=fn,
        target=targets,
        initial_guess=initial,
        bounds=bounds,
    )
except Exception as e:
    print(json.dumps({"error": f"solver failed: {e}"}))
    sys.exit(2)

out = {
    "solved_params":   list(result.final_params),
    "final_residual":  list(result.final_residual),
    "final_norm":      result.final_norm,
    "iterations":      result.iterations,
    "converged":       result.converged,
    "targets":         list(result.target),
    "kernel":          kernel_name,
    "solve_for":       solve_for,
}
print(json.dumps(out))
sys.exit(0)
