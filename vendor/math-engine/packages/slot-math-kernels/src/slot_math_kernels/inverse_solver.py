"""W244 wave 32 — Newton-Raphson inverse solver for W244 kernels.

Designer workflow:
  Input:  target_rtp + kernel + fixed parameters
  Output: value of free parameter that achieves target

Replaces hand-tuning of reel weights / probabilities / pay tables with
analytic Newton-Raphson iteration. Sub-millisecond convergence in 3-8
iterations for well-conditioned kernels.

Composes with `tools.math_dsl.symbolic_gradient` for the derivative.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class SolveResult:
    """One Newton-Raphson run outcome."""
    converged: bool
    iterations: int
    final_param: float
    final_rtp: float
    error: float
    target_rtp: float
    history: tuple[tuple[float, float], ...]  # (param, rtp) per iter


def newton_raphson_1d(
    rtp_func: Callable[[float], float],
    gradient_func: Callable[[float], float],
    target_rtp: float,
    initial_guess: float,
    *,
    tolerance: float = 1e-4,
    max_iterations: int = 30,
    param_lo: float = 0.0,
    param_hi: float = 1.0,
) -> SolveResult:
    """1-D Newton-Raphson: find param such that rtp_func(param) = target.

    Iteration: param ← param - (rtp - target) / gradient
    Bounded clamping: param stays in [param_lo, param_hi].

    Args:
      rtp_func:       maps param → rtp
      gradient_func:  maps param → ∂rtp/∂param (analytic or numerical)
      target_rtp:     RTP value to hit
      initial_guess:  starting parameter value
      tolerance:      |rtp - target| ≤ tol → converged
      max_iterations: hard cap
      param_lo/hi:    bracket for parameter
    """
    param = initial_guess
    history: list[tuple[float, float]] = []
    for i in range(max_iterations):
        rtp = rtp_func(param)
        history.append((param, rtp))
        error = abs(rtp - target_rtp)
        if error < tolerance:
            return SolveResult(
                converged=True,
                iterations=i + 1,
                final_param=param,
                final_rtp=rtp,
                error=error,
                target_rtp=target_rtp,
                history=tuple(history),
            )
        grad = gradient_func(param)
        if abs(grad) < 1e-15:
            # Stuck — gradient too small, can't progress
            break
        # Newton step
        delta = (rtp - target_rtp) / grad
        new_param = param - delta
        # Clamp to bracket
        new_param = max(param_lo, min(param_hi, new_param))
        if new_param == param:
            # Hit bracket boundary without convergence
            break
        param = new_param

    # Didn't converge within max_iterations
    rtp = rtp_func(param)
    return SolveResult(
        converged=False,
        iterations=len(history),
        final_param=param,
        final_rtp=rtp,
        error=abs(rtp - target_rtp),
        target_rtp=target_rtp,
        history=tuple(history),
    )


def bisection_1d(
    rtp_func: Callable[[float], float],
    target_rtp: float,
    *,
    param_lo: float = 0.0,
    param_hi: float = 1.0,
    tolerance: float = 1e-4,
    max_iterations: int = 50,
) -> SolveResult:
    """Robust bisection fallback (no gradient needed).

    Assumes rtp_func is monotonically increasing in param OR detects
    direction from endpoints. Useful when gradient is unreliable or
    kernel is non-smooth at boundaries.
    """
    lo = param_lo
    hi = param_hi
    rtp_lo = rtp_func(lo)
    rtp_hi = rtp_func(hi)
    history: list[tuple[float, float]] = [(lo, rtp_lo), (hi, rtp_hi)]

    # Detect direction
    increasing = rtp_hi >= rtp_lo

    # Bracket check
    if increasing:
        if not (rtp_lo <= target_rtp <= rtp_hi):
            return SolveResult(
                converged=False, iterations=2,
                final_param=lo if target_rtp < rtp_lo else hi,
                final_rtp=rtp_lo if target_rtp < rtp_lo else rtp_hi,
                error=min(abs(target_rtp - rtp_lo), abs(target_rtp - rtp_hi)),
                target_rtp=target_rtp,
                history=tuple(history),
            )
    else:
        if not (rtp_hi <= target_rtp <= rtp_lo):
            return SolveResult(
                converged=False, iterations=2,
                final_param=lo if target_rtp > rtp_lo else hi,
                final_rtp=rtp_lo if target_rtp > rtp_lo else rtp_hi,
                error=min(abs(target_rtp - rtp_lo), abs(target_rtp - rtp_hi)),
                target_rtp=target_rtp,
                history=tuple(history),
            )

    for i in range(max_iterations):
        mid = (lo + hi) / 2
        rtp_mid = rtp_func(mid)
        history.append((mid, rtp_mid))
        error = abs(rtp_mid - target_rtp)
        if error < tolerance:
            return SolveResult(
                converged=True,
                iterations=len(history),
                final_param=mid,
                final_rtp=rtp_mid,
                error=error,
                target_rtp=target_rtp,
                history=tuple(history),
            )
        if (increasing and rtp_mid < target_rtp) or (not increasing and rtp_mid > target_rtp):
            lo, rtp_lo = mid, rtp_mid
        else:
            hi, rtp_hi = mid, rtp_mid

    # Didn't converge
    mid = (lo + hi) / 2
    return SolveResult(
        converged=False,
        iterations=len(history),
        final_param=mid,
        final_rtp=rtp_func(mid),
        error=abs(rtp_func(mid) - target_rtp),
        target_rtp=target_rtp,
        history=tuple(history),
    )
