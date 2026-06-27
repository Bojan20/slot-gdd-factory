"""W244 wave 10 — closed-form analytical model for `money_collect` feature.

Industry pattern (Cash Eruption / BTG Money Train / Pragmatic Coin Volcano):

  Trigger
  -------
    Initial spin lands ≥ trigger_count_min money symbols (and any non-money
    paid wins are evaluated as normal). Triggering re-flips reels into a
    "cash bonus" mode where:

      * Money symbols already on the grid LOCK in place with their value.
      * `money_respins_reset` (typical 3) respins are awarded.
      * Each subsequent respin: every new money symbol that lands also LOCKS
        and RESETS the respin counter to `money_respins_reset`.
      * Episode ends when:
          (a) `money_respins_reset` consecutive spins land no new money
              symbols, OR
          (b) the grid fills up (`money_grid_cap` total locked symbols).

  Payout
  ------
    Final award = SUM(value_x_bet over all locked symbols) × bet.
    Each money symbol's value drawn IID from `money_value_weights`
    distribution (a {value × bet : weight} table — e.g. {1:50, 2:30, 5:15,
    10:5} normalised internally).

Closed-form RTP component
-------------------------
This module computes the *expected* per-spin money_collect contribution
to total RTP, given:

  * `p_per_cell` — probability a single grid cell shows money on a respin
    (estimated from money symbol reel-weight share).
  * `n_cells`   — grid size (e.g. 15 for 5×3, 24 for 6×4, 20 for ways).
  * `trigger_p` — initial-spin trigger probability (≥ trigger_count_min
    money symbols out of `n_cells` Bernoulli trials).
  * `value_table` — normalised {value_x_bet : prob}.
  * `respins_reset` — typical 3.
  * `grid_cap` — full-grid stopping rule.

  Per-spin RTP (money_collect component) =
      trigger_p × E[total_money_value_per_episode]

  where E[total_money_value_per_episode] is a Markov chain over
  (k_locked, respins_remaining) — analytic via dynamic-programming on the
  state space.

The DP runs in O(grid_cap × respins_reset) state transitions which is
typically < 100 — sub-millisecond regardless of `n_cells`.

This module is pure-stdlib and used by:
  * `tools.math_dsl.compile` — emits IR with `meta.rtp_breakdown.money_collect`
  * `tools.math_dsl.verify` — re-validates committed `essentials.json`
  * `tools/tests/test_w244_money_collect_kernel.py` — acceptance suite
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MoneyCollectParams:
    """Closed-form model inputs."""
    p_per_cell: float                # P(money symbol on a grid cell, per spin)
    n_cells: int                     # total grid cells (e.g. 15 for 5×3)
    trigger_count_min: int           # ≥N money on initial spin → trigger
    value_table: dict[float, float]  # {value_x_bet: weight} — unnormalised OK
    respins_reset: int = 3           # respin pool size, default 3
    grid_cap: int | None = None      # absolute cap; defaults to n_cells

    def __post_init__(self):
        if not (0.0 <= self.p_per_cell <= 1.0):
            raise ValueError(f"p_per_cell {self.p_per_cell} outside [0,1]")
        if self.n_cells < 1:
            raise ValueError(f"n_cells {self.n_cells} < 1")
        if self.trigger_count_min < 1:
            raise ValueError("trigger_count_min must be ≥ 1")
        if self.respins_reset < 1:
            raise ValueError("respins_reset must be ≥ 1")
        if not self.value_table:
            raise ValueError("value_table must be non-empty")
        if any(w < 0 for w in self.value_table.values()):
            raise ValueError("value_table weights must be ≥ 0")


def _normalize_value_table(table: dict[float, float]) -> dict[float, float]:
    """Convert {value: weight} → {value: probability}."""
    total = sum(table.values())
    if total <= 0:
        raise ValueError("value_table sum-of-weights must be > 0")
    return {v: w / total for v, w in table.items()}


def expected_money_value(value_table: dict[float, float]) -> float:
    """E[V] where V is one money symbol's value × bet (normalised table)."""
    probs = _normalize_value_table(value_table)
    return sum(v * p for v, p in probs.items())


def initial_trigger_probability(
    p_per_cell: float,
    n_cells: int,
    trigger_count_min: int,
) -> float:
    """P(≥ trigger_count_min money symbols on initial spin).

    Binomial CDF tail: 1 - F(trigger_count_min - 1; n_cells, p_per_cell).
    """
    if trigger_count_min > n_cells:
        return 0.0
    # Binomial PMF via stable iterative product (Python ints — exact).
    # P(X = k) = C(n,k) * p^k * (1-p)^(n-k)
    q = 1.0 - p_per_cell
    cdf_below = 0.0
    # C(n, 0) = 1
    pmf = q ** n_cells  # k = 0 term
    cdf_below += pmf
    for k in range(1, trigger_count_min):
        # PMF(k) / PMF(k-1) = (n-k+1)/k * p/q
        pmf *= (n_cells - k + 1) / k * (p_per_cell / q) if q > 0 else 0.0
        cdf_below += pmf
    return max(0.0, 1.0 - cdf_below)


