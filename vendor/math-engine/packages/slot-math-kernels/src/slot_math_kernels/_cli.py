"""W244 wave 64 — `slot-math` CLI runner za slot-math-kernels paket.

Entry point: `slot-math` (via [project.scripts]).

Sub-commands:
  list                          → print 22 kernel modules
  info <kernel>                 → print kernel docstring + public API
  examples                      → run all 5 example scripts (smoke)
  charge-meter --tier ...       → compute charge_meter RTP from JSON args
  both-ways --ltr-rtp ... --share ...  → both_ways quick calc
  buy-feature --bonus ... --cost ... ...   → bonus buy with compliance

Reads JSON config via `--config FILE` for any kernel.

Example:
  $ slot-math list
  $ slot-math info charge_meter
  $ slot-math both-ways --ltr-rtp 0.96 --share 0.7
  $ slot-math run charge_meter --config params.json
"""
from __future__ import annotations

import argparse
import importlib
import inspect
import json
import sys
from pathlib import Path

from . import __version__

KERNELS = [
    "asymmetric_paytable", "both_ways", "both_ways_expanding_wild",
    "buy_feature", "cascade", "charge_meter", "cluster_pays",
    "crash_kernel", "expanding_symbol", "hold_and_win",
    "inverse_solver", "money_collect", "multi_dim_inverse_solver",
    "must_hit_by", "pay_anywhere", "persistent_multiplier", "pick_chain",
    "stacked_wilds", "state_machine", "sticky_wilds", "ways_evaluator",
    "wheel",
]


def _cmd_list(_args) -> int:
    print(f"slot-math-kernels v{__version__} — {len(KERNELS)} kernels:\n")
    for name in KERNELS:
        try:
            mod = importlib.import_module(f"slot_math_kernels.{name}")
            doc = (mod.__doc__ or "").strip().split("\n")[0][:80]
        except ImportError:
            doc = "(import failed)"
        print(f"  {name:30s} {doc}")
    return 0


def _cmd_info(args) -> int:
    kernel_name = args.kernel
    if kernel_name not in KERNELS:
        print(f"Unknown kernel: {kernel_name!r}", file=sys.stderr)
        print(f"Available: {', '.join(KERNELS)}", file=sys.stderr)
        return 2
    mod = importlib.import_module(f"slot_math_kernels.{kernel_name}")
    print(f"# slot_math_kernels.{kernel_name}\n")
    if mod.__doc__:
        print(mod.__doc__.strip())
    print("\n## Public API\n")
    for name in dir(mod):
        if name.startswith("_"):
            continue
        obj = getattr(mod, name)
        if not hasattr(obj, "__module__") or obj.__module__ != mod.__name__:
            continue
        if inspect.isfunction(obj):
            try:
                sig = inspect.signature(obj)
                print(f"  {name}{sig}")
            except (ValueError, TypeError):
                print(f"  {name}(?)")
        elif inspect.isclass(obj) and hasattr(obj, "__dataclass_fields__"):
            fields = list(obj.__dataclass_fields__.keys())
            print(f"  {name} (dataclass: {', '.join(fields)})")
    return 0


def _cmd_both_ways(args) -> int:
    from . import both_ways as bw
    params = bw.BothWaysParams(
        ltr_only_rtp=args.ltr_rtp,
        line_pay_share=args.share,
    )
    r = bw.both_ways_rtp(params)
    print(json.dumps(r, indent=2))
    return 0


def _cmd_buy_feature(args) -> int:
    from . import buy_feature as bf
    params = bf.BuyFeatureParams(
        bonus_average_pay_x_bet=args.bonus,
        buy_cost_x_bet=args.cost,
        base_game_rtp=args.base_rtp,
        target_buy_rtp=args.target,
    )
    audit = bf.buy_feature_audit(params)
    print(json.dumps(audit, indent=2))
    return 0


def _cmd_charge_meter(args) -> int:
    from . import charge_meter as cm
    tiers = []
    for tier_arg in args.tier:
        parts = tier_arg.split(":")
        if len(parts) != 3:
            print(
                f"--tier must be name:threshold:award (got {tier_arg!r})",
                file=sys.stderr,
            )
            return 2
        tiers.append(cm.ChargeTier(
            name=parts[0],
            threshold=float(parts[1]),
            award_value_x_bet=float(parts[2]),
        ))
    params = cm.ChargeMeterParams(
        expected_charge_per_spin=args.expected_charge,
        tiers=tuple(tiers),
    )
    r = cm.charge_meter_rtp(params)
    print(json.dumps(r, indent=2))
    return 0


