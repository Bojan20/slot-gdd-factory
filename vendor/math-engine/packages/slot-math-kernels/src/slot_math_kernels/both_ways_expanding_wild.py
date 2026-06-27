"""W244 wave 43 — composed kernel: both_ways + expanding_wild.

DONE-UNIVERSAL #1: Both-ways evaluation + expanding wild symbol on Free Spins.

Industry pattern (Microgaming Thunderstruck II, NetEnt Starburst Wilds,
IGT Wheel of Fortune Wild Both-Ways):

  Base game evaluates pays both LTR + RTL (both_ways kernel).
  FS trigger spawns expanding wild that fills its reel; the expansion
  pays anywhere across rows (expanding_symbol kernel).

  Total RTP = RTP[base both_ways] + RTP[expanding_symbol FS]

  Composition assumes feature independence (industry standard for
  separate triggers — base spin lines + FS trigger reels are
  evaluated independently).

Used by:
  * `tools.build_both_ways_expanding_wild_kernel` — acceptance artefakt
  * `tests/test_w244_both_ways_expanding_wild_kernel.py` — pin
"""
from __future__ import annotations

from dataclasses import dataclass

from .both_ways import BothWaysParams, both_ways_rtp
from .expanding_symbol import (
    ExpandingSymbolParams, expanding_symbol_rtp,
)


@dataclass(frozen=True)
class BothWaysExpandingWildParams:
    """Composed: base both_ways + FS expanding wild."""
    both_ways_params: BothWaysParams
    expanding_params: ExpandingSymbolParams

    def validate(self) -> None:
        # Sub-kernels validate themselves in their __post_init__.
        pass


def both_ways_expanding_wild_rtp(params: BothWaysExpandingWildParams) -> dict:
    """Per-base-spin total RTP across both mechanics."""
    bw = both_ways_rtp(params.both_ways_params)
    fs = expanding_symbol_rtp(params.expanding_params)
    total = bw["rtp_contribution"] + fs["rtp_contribution"]
    return {
        "rtp_contribution": total,
        "both_ways_component": {
            "rtp_contribution": bw["rtp_contribution"],
            "ltr_only_rtp": bw["ltr_only_rtp"],
            "bidirectional_multiplier": bw["bidirectional_multiplier"],
        },
        "expanding_symbol_component": {
            "rtp_contribution": fs["rtp_contribution"],
            "fs_trigger_p": fs["fs_trigger_p"],
            "fs_initial_spins": fs["fs_initial_spins"],
            "expected_pay_per_trigger": fs["expected_pay_per_trigger"],
        },
    }
