#!/usr/bin/env python3
"""tools/_kernel-universal-runner.py

Universal wrapper for sister-repo kernels that have:
  - dict[int, X] or dict[str, dict[int, X]] params (needs str→int coercion)
  - tuple[...] params (needs list→tuple coercion)
  - other shape quirks the generic CLI doesn't handle

USAGE
  PYTHONPATH=<sister>/packages/slot-math-kernels/src \\
    python3 tools/_kernel-universal-runner.py <kernel_name> <config.json>

Supported kernel names (this script knows their shape):
  cascade               — coerces multiplier_ladder list→tuple
  ways_evaluator        — coerces row_distribution_per_reel list[dict[str,float]]
                          → tuple[dict[int, float]]
  pay_anywhere          — coerces pay_table str→int
  stacked_wilds         — coerces pay_per_stacked_count str→int
  both_ways             — no coercion (pure scalars)
  buy_feature           — no coercion (pure scalars)
  persistent_multiplier — no coercion
  must_hit_by           — coerces pots list[dict] → tuple[MustHitByPot]
  wheel                 — coerces segments list[dict] → tuple[WheelSegment]

EXIT
  0 — success
  1 — import / config error
  2 — kernel validation failed
"""
import json
import sys
import importlib
from pathlib import Path

if len(sys.argv) < 3:
    print(json.dumps({"error": "usage: <kernel_name> <config.json>"}))
    sys.exit(1)

kernel_name = sys.argv[1]
cfg_path = Path(sys.argv[2])
if not cfg_path.exists():
    print(json.dumps({"error": f"config not found: {cfg_path}"}))
    sys.exit(1)

# Per-kernel param coercion rules.
def _coerce_must_hit_by(cfg):
    """pots: list[dict] → tuple[MustHitByPot]. Imported lazily to avoid
    cost when this kernel isn't called."""
    from slot_math_kernels.must_hit_by import MustHitByPot
    pots = tuple(
        MustHitByPot(
            name=str(p["name"]),
            seed_x_bet=float(p["seed_x_bet"]),
            contribution_x=float(p["contribution_x"]),
            must_hit_by_x_bet=float(p["must_hit_by_x_bet"]),
            p_strike_per_spin=float(p.get("p_strike_per_spin", 1e-6)),
        )
        for p in cfg.get("pots", [])
    )
    return {**cfg, "pots": pots}


def _coerce_wheel(cfg):
    """segments: list[dict] → tuple[WheelSegment]."""
    from slot_math_kernels.wheel import WheelSegment
    segs = tuple(
        WheelSegment(
            kind=str(s["kind"]),
            weight=float(s["weight"]),
            value_x_bet=float(s.get("value_x_bet", 0.0)),
            jackpot_id=str(s.get("jackpot_id", "")),
        )
        for s in cfg.get("segments", [])
    )
    return {**cfg, "segments": segs}


COERCERS = {
    "cascade": lambda cfg: {
        **cfg,
        "multiplier_ladder": tuple(float(x) for x in cfg["multiplier_ladder"]),
    },
    "ways_evaluator": lambda cfg: {
        **cfg,
        "row_distribution_per_reel": tuple(
            {int(k): float(v) for k, v in d.items()}
            for d in cfg["row_distribution_per_reel"]
        ),
    },
    "pay_anywhere": lambda cfg: {
        **cfg,
        "pay_table": {int(k): float(v) for k, v in cfg.get("pay_table", {}).items()},
    },
    "stacked_wilds": lambda cfg: {
        **cfg,
        "pay_per_stacked_count": {
            int(k): float(v) for k, v in cfg.get("pay_per_stacked_count", {}).items()
        },
    },
    "both_ways":             lambda cfg: cfg,
    "buy_feature":           lambda cfg: cfg,
    "persistent_multiplier": lambda cfg: cfg,
    "must_hit_by":           _coerce_must_hit_by,
    "wheel":                 _coerce_wheel,
    "asymmetric_paytable":   lambda cfg: cfg,  # nested str->str->float, no coercion needed
    "crash_kernel":          lambda cfg: cfg,
}


def _coerce_charge_meter(cfg):
    from slot_math_kernels.charge_meter import ChargeTier
    tiers = tuple(
        ChargeTier(
            name=str(t["name"]),
            threshold=float(t["threshold"]),
            award_value_x_bet=float(t["award_value_x_bet"]),
            award_kind=str(t.get("award_kind", "credit_x_bet")),
        )
        for t in cfg.get("tiers", [])
    )
    return {**cfg, "tiers": tiers}

COERCERS["charge_meter"] = _coerce_charge_meter


def _coerce_pick_chain(cfg):
    from slot_math_kernels.pick_chain import PickLevel
    levels = tuple(
        PickLevel(
            name=str(L["name"]),
            pool_size=int(L["pool_size"]),
            award_distribution={float(k): int(v) for k, v in L["award_distribution"].items()},
        )
        for L in cfg.get("levels", [])
    )
    return {**cfg, "levels": levels}