def _cmd_run(args) -> int:
    """Generic runner — load JSON config + invoke kernel's main entry."""
    kernel_name = args.kernel
    if kernel_name not in KERNELS:
        print(f"Unknown kernel: {kernel_name!r}", file=sys.stderr)
        return 2
    if not Path(args.config).exists():
        print(f"Config file not found: {args.config}", file=sys.stderr)
        return 2
    cfg = json.loads(Path(args.config).read_text())
    mod = importlib.import_module(f"slot_math_kernels.{kernel_name}")

    # Find the dataclass + main entry function for this kernel
    param_cls = None
    entry_fn = None
    for name in dir(mod):
        obj = getattr(mod, name)
        if (inspect.isclass(obj) and hasattr(obj, "__dataclass_fields__")
                and obj.__module__ == mod.__name__):
            # Heuristic: first dataclass is the params class
            if param_cls is None:
                param_cls = obj
        if inspect.isfunction(obj) and name.endswith("_rtp"):
            entry_fn = obj
            break
        if inspect.isfunction(obj) and name.endswith("_rtp_contribution"):
            entry_fn = obj
            break

    if param_cls is None or entry_fn is None:
        print(
            f"Could not locate params class + entry for {kernel_name}",
            file=sys.stderr,
        )
        return 2

    # Build params — only pass keys that the dataclass declares
    valid_keys = set(param_cls.__dataclass_fields__.keys())
    filtered = {k: v for k, v in cfg.items() if k in valid_keys}
    extra = set(cfg) - valid_keys
    if extra:
        print(f"warning: ignoring extra config keys: {extra}",
              file=sys.stderr)
    try:
        params = param_cls(**filtered)
    except TypeError as e:
        print(f"Bad config for {kernel_name}: {e}", file=sys.stderr)
        print(f"Expected fields: {sorted(valid_keys)}", file=sys.stderr)
        return 2

    r = entry_fn(params)
    # Result may be dict OR float — normalize
    if isinstance(r, float):
        r = {"rtp_contribution": r}
    print(json.dumps(r, indent=2, default=str))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="slot-math",
        description=(
            "Closed-form slot math kernel CLI. Each sub-command computes "
            "an RTP contribution or audit report for one of the 22 W244 "
            "math kernels. Output is JSON on stdout."
        ),
    )
    p.add_argument("--version", action="version",
                   version=f"slot-math-kernels {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="List all 22 kernel modules")

    info = sub.add_parser("info", help="Show docs + API for one kernel")
    info.add_argument("kernel", help=f"One of: {', '.join(KERNELS)}")

    bw = sub.add_parser(
        "both-ways",
        help="Compute both_ways RTP (Thunderstruck-style)",
    )
    bw.add_argument("--ltr-rtp", type=float, required=True,
                    help="LTR-only RTP (e.g. 0.96)")
    bw.add_argument("--share", type=float, required=True,
                    help="Line-pay share (e.g. 0.7)")

    bf = sub.add_parser(
        "buy-feature",
        help="Bonus Buy with UKGC/MGA compliance gates",
    )
    bf.add_argument("--bonus", type=float, required=True,
                    help="Bonus average pay × bet")
    bf.add_argument("--cost", type=float, required=True,
                    help="Buy cost × bet")
    bf.add_argument("--base-rtp", type=float, required=True,
                    help="Base game RTP")
    bf.add_argument("--target", type=float, default=0.96,
                    help="Target buy RTP")

    cm = sub.add_parser(
        "charge-meter",
        help="Charge meter Wald-identity RTP",
    )
    cm.add_argument("--expected-charge", type=float, required=True,
                    help="Expected charge per spin")
    cm.add_argument("--tier", action="append", default=[], required=True,
                    help="Tier: name:threshold:award_x_bet "
                         "(can repeat)")

    run = sub.add_parser(
        "run",
        help="Run any kernel from JSON config file",
    )
    run.add_argument("kernel", help="Kernel module name")
    run.add_argument("--config", required=True,
                     help="Path to JSON config file")
    return p


COMMANDS = {
    "list": _cmd_list,
    "info": _cmd_info,
    "both-ways": _cmd_both_ways,
    "buy-feature": _cmd_buy_feature,
    "charge-meter": _cmd_charge_meter,
    "run": _cmd_run,
}


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    handler = COMMANDS.get(args.cmd)
    if handler is None:
        parser.print_help()
        return 2
    try:
        return handler(args)
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
