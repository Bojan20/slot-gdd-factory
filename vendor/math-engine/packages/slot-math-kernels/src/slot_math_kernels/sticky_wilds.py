"""W244 wave 23 — closed-form analytical model for `sticky_wilds`.

Industry pattern (NetEnt Sticky Bandits Wild, Pragmatic Pyramid King
sticky wilds, JTG Wild Bounty Showdown, Quickspin Sticky Bandits Trail
of Blood, BTG Bonanza Billion sticky wilds):

  Sticky-wilds respin chain
  -------------------------
    A "sticky-wild trigger" event opens a respin sequence. On each
    respin:
      * Each non-locked cell may land a NEW wild with probability
        `p_wild_per_cell_per_respin`.
      * New wilds LOCK in place for the remainder of the chain.
      * Pay evaluated each respin with all locked wilds counted.

    Chain length is fixed at `n_respins` (typical 3-5).

  Closed-form RTP contribution
  ----------------------------
    Let W_t = number of wilds on grid at start of respin t.
    By linearity of expectation:

      E[W_t] = E[W_{t-1}] + (n_cells - E[W_{t-1}]) × p_wild
            = n_cells - (n_cells - E[W_0]) × (1 - p_wild)^(t-1)

    Each respin's expected pay is operator-supplied as
    `pay_per_wild_count[k]` (× bet | k wilds on grid). Total chain
    contribution:

      E[chain_pay] = sum_t E[pay_per_respin(W_t)]
                   = sum_t sum_k P(W_t = k) × pay_per_wild_count[k]

    For tractable closed-form, we compute the exact (binomial-extended)
    distribution of W_t via Markov DP on (k_wilds, respin_t) state.

  Per-base-spin RTP
  -----------------
    RTP = trigger_p × E[chain_pay]

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_sticky_wilds_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_sticky_wilds_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class StickyWildsParams:
    """Closed-form model inputs."""
    trigger_p: float                            # P(sticky wilds chain triggers)
    n_respins: int                              # respin chain length (typical 3-5)
    n_cells: int                                # grid cells (e.g. 15 for 5×3)
    p_wild_per_cell_per_respin: float           # P(non-locked cell lands wild)
    pay_per_wild_count: dict[int, float]        # {k_wilds: avg_pay_x_bet}
    initial_wilds: int = 1                      # wilds locked at trigger (typical 1)

    def __post_init__(self):
        if not (0.0 <= self.trigger_p <= 1.0):
            raise ValueError(f"trigger_p {self.trigger_p} outside [0,1]")
        if self.n_respins < 1:
            raise ValueError("n_respins must be ≥ 1")
        if self.n_cells < 1:
            raise ValueError("n_cells must be ≥ 1")
        if not (0.0 <= self.p_wild_per_cell_per_respin <= 1.0):
            raise ValueError(
                f"p_wild_per_cell_per_respin "
                f"{self.p_wild_per_cell_per_respin} outside [0,1]"
            )
        if self.initial_wilds < 0 or self.initial_wilds > self.n_cells:
            raise ValueError(
                f"initial_wilds {self.initial_wilds} outside [0, n_cells]"
            )
        if not self.pay_per_wild_count:
            raise ValueError("pay_per_wild_count must be non-empty")
        for k, p in self.pay_per_wild_count.items():
            if k < 0:
                raise ValueError(f"pay_per_wild_count key {k} must be ≥ 0")
            if p < 0:
                raise ValueError(f"pay_per_wild_count value {p} must be ≥ 0")


def _wild_count_distribution_at_respin(
    params: StickyWildsParams,
) -> list[list[float]]:
    """Computes P(W_t = k) for t=0..n_respins, k=0..n_cells via DP.

    State: probs[k] = P(k wilds on grid). Initial: P(initial_wilds) = 1.

    Transition: from k wilds, (n_cells - k) cells are non-locked. Each
    independently lands a wild with prob p. Number of new wilds is
    Binomial(n_cells - k, p). New k' = k + new wilds. Cap at n_cells.

    Returns list of distributions, one per respin.
    """
    n = params.n_cells
    p = params.p_wild_per_cell_per_respin
    n_respins = params.n_respins

    # Initial distribution at respin t=0 (BEFORE any respin)
    initial = [0.0] * (n + 1)
    initial[params.initial_wilds] = 1.0

    distributions = [initial]
    current = initial
    for _ in range(n_respins):
        new_dist = [0.0] * (n + 1)
        for k in range(n + 1):
            pk = current[k]
            if pk == 0.0:
                continue
            cells_open = n - k
            if cells_open == 0:
                # All cells locked; no transition
                new_dist[k] += pk
                continue
            # Binomial PMF for new wilds, m=0..cells_open
            q = 1.0 - p
            pmf = q ** cells_open  # m = 0
            new_dist[k] += pk * pmf  # k stays
            for m in range(1, cells_open + 1):
                # PMF(m) / PMF(m-1) = (cells_open - m + 1)/m × p/q
                if q == 0:
                    pmf = 1.0 if m == cells_open else 0.0
                else:
                    pmf *= (cells_open - m + 1) / m * (p / q)
                new_k = min(k + m, n)
                new_dist[new_k] += pk * pmf
        distributions.append(new_dist)
        current = new_dist
    return distributions


def expected_wilds_per_respin(params: StickyWildsParams) -> list[float]:
    """E[W_t] for t=1..n_respins (1-indexed)."""
    dists = _wild_count_distribution_at_respin(params)
    # Drop t=0 (initial state before any respin); return t=1..n_respins
    return [
        sum(k * dist[k] for k in range(len(dist)))
        for dist in dists[1:]
    ]


def expected_pay_per_chain(params: StickyWildsParams) -> float:
    """E[total pay × bet | one trigger]."""
    dists = _wild_count_distribution_at_respin(params)
    total = 0.0
    for t in range(1, params.n_respins + 1):
        dist = dists[t]
        for k, prob in enumerate(dist):
            if prob == 0.0:
                continue
            pay = params.pay_per_wild_count.get(k, 0.0)
            total += prob * pay
    return total


def sticky_wilds_rtp(params: StickyWildsParams) -> dict:
    """Per-base-spin RTP + per-respin breakdown."""
    e_pay = expected_pay_per_chain(params)
    rtp = params.trigger_p * e_pay
    e_wilds_per_t = expected_wilds_per_respin(params)
    return {
        "rtp_contribution": rtp,
        "trigger_p": params.trigger_p,
        "n_respins": params.n_respins,
        "n_cells": params.n_cells,
        "p_wild_per_cell_per_respin": params.p_wild_per_cell_per_respin,
        "initial_wilds": params.initial_wilds,
        "expected_wilds_per_respin": e_wilds_per_t,
        "expected_pay_per_chain_x_bet": e_pay,
    }
