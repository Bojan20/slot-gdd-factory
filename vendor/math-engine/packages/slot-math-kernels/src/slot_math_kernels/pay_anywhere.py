"""W244 wave 26 — closed-form analytical model for `pay_anywhere` evaluator.

Industry pattern (Pragmatic Sweet Bonanza non-cluster mode, NetEnt Gonzo's
Quest, Pragmatic Wolf Gold scatter-style, all "scatter pay" games):

  Pay-anywhere evaluator
  ----------------------
    Each grid cell may contain the symbol with per-cell probability `p`.
    K matching symbols anywhere on the grid pay `pay_table[K]`, regardless
    of reel/position. Multiple symbols may coexist on same spin (one per
    symbol; this kernel handles ONE symbol at a time — aggregate via
    summation for full game).

  Closed-form RTP contribution
  ----------------------------
    P(K landings) = Binomial(n_cells, p)(K)

    E[pay × bet] = sum_K Binomial(n_cells, p)(K) × pay_table[K]

    Below `min_pay_count` (typical 8 for scatter-pay) pays = 0.

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_pay_anywhere_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_pay_anywhere_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PayAnywhereParams:
    """Closed-form model inputs."""
    n_cells: int                            # total grid cells (e.g. 30 for 6x5)
    p_per_cell: float                       # P(target symbol on a cell)
    pay_table: dict[int, float]             # {K_landings: pay_x_bet}
    min_pay_count: int = 8                  # below this, no pay (typical 8)
    symbol_name: str = "?"

    def __post_init__(self):
        if self.n_cells < 1:
            raise ValueError("n_cells must be ≥ 1")
        if not (0.0 <= self.p_per_cell <= 1.0):
            raise ValueError(
                f"p_per_cell {self.p_per_cell} outside [0,1]"
            )
        if not self.pay_table:
            raise ValueError("pay_table must be non-empty")
        if self.min_pay_count < 1:
            raise ValueError("min_pay_count must be ≥ 1")
        for k, p in self.pay_table.items():
            if k < 0:
                raise ValueError(f"pay_table key {k} must be ≥ 0")
            if p < 0:
                raise ValueError(f"pay_table value {p} must be ≥ 0")


def landing_count_distribution(params: PayAnywhereParams) -> dict[int, float]:
    """Binomial(n_cells, p_per_cell) PMF for landings count."""
    n = params.n_cells
    p = params.p_per_cell
    if p == 0.0:
        return {0: 1.0}
    if p == 1.0:
        return {n: 1.0}
    q = 1.0 - p
    dist = {}
    pmf = q ** n
    dist[0] = pmf
    for k in range(1, n + 1):
        pmf *= (n - k + 1) / k * (p / q)
        dist[k] = pmf
    return dist


def expected_landings(params: PayAnywhereParams) -> float:
    """E[K landings] = n_cells × p_per_cell (Binomial mean)."""
    return params.n_cells * params.p_per_cell


def pay_anywhere_rtp(params: PayAnywhereParams) -> dict:
    """Per-spin RTP contribution + audit breakdown."""
    dist = landing_count_distribution(params)
    rtp = 0.0
    per_k = []
    for k in sorted(dist.keys()):
        prob = dist[k]
        # Below min_pay_count: pay = 0 regardless of pay_table entry
        if k < params.min_pay_count:
            pay = 0.0
        else:
            pay = params.pay_table.get(k, 0.0)
        contrib = prob * pay
        rtp += contrib
        per_k.append({
            "k_landings": k,
            "probability": prob,
            "pay_x_bet": pay,
            "below_min": k < params.min_pay_count,
            "contribution_x_bet": contrib,
        })
    return {
        "rtp_contribution": rtp,
        "n_cells": params.n_cells,
        "p_per_cell": params.p_per_cell,
        "min_pay_count": params.min_pay_count,
        "expected_landings": expected_landings(params),
        "symbol_name": params.symbol_name,
        "per_k_breakdown": per_k,
    }