def expected_episode_total_value(
    params: MoneyCollectParams,
    initial_locked_mean: float | None = None,
) -> float:
    """E[total_money_value_per_episode | trigger].

    Models the (k_locked, respins_remaining) Markov chain. Episode terminates
    when respins_remaining hits 0 OR k_locked equals grid_cap.

    Per respin:
      * `cells_open = n_cells - k_locked`
      * Each open cell lands money with prob `p_per_cell`.
      * Let m = number of new money on this respin (Binomial(cells_open, p)).
      * If m > 0: k_locked += m, respins_remaining = respins_reset (RESET).
      * If m == 0: respins_remaining -= 1.

    Each newly-locked symbol's value is drawn IID from value_table; episode
    value = (k_locked at termination) × E[V].

    Args:
      params: model inputs.
      initial_locked_mean: E[k_locked at start of bonus | trigger].
        If None, defaults to trigger_count_min (conservative — assumes the
        episode starts with the minimum trigger count, which underestimates
        slightly when triggers come with more than the minimum).
    """
    grid_cap = params.grid_cap or params.n_cells
    if initial_locked_mean is None:
        initial_locked_mean = float(params.trigger_count_min)

    # DP over (k_locked, respins_remaining). We compute the EXPECTED
    # number of locked symbols at termination, then multiply by E[V].
    # State value e_state[k][r] = expected k_locked at termination given
    # we're currently at (k, r). Terminal states: r == 0 OR k == grid_cap.
    n_cells = params.n_cells
    R = params.respins_reset
    p = params.p_per_cell

    # Build state table. k ∈ [0, grid_cap], r ∈ [0, R].
    # Iterate by descending r (since transitions only decrease r OR jump up to R).
    # Actually transitions on m>0 jump r → R, on m==0 r → r-1. So we can
    # do fixed-point iteration over the (k,r) grid.
    e = [[0.0] * (R + 1) for _ in range(grid_cap + 1)]

    # Terminal: r == 0 → e[k][0] = k. k == grid_cap → e[grid_cap][r] = grid_cap.
    for k in range(grid_cap + 1):
        e[k][0] = float(k)
    for r in range(R + 1):
        e[grid_cap][r] = float(grid_cap)

    # Fixed-point: iterate until convergence (typically 2-3 sweeps for these
    # parameters since R ≤ 3 and grid_cap ≤ 25).
    for _ in range(50):
        max_delta = 0.0
        for r in range(1, R + 1):
            for k in range(grid_cap):  # k < grid_cap (terminal handled above)
                cells_open = n_cells - k
                if cells_open <= 0:
                    continue
                # E[next state | (k, r)] = sum_m P(m | cells_open, p) * e[k+m][r' (depends on m)]
                # where r' = R if m > 0 else r - 1.
                exp_next = 0.0
                # m = 0 term: P(no money) = (1-p)^cells_open, transition (k, r-1).
                p_zero = (1 - p) ** cells_open
                exp_next += p_zero * e[k][r - 1]
                # m >= 1 terms: build PMF iteratively.
                # PMF(m=1) = cells_open * p * (1-p)^(cells_open-1)
                pmf_m = p_zero  # tracks PMF(m=0)
                q = 1 - p
                for m in range(1, cells_open + 1):
                    # PMF(m) / PMF(m-1) = (cells_open - m + 1)/m * p/q
                    if q == 0:
                        # p == 1 edge case
                        pmf_m = 1.0 if m == cells_open else 0.0
                    else:
                        pmf_m *= (cells_open - m + 1) / m * (p / q)
                    next_k = min(k + m, grid_cap)
                    next_r = R  # money landed → reset
                    exp_next += pmf_m * e[next_k][next_r]
                delta = abs(exp_next - e[k][r])
                if delta > max_delta:
                    max_delta = delta
                e[k][r] = exp_next
        if max_delta < 1e-12:
            break

    # Start state: (initial_locked_mean, R). Linear interpolation if not integer.
    k_lo = int(initial_locked_mean)
    k_hi = min(k_lo + 1, grid_cap)
    frac = initial_locked_mean - k_lo
    expected_k = (1 - frac) * e[k_lo][R] + frac * e[k_hi][R]
    return expected_k * expected_money_value(params.value_table)


def money_collect_rtp_contribution(
    params: MoneyCollectParams,
) -> dict:
    """High-level: total per-spin RTP contribution + intermediate values.

    Returns a dict with `trigger_p`, `expected_value_per_money`,
    `expected_total_per_episode`, `rtp_contribution`, and the input
    snapshot for audit.
    """
    trig_p = initial_trigger_probability(
        params.p_per_cell, params.n_cells, params.trigger_count_min
    )
    e_v = expected_money_value(params.value_table)
    e_total = expected_episode_total_value(params)
    rtp = trig_p * e_total
    return {
        "trigger_p": trig_p,
        "expected_value_per_money": e_v,
        "expected_total_per_episode": e_total,
        "rtp_contribution": rtp,
        "params": {
            "p_per_cell": params.p_per_cell,
            "n_cells": params.n_cells,
            "trigger_count_min": params.trigger_count_min,
            "respins_reset": params.respins_reset,
            "grid_cap": params.grid_cap or params.n_cells,
            "value_table": dict(params.value_table),
        },
    }
