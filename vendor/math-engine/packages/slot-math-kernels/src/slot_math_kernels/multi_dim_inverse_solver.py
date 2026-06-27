"""W244 wave 42 — multi-dimensional Newton-Raphson inverse solver.

Extends `inverse_solver.py` from 1-D to N-D: solve for a parameter
vector `θ = (θ₁, …, θₙ)` such that `f(θ) = target` where `f: R^n → R^n`.

  Newton step:
    θ_{k+1} = θ_k − J⁻¹(θ_k) · (f(θ_k) − target)

  Jacobian J is supplied by the caller (analytic) OR computed via
  central-difference fallback. Linear solve uses pure-stdlib Gauss
  elimination with partial pivoting (no numpy / scipy dep).

Designer workflow:
  Multi-knob calibration: hit TWO simultaneous targets, e.g.
  (target_rtp = 0.96, target_hit_freq = 0.3) by solving for
  (volatility_param, win_density_param). 3-D / 4-D commonly arises
  when balancing RTP × hit_freq × max_win × volatility.

Pure-stdlib. Used by:
  * Multi-objective auto-calibration in `tools/calibrate/multi.py`
  * `tools/tests/test_w244_multi_dim_inverse_solver.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class MultiDimSolveResult:
    """N-D Newton-Raphson run outcome."""
    converged: bool
    iterations: int
    final_params: tuple[float, ...]
    final_residual: tuple[float, ...]
    final_norm: float
    target: tuple[float, ...]


def _gauss_solve(A: list[list[float]], b: list[float]) -> list[float]:
    """Solve `A x = b` via in-place Gauss elimination + back substitution.

    A is n×n (mutated), b is length-n (mutated). Returns x of length n.
    Partial pivoting for numerical stability. Singular matrix → ValueError.
    """
    n = len(b)
    # Build augmented [A | b]
    aug = [list(row) + [b[i]] for i, row in enumerate(A)]
    # Forward elimination with partial pivoting
    for k in range(n):
        # Pivot — find row with max |aug[r][k]| for r ≥ k
        pivot_row = max(range(k, n), key=lambda r: abs(aug[r][k]))
        if abs(aug[pivot_row][k]) < 1e-15:
            raise ValueError(f"singular matrix at column {k}")
        if pivot_row != k:
            aug[k], aug[pivot_row] = aug[pivot_row], aug[k]
        # Eliminate below
        for r in range(k + 1, n):
            factor = aug[r][k] / aug[k][k]
            for c in range(k, n + 1):
                aug[r][c] -= factor * aug[k][c]
    # Back substitution
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        s = aug[i][n]
        for j in range(i + 1, n):
            s -= aug[i][j] * x[j]
        x[i] = s / aug[i][i]
    return x


def _norm(v: list[float] | tuple[float, ...]) -> float:
    """L2 norm — sqrt(sum(v_i²))."""
    s = 0.0
    for x in v:
        s += x * x
    return s ** 0.5


def _numerical_jacobian(
    f: Callable[[tuple[float, ...]], tuple[float, ...]],
    theta: tuple[float, ...],
    h: float = 1e-6,
) -> list[list[float]]:
    """Central-difference Jacobian fallback. Returns n×n matrix."""
    n = len(theta)
    J: list[list[float]] = [[0.0] * n for _ in range(n)]
    for j in range(n):
        theta_plus = list(theta)
        theta_plus[j] += h
        theta_minus = list(theta)
        theta_minus[j] -= h
        f_plus = f(tuple(theta_plus))
        f_minus = f(tuple(theta_minus))
        for i in range(n):
            J[i][j] = (f_plus[i] - f_minus[i]) / (2.0 * h)
    return J


def newton_raphson_nd(
    f: Callable[[tuple[float, ...]], tuple[float, ...]],
    target: tuple[float, ...],
    initial_guess: tuple[float, ...],
    *,
    jacobian: Callable[[tuple[float, ...]], list[list[float]]] | None = None,
    tolerance: float = 1e-4,
    max_iterations: int = 30,
    bounds: tuple[tuple[float, float], ...] | None = None,
    damping: float = 1.0,
) -> MultiDimSolveResult:
    """N-D Newton-Raphson.

    Args:
      f:             maps θ ∈ R^n → result ∈ R^n
      target:        the value we want f(θ) to reach
      initial_guess: starting θ
      jacobian:      analytic Jacobian (n×n). If None, central-diff fallback.
      tolerance:     ‖f(θ) − target‖₂ < tol → converged
      max_iterations: hard cap
      bounds:        optional (lo, hi) per dimension; θ is clamped
      damping:       step multiplier ∈ (0, 1]; 1.0 = pure Newton.
                     < 1 = damped Newton (more robust on poorly conditioned J).
    """
    if len(target) != len(initial_guess):
        raise ValueError(
            f"target dim {len(target)} != initial_guess dim {len(initial_guess)}"
        )
    n = len(target)
    if bounds is not None and len(bounds) != n:
        raise ValueError(f"bounds dim {len(bounds)} != target dim {n}")
    if not (0.0 < damping <= 1.0):
        raise ValueError(f"damping {damping} outside (0, 1]")

    theta = tuple(initial_guess)
    for it in range(max_iterations):
        fx = f(theta)
        residual = tuple(fx[i] - target[i] for i in range(n))
        norm = _norm(residual)
        if norm < tolerance:
            return MultiDimSolveResult(
                converged=True,
                iterations=it + 1,
                final_params=theta,
                final_residual=residual,
                final_norm=norm,
                target=target,
            )
        # Jacobian
        J = jacobian(theta) if jacobian else _numerical_jacobian(f, theta)
        # Newton step: solve J · delta = residual, theta_new = theta − damping × delta
        try:
            delta = _gauss_solve([row[:] for row in J], list(residual))
        except ValueError:
            # Singular Jacobian — break
            break
        new_theta = tuple(theta[i] - damping * delta[i] for i in range(n))
        # Clamp to bounds
        if bounds is not None:
            new_theta = tuple(
                max(bounds[i][0], min(bounds[i][1], new_theta[i]))
                for i in range(n)
            )
        if new_theta == theta:
            # Hit boundary or no progress
            break
        theta = new_theta

    fx = f(theta)
    residual = tuple(fx[i] - target[i] for i in range(n))
    return MultiDimSolveResult(
        converged=False,
        iterations=max_iterations,
        final_params=theta,
        final_residual=residual,
        final_norm=_norm(residual),
        target=target,
    )
