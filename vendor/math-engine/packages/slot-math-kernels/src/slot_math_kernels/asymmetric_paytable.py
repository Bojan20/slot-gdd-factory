"""W244 wave 31 — closed-form analytical model for `asymmetric_paytable`.

Industry pattern (NetEnt Twin Spin asymmetric reels, Pragmatic Wild West
Gold asymmetric pays, ELK Wild Toro asymmetric stacks):

  Asymmetric paytable
  -------------------
    Per-symbol pay depends on PER-REEL appearance count, not just
    "k-of-a-kind anywhere on line". Specifically: standard line games
    assume a symbol's pay scales as f(k) regardless of which reel
    contributes; asymmetric games have per-reel weights so the EFFECTIVE
    pay distribution depends on which reels show the symbol.

    Simplest closed-form: operator supplies per-symbol-and-reel pay
    contribution table, kernel aggregates.

  Closed-form RTP contribution
  ----------------------------
    Per-spin RTP = sum over (symbol, reel-set) of
        P(reel-set ∈ winning pattern) × pay[symbol][reel-set-shape]

    Operator passes `per_shape_contribution[shape_key]` per symbol,
    sourced from PAR or MC. Kernel aggregates.

Pure-stdlib.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AsymmetricPaytableParams:
    """Operator-supplied per-symbol shape-key contributions.

    Each entry `per_symbol_contributions[symbol][shape_key]` is the
    per-spin RTP contribution × bet from that (symbol, shape) pair.
    """
    per_symbol_contributions: dict[str, dict[str, float]]

    def __post_init__(self):
        if not self.per_symbol_contributions:
            raise ValueError("per_symbol_contributions must be non-empty")
        for sym, table in self.per_symbol_contributions.items():
            if not table:
                raise ValueError(f"per_symbol_contributions[{sym!r}] must be non-empty")
            for shape, v in table.items():
                if v < 0:
                    raise ValueError(
                        f"contribution[{sym!r}][{shape!r}] = {v} must be ≥ 0"
                    )


def asymmetric_paytable_rtp(params: AsymmetricPaytableParams) -> dict:
    """Per-spin RTP + per-symbol breakdown."""
    total = 0.0
    per_symbol = []
    for sym in sorted(params.per_symbol_contributions.keys()):
        table = params.per_symbol_contributions[sym]
        sym_total = sum(table.values())
        total += sym_total
        per_symbol.append({
            "symbol": sym,
            "total_contribution_x_bet": sym_total,
            "per_shape": dict(table),
        })
    return {
        "rtp_contribution": total,
        "symbols_count": len(params.per_symbol_contributions),
        "per_symbol_breakdown": per_symbol,
    }