COERCERS["pick_chain"] = _coerce_pick_chain


def _coerce_state_machine(cfg):
    from slot_math_kernels.state_machine import GameState
    states = tuple(
        GameState(name=str(s["name"]), rtp_component=float(s["rtp_component"]))
        for s in cfg.get("states", [])
    )
    transitions = tuple(tuple(float(x) for x in row) for row in cfg.get("transitions", []))
    return {**cfg, "states": states, "transitions": transitions}

COERCERS["state_machine"] = _coerce_state_machine


def _coerce_both_ways_expanding_wild(cfg):
    """Composite: both_ways_params + expanding_params (both nested dataclasses)."""
    from slot_math_kernels.both_ways import BothWaysParams
    from slot_math_kernels.expanding_symbol import ExpandingSymbolParams
    bw_raw = cfg["both_ways_params"]
    ex_raw = cfg["expanding_params"]
    bw = BothWaysParams(
        ltr_only_rtp=float(bw_raw["ltr_only_rtp"]),
        line_pay_share=float(bw_raw["line_pay_share"]),
    )
    ex = ExpandingSymbolParams(
        fs_trigger_p=float(ex_raw["fs_trigger_p"]),
        fs_initial_spins=int(ex_raw["fs_initial_spins"]),
        reels=int(ex_raw["reels"]),
        rows=int(ex_raw["rows"]),
        p_per_cell_in_fs=float(ex_raw["p_per_cell_in_fs"]),
        pay_table={int(k): float(v) for k, v in ex_raw["pay_table"].items()},
        symbol_name=str(ex_raw.get("symbol_name", "?")),
    )
    return {**cfg, "both_ways_params": bw, "expanding_params": ex}

COERCERS["both_ways_expanding_wild"] = _coerce_both_ways_expanding_wild

if kernel_name not in COERCERS:
    print(json.dumps({"error": f"unsupported kernel: {kernel_name}"}))
    sys.exit(1)

cfg = json.loads(cfg_path.read_text())
cfg = COERCERS[kernel_name](cfg)

try:
    mod = importlib.import_module(f"slot_math_kernels.{kernel_name}")
except ImportError as e:
    print(json.dumps({"error": f"kernel import failed: {e}"}))
    sys.exit(1)

# Find Params class + entry fn. Prefer `<kernel>_rtp` exact match;
# fall back to `<kernel>_rtp_contribution`; then any `*_rtp`.
ENTRY_OVERRIDE = {
    "must_hit_by":   "must_hit_by_rtp",
    "buy_feature":   "buy_feature_audit",
    "crash_kernel":  "crash_audit",
}
param_cls = None
entry_fn = None
import inspect
# Find the top-level Params dataclass. Prefer name ending in "Params"
# (canonical) over other dataclasses defined in the module like
# GameState / WheelSegment / etc which are SUB-components.
for name in dir(mod):
    obj = getattr(mod, name)
    if (inspect.isclass(obj) and hasattr(obj, "__dataclass_fields__")
            and obj.__module__ == mod.__name__ and name.endswith("Params")):
        param_cls = obj
        break
# Fallback: any dataclass if no *Params name found.
if param_cls is None:
    for name in dir(mod):
        obj = getattr(mod, name)
        if (inspect.isclass(obj) and hasattr(obj, "__dataclass_fields__")
                and obj.__module__ == mod.__name__):
            param_cls = obj
            break
# Find entry fn — explicit override OR <kernel>_rtp OR *_rtp_contribution.
override_name = ENTRY_OVERRIDE.get(kernel_name)
if override_name and hasattr(mod, override_name):
    entry_fn = getattr(mod, override_name)
else:
    preferred = f"{kernel_name}_rtp"
    fallback  = f"{kernel_name}_rtp_contribution"
    if hasattr(mod, preferred): entry_fn = getattr(mod, preferred)
    elif hasattr(mod, fallback): entry_fn = getattr(mod, fallback)
    else:
        for name in dir(mod):
            obj = getattr(mod, name)
            if inspect.isfunction(obj) and (name.endswith("_rtp") or name.endswith("_rtp_contribution")):
                entry_fn = obj
                break

if param_cls is None or entry_fn is None:
    print(json.dumps({"error": f"could not locate Params / entry fn for {kernel_name}"}))
    sys.exit(1)

# Filter cfg to declared dataclass fields.
valid_keys = set(param_cls.__dataclass_fields__.keys())
filtered = {k: v for k, v in cfg.items() if k in valid_keys}
try:
    params = param_cls(**filtered)
except (TypeError, ValueError) as e:
    print(json.dumps({"error": f"param validation: {e}", "expected_fields": sorted(valid_keys)}))
    sys.exit(2)

result = entry_fn(params)
print(json.dumps(result, default=str))
sys.exit(0)
