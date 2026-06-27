"""W244 wave 24 — closed-form analytical model for `stacked_wilds`.

Industry pattern (Microgaming Mega Moolah stacked wilds, Aristocrat
Buffalo stacked wilds + 1024 ways, IGT Cleopatra II stacked wilds, NetEnt
Twin Spin stacked wilds + 243 ways):

  Stacked-wilds dynamics
  ----------------------
    Per reel: with probability `p_stacked_per_reel`, the entire reel
    stacks with the wild symbol (all rows = wild). Otherwise reel
    contains regular symbol distribution.

  Per-spin
  --------
    Number of stacked reels per spin ~ Binomial(n_reels, p_stacked_per_reel).
    Per-reel events are independent (standard slot reel assumption).

  Pay model
  ---------
    With K stacked-wild reels, the WINS per spin scale dramatically:
      * On ways games (243, 1024, 4096): stacked reel produces
        WAYS_PER_REEL × K-fold multiplier (all rows act as wild).
      * On lines games: stacked reel × N_PAYLINES extra-line activation.

    Operator supplies an EMPIRICAL `pay_per_stacked_count[k]` table
    (x bet | k reels stacked). Kernel aggregates per-spin RTP from
    Binomial distribution.

  Closed-form RTP contribution
  ----------------------------
    Per-spin RTP from stacked-wilds:

      RTP = sum_{k=0..n_reels} Binomial(n_reels, p_stacked)(k)
            × pay_per_stacked_count[k]

    Pure-stdlib, sub-microsecond for typical 5-7 reel games.

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_stacked_wilds_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_stacked_wilds_kernel.py` for closed-form pin
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class StackedWildsParams:
    """Closed-form model inputs."""
    n_reels: int                                # typical 5-7
    p_stacked_per_reel: float                   # P(reel fully stacked-wild)
    pay_per_stacked_count: dict[int, float]     # {k_stacked: avg_pay_x_bet}

    def __post_init__(self):
        if self.n_reels < 1:
            raise ValueError("n_reels must be ≥ 1")
        if not (0.0 <= self.p_stacked_per_reel <= 1.0):
            raise ValueError(
                f"p_stacked_per_reel {self.p_stacked_per_reel} outside [0,1]"
            )
        if not self.pay_per_stacked_count:
            raise ValueError("pay_per_stacked_count must be non-empty")
        for k, p in self.pay_per_stacked_count.items():
            if k < 0:
                raise ValueError(f"pay_per_stacked_count key {k} must be ≥ 0")
            if p < 0:
                raise ValueError(f"pay_per_stacked_count value {p} must be ≥ 0")


def stacked_count_distribution(params: StackedWildsParams) -> dict[int, float]:
    """Binomial PMF: P(k stacked reels) = C(n, k) × p^k × (1-p)^(n-k)."""
    n = params.n_reels
    p = params.p_stacked_per_reel
    q = 1.0 - p
    if p == 0.0:
        return {0: 1.0}
    if p == 1.0:
        return {n: 1.0}
    dist = {}
    pmf = q ** n
    dist[0] = pmf
    for k in range(1, n + 1):
        pmf *= (n - k + 1) / k * (p / q)
        dist[k] = pmf
    return dist


def expected_stacked_count(params: StackedWildsParams) -> float:
    """E[k stacked reels] = n × p_stacked_per_reel."""
    return params.n_reels * params.p_stacked_per_reel


def stacked_wilds_rtp(params: StackedWildsParams) -> dict:
    """Per-spin RTP + Binomial breakdown."""
    dist = stacked_count_distribution(params)
    rtp = 0.0
    per_k = []
    for k in sorted(dist.keys()):
        prob = dist[k]
        pay = params.pay_per_stacked_count.get(k, 0.0)
        contrib = prob * pay
        rtp += contrib
        per_k.append({
            "k_stacked": k,
            "probability": prob,
            "pay_x_bet": pay,
            "contribution_x_bet": contrib,
        })
    return {
        "rtp_contribution": rtp,
        "n_reels": params.n_reels,
        "p_stacked_per_reel": params.p_stacked_per_reel,
        "expected_stacked_count": expected_stacked_count(params),
        "per_k_breakdown": per_k,
        "binomial_check_sum_prob": sum(dist.values()),
    }


# Sanity reference (used by tests): manual Binomial PMF.
def _binomial_reference(n: int, k: int, p: float) -> float:
    return math.comb(n, k) * (p ** k) * ((1 - p) ** (n - k))
