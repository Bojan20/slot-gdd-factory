"""W244 wave 17 — closed-form analytical model for `state_machine` (supermeter).

Industry pattern (Stakelogic Supermeter, Pragmatic Power of Thor mode switch,
Big Bass Splash multi-mode FS, Aristocrat Buffalo Stampede tier escalation):

  Slot game has a persistent state (e.g. `base | super | mega`) that
  transitions according to a Markov chain. Each state has:

    * Its own per-spin RTP component (different paytable / wild weights)
    * Outgoing transitions to other states with probability `p_transition`

  Examples:
    * Supermeter: base state with rare upgrade to super mode (3× RTP),
      eventually drops back to base after configured spins.
    * Mode switch: base / fury mode toggle on landed scatter; fury has
      higher hit_freq but lower max win.

  Closed-form RTP contribution
  ----------------------------
    Stacionary distribution of the Markov chain × per-state RTP, by
    ergodic theorem:

        RTP_total = sum_states(π_s × rtp_s)

    where π is the stationary distribution of the transition matrix P:

        π = π × P   (left-eigenvector with eigenvalue 1)
        sum(π) = 1

  Computation
  -----------
    For small state spaces (3-5 states typical), we solve the linear
    system directly: (P^T - I) π = 0  with normalization sum(π) = 1.

    Pure-stdlib Gaussian elimination (no numpy dependency).

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_state_machine_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_state_machine_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GameState:
    """One state of the slot's state machine."""
    name: str                        # "base" | "super" | "mega" | "fury"
    rtp_component: float             # per-spin RTP when in this state

    def __post_init__(self):
        if not self.name:
            raise ValueError("state name must be non-empty")
        if self.rtp_component < 0:
            raise ValueError("rtp_component must be ≥ 0")


@dataclass(frozen=True)
class StateMachineParams:
    """Closed-form model inputs."""
    states: tuple[GameState, ...]
    # Transition matrix: transitions[from_idx][to_idx] = probability.
    # Rows must sum to 1.0 (stochastic).
    transitions: tuple[tuple[float, ...], ...]

    def __post_init__(self):
        n = len(self.states)
        if n == 0:
            raise ValueError("states must be non-empty")
        if len(self.transitions) != n:
            raise ValueError(
                f"transitions has {len(self.transitions)} rows, expected {n}"
            )
        for i, row in enumerate(self.transitions):
            if len(row) != n:
                raise ValueError(
                    f"transitions row {i} has {len(row)} entries, expected {n}"
                )
            row_sum = sum(row)
            if abs(row_sum - 1.0) > 1e-9:
                raise ValueError(
                    f"transitions row {i} sums to {row_sum}, expected 1.0"
                )
            if any(p < 0 for p in row):
                raise ValueError(f"transitions row {i} has negative probability")


def stationary_distribution(params: StateMachineParams) -> tuple[float, ...]:
    """Solve π × P = π with sum(π) = 1 via Gaussian elimination on (P^T - I).

    Replaces last row with sum-to-1 constraint and RHS = [0, ..., 0, 1].
    """
    n = len(params.states)
    # Build augmented matrix A | b where A is (P^T - I) with last row replaced.
    A = [[0.0] * n for _ in range(n)]
    b = [0.0] * n
    for i in range(n - 1):
        for j in range(n):
            A[i][j] = params.transitions[j][i]  # P^T element
        A[i][i] -= 1.0
        # b[i] = 0 already
    # Last row: sum(π) = 1
    for j in range(n):
        A[n - 1][j] = 1.0
    b[n - 1] = 1.0

    # Gaussian elimination with partial pivoting
    for i in range(n):
        # Find pivot
        pivot_row = i
        max_val = abs(A[i][i])
        for k in range(i + 1, n):
            if abs(A[k][i]) > max_val:
                max_val = abs(A[k][i])
                pivot_row = k
        if max_val < 1e-15:
            raise ValueError(
                "Transition matrix is singular (no unique stationary distribution)"
            )
        # Swap rows
        A[i], A[pivot_row] = A[pivot_row], A[i]
        b[i], b[pivot_row] = b[pivot_row], b[i]
        # Eliminate below
        for k in range(i + 1, n):
            factor = A[k][i] / A[i][i]
            for j in range(i, n):
                A[k][j] -= factor * A[i][j]
            b[k] -= factor * b[i]

    # Back-substitution
    pi = [0.0] * n
    for i in range(n - 1, -1, -1):
        s = b[i]
        for j in range(i + 1, n):
            s -= A[i][j] * pi[j]
        pi[i] = s / A[i][i]

    # Numerical cleanup: clamp tiny negatives to 0 + renormalize
    pi = [max(0.0, x) for x in pi]
    total = sum(pi)
    if total <= 0:
        raise ValueError("computed stationary distribution sums to ≤ 0")
    pi = [x / total for x in pi]
    return tuple(pi)


def state_machine_rtp(params: StateMachineParams) -> dict:
    """Per-spin RTP contribution + per-state breakdown."""
    pi = stationary_distribution(params)
    per_state = []
    total_rtp = 0.0
    for s, prob in zip(params.states, pi):
        contrib = prob * s.rtp_component
        per_state.append({
            "name": s.name,
            "stationary_probability": prob,
            "rtp_component_in_state": s.rtp_component,
            "weighted_rtp_contribution": contrib,
        })
        total_rtp += contrib
    return {
        "rtp_contribution": total_rtp,
        "states_count": len(params.states),
        "stationary_distribution": list(pi),
        "states": per_state,
    }
