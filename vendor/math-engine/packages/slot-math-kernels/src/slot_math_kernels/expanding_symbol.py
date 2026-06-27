"""W244 wave 18 — closed-form analytical model for `expanding_symbol` FS.

Industry pattern (Novomatic Book of Ra, Play'n GO Book of Dead, all
"Book of …" clones, Microgaming Book of Atem, Spinomenal Book of Demi
Gods, Pragmatic Book of Tut):

  Trigger
  -------
    Free Spins trigger by ≥ N scatter (typical N=3 on 5×3 grid).
    Award: `fs_initial_spins` (typical 10).

  Expansion symbol selection
  --------------------------
    At FS start, one EXPANDING SYMBOL is randomly drawn from the
    paytable's HP set with weighted probability (per published
    `expansion_symbol_table`). The chosen symbol stays fixed for the
    entire FS episode.

  Per-FS-spin payout
  ------------------
    Each spin evaluates lines + expansions:
      * Standard line pays (normal grid)
      * Plus: every reel with ≥ 1 instance of the expanding symbol
        EXPANDS to fill all rows on that reel, then awards as
        pay-anywhere across rows.

  Closed-form RTP contribution (FS portion alone)
  -----------------------------------------------
    Per-FS-spin expansion expected value:
      p_per_reel = 1 - (1 - p_cell) ^ rows
      Σ_reels_active = sum over Bernoulli of reel-expansion outcomes
                     ≈ reels × p_per_reel

      E[expansion_pay_per_spin] = sum_symbols(
          weight_symbol/total_w ×
          (reels × p_per_reel × pay_anywhere_award[symbol] +
           normal_line_pay[symbol])
      )

    For just the EXPANSION component (excluding normal line pays):
      E[expansion_only] = sum_syms(weight/total × Σ_reels_expand_pay)

    Per-trigger total:
      E[trigger_total] = fs_initial_spins × E[expansion_pay_per_spin]

    Per-base-spin RTP contribution:
      RTP[fs_expansion] = P(FS_trigger_per_base_spin) × E[trigger_total]

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_expanding_symbol_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_expanding_symbol_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ExpandingSymbolParams:
    """Closed-form model inputs."""
    # FS trigger probability per base spin
    fs_trigger_p: float
    fs_initial_spins: int                   # typical 10
    # Grid topology
    reels: int                              # typical 5
    rows: int                               # typical 3
    # Per-cell landing probability for the expanding symbol.
    # Single value because the FS reels are typically modified to inflate
    # the expanding-symbol weight. Public-spec proxies use 0.08-0.15 range.
    p_per_cell_in_fs: float
    # Pay-anywhere award for full-reel expansion. With `rows` rows on a
    # reel filled with the symbol, this is the published pay schedule:
    # `pay_anywhere_x_bet[reels_expanded]` (table indexed by 1-5 reels).
    # Typical Book-style: {1: 0, 2: 0, 3: 1, 4: 5, 5: 100} or similar.
    pay_table: dict[int, float]
    # Optional: name of the chosen expansion symbol (for audit).
    symbol_name: str = "?"

    def __post_init__(self):
        if not (0.0 <= self.fs_trigger_p <= 1.0):
            raise ValueError(f"fs_trigger_p {self.fs_trigger_p} outside [0,1]")
        if self.fs_initial_spins < 1:
            raise ValueError("fs_initial_spins must be ≥ 1")
        if self.reels < 1:
            raise ValueError("reels must be ≥ 1")
        if self.rows < 1:
            raise ValueError("rows must be ≥ 1")
        if not (0.0 <= self.p_per_cell_in_fs <= 1.0):
            raise ValueError(
                f"p_per_cell_in_fs {self.p_per_cell_in_fs} outside [0,1]"
            )
        if not self.pay_table:
            raise ValueError("pay_table must be non-empty")
        for k, v in self.pay_table.items():
            if k < 0:
                raise ValueError(f"pay_table key {k} must be ≥ 0")
            if v < 0:
                raise ValueError(f"pay_table value {v} must be ≥ 0")


def reel_expansion_probability(p_per_cell: float, rows: int) -> float:
    """P(at least one expanding symbol lands on a reel of `rows` cells).

    Each cell is Bernoulli(p_per_cell), so:
        P(≥1 on reel) = 1 - (1 - p_per_cell) ^ rows
    """
    if p_per_cell >= 1.0:
        return 1.0
    return 1.0 - (1.0 - p_per_cell) ** rows


def expected_reels_expanded(
    p_per_cell: float, reels: int, rows: int
) -> float:
    """E[number of reels with ≥1 expanding symbol].

    By linearity of expectation: reels × P(at least one on a reel).
    """
    return reels * reel_expansion_probability(p_per_cell, rows)


def expected_pay_per_fs_spin(params: ExpandingSymbolParams) -> float:
    """E[expansion pay × bet | one FS spin].

    Computes the full distribution over (k_reels_expanded ∈ [0, reels])
    via Binomial(reels, p_per_reel) and weights by `pay_table[k]`.
    """
    p_per_reel = reel_expansion_probability(
        params.p_per_cell_in_fs, params.rows
    )
    expected = 0.0
    # Binomial PMF over k_reels = 0..reels
    n = params.reels
    q = 1.0 - p_per_reel
    if q == 0:
        # p == 1 → always all reels expand
        return params.pay_table.get(n, 0.0)
    # Iterative PMF construction
    pmf = q ** n  # k = 0
    expected += pmf * params.pay_table.get(0, 0.0)
    for k in range(1, n + 1):
        pmf *= (n - k + 1) / k * (p_per_reel / q)
        expected += pmf * params.pay_table.get(k, 0.0)
    return expected


def expected_pay_per_trigger(params: ExpandingSymbolParams) -> float:
    """E[expansion pay × bet | one FS trigger]."""
    return params.fs_initial_spins * expected_pay_per_fs_spin(params)


def expanding_symbol_rtp(params: ExpandingSymbolParams) -> dict:
    """Per-base-spin RTP contribution + audit breakdown."""
    p_per_reel = reel_expansion_probability(
        params.p_per_cell_in_fs, params.rows
    )
    e_reels = expected_reels_expanded(
        params.p_per_cell_in_fs, params.reels, params.rows
    )
    e_pay_per_spin = expected_pay_per_fs_spin(params)
    e_pay_per_trigger = expected_pay_per_trigger(params)
    rtp = params.fs_trigger_p * e_pay_per_trigger
    return {
        "rtp_contribution": rtp,
        "fs_trigger_p": params.fs_trigger_p,
        "fs_initial_spins": params.fs_initial_spins,
        "reels": params.reels,
        "rows": params.rows,
        "p_per_cell_in_fs": params.p_per_cell_in_fs,
        "p_per_reel": p_per_reel,
        "expected_reels_expanded_per_spin": e_reels,
        "expected_pay_per_fs_spin": e_pay_per_spin,
        "expected_pay_per_trigger": e_pay_per_trigger,
        "symbol_name": params.symbol_name,
        "pay_table": dict(params.pay_table),
    }
