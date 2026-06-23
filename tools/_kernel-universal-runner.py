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
  cascade          — coerces multiplier_ladder list→tuple
  ways_evaluator   — coerces row_distribution_per_reel list[dict[str,float]]
                     → tuple[dict[int, float]]
  pay_anywhere     — coerces pay_table str→int
  stacked_wilds    — coerces pay_per_stacked_count str→int

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
}

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

# Find Params class + entry fn.
param_cls = None
entry_fn = None
import inspect
for name in dir(mod):
    obj = getattr(mod, name)
    if (inspect.isclass(obj) and hasattr(obj, "__dataclass_fields__")
            and obj.__module__ == mod.__name__ and param_cls is None):
        param_cls = obj
    if inspect.isfunction(obj) and (name.endswith("_rtp") or name.endswith("_rtp_contribution")):
        entry_fn = obj

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
