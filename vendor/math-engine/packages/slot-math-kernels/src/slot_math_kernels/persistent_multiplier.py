"""W244 wave 19 — closed-form analytical model for `persistent_multiplier`.

Industry pattern (Quickspin Sticky Bandits, Pragmatic Mighty Wild,
NetEnt Money Vault FS, ELK Bompergo escalator, BTG Extra Chilli mega
multiplier):

  Multiplier dynamics during FS
  ----------------------------
    Multiplier starts at `initial_multiplier` (typical 1×) and persists
    across FS spins. On each FS spin, with probability `p_bump_per_spin`
    the multiplier increases by `bump_increment` (typical +1). Multiplier
    optionally capped at `max_multiplier`.

    Final per-FS-spin base award is multiplied by the CURRENT multiplier
    at spin time.

  Closed-form RTP contribution
  ----------------------------
    Per-FS-spin pay (without multiplier): `base_pay_per_spin_x_bet`.

    Multiplier path across FS:
      m_t = initial + (bump_increment × #_bumps_so_far)
      bumps_so_far ∼ Binomial(t-1, p_bump_per_spin) on spin t.

    E[multiplier on spin t] = initial + bump_increment × (t-1) × p_bump
      capped at max_multiplier.

    Total FS award:
      E[fs_total] = base_pay × sum_t E[multiplier_t]

    For uncapped:
      sum_t E[multiplier_t] = T × initial +
                              bump × p_bump × T × (T-1) / 2

    For capped: piecewise — analytical up to cap-hit spin, then constant.
    We use exact DP over multiplier state for tractable cap.

  Per-base-spin RTP
  -----------------
    RTP[persistent_multiplier_FS] = fs_trigger_p × E[fs_total]

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_persistent_multiplier_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_persistent_multiplier_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PersistentMultiplierParams:
    """Closed-form model inputs."""
    fs_trigger_p: float                      # P(FS triggers per base spin)
    fs_initial_spins: int                    # typical 10
    base_pay_per_spin_x_bet: float           # avg per-FS-spin pay (no mult)
    initial_multiplier: float = 1.0          # starting multiplier
    bump_increment: float = 1.0              # per-bump increment
    p_bump_per_spin: float = 0.30            # P(bump) per FS spin
    max_multiplier: float | None = None      # None = uncapped

    def __post_init__(self):
        if not (0.0 <= self.fs_trigger_p <= 1.0):
            raise ValueError(f"fs_trigger_p {self.fs_trigger_p} outside [0,1]")
        if self.fs_initial_spins < 1:
            raise ValueError("fs_initial_spins must be ≥ 1")
        if self.base_pay_per_spin_x_bet < 0:
            raise ValueError("base_pay_per_spin_x_bet must be ≥ 0")
        if self.initial_multiplier < 0:
            raise ValueError("initial_multiplier must be ≥ 0")
        if self.bump_increment < 0:
            raise ValueError("bump_increment must be ≥ 0")
        if not (0.0 <= self.p_bump_per_spin <= 1.0):
            raise ValueError(
                f"p_bump_per_spin {self.p_bump_per_spin} outside [0,1]"
            )
        if self.max_multiplier is not None and (
            self.max_multiplier < self.initial_multiplier
        ):
            raise ValueError(
                f"max_multiplier {self.max_multiplier} must exceed "
                f"initial_multiplier {self.initial_multiplier}"
            )


def expected_multiplier_at_spin(params: PersistentMultiplierParams, t: int) -> float:
    """E[multiplier on FS spin t (1-indexed)], with cap.

    Without cap:
      E[m_t] = initial + bump × p_bump × (t - 1)

    With cap: clamp expectation at max_multiplier (approximation — exact
    handling requires per-bump-count DP since cap-hitting flips the bump
    distribution. We use the exact DP via `_dp_multiplier_path` for
    SUM aggregate; per-spin expectation here is a fast approximation).
    """
    e_m = params.initial_multiplier + params.bump_increment * params.p_bump_per_spin * (t - 1)
    if params.max_multiplier is not None:
        e_m = min(e_m, params.max_multiplier)
    return e_m


def _dp_multiplier_path(params: PersistentMultiplierParams) -> list[float]:
    """Exact DP: E[multiplier_t] for t=1..T accounting for cap.

    State: distribution over multiplier values at spin t. Bump operation
    advances multiplier deterministically by `bump_increment` if bump
    fires, else stays. Cap clamps any value at max_multiplier.

    For tractability, we discretize: multiplier values fall on grid
    `initial + k × bump_increment` for k in [0, K_max] where K_max =
    max_bumps_before_cap.
    """
    initial = params.initial_multiplier
    bump = params.bump_increment
    cap = params.max_multiplier
    p = params.p_bump_per_spin
    T = params.fs_initial_spins

    # Determine grid size K (number of bumps before hitting cap)
    if cap is not None and bump > 0:
        K = int((cap - initial) // bump)
        if initial + K * bump > cap + 1e-9:
            K -= 1
    else:
        K = T  # at most T bumps over T spins

    # State vector: probs[k] = P(k bumps so far)
    # Initial: 0 bumps before spin 1
    probs = [0.0] * (K + 1)
    probs[0] = 1.0

    e_per_spin: list[float] = []
    for _ in range(T):
        # E[multiplier this spin] = sum_k probs[k] × m_k (capped)
        e_m = 0.0
        for k, pk in enumerate(probs):
            m = initial + k * bump
            if cap is not None:
                m = min(m, cap)
            e_m += pk * m
        e_per_spin.append(e_m)

        # Advance: each k → with prob (1-p) stay, with prob p go k+1
        new_probs = [0.0] * (K + 1)
        for k, pk in enumerate(probs):
            if k == K:
                # at cap, can't go higher → stays
                new_probs[k] += pk
            else:
                new_probs[k] += pk * (1 - p)
                new_probs[k + 1] += pk * p
        probs = new_probs

    return e_per_spin


def expected_fs_total(params: PersistentMultiplierParams) -> float:
    """E[total FS award × bet] across all FS spins (cap-aware DP)."""
    e_per_spin = _dp_multiplier_path(params)
    sum_e_mult = sum(e_per_spin)
    return params.base_pay_per_spin_x_bet * sum_e_mult


def persistent_multiplier_rtp(params: PersistentMultiplierParams) -> dict:
    """Per-base-spin RTP + audit breakdown."""
    e_per_spin = _dp_multiplier_path(params)
    e_total = params.base_pay_per_spin_x_bet * sum(e_per_spin)
    rtp = params.fs_trigger_p * e_total
    return {
        "rtp_contribution": rtp,
        "fs_trigger_p": params.fs_trigger_p,
        "fs_initial_spins": params.fs_initial_spins,
        "base_pay_per_spin_x_bet": params.base_pay_per_spin_x_bet,
        "initial_multiplier": params.initial_multiplier,
        "bump_increment": params.bump_increment,
        "p_bump_per_spin": params.p_bump_per_spin,
        "max_multiplier": params.max_multiplier,
        "expected_multiplier_per_spin": list(e_per_spin),
        "average_multiplier": sum(e_per_spin) / len(e_per_spin),
        "expected_fs_total_x_bet": e_total,
    }
