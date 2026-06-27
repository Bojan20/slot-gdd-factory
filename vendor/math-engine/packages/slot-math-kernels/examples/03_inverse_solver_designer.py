"""Example 3 — Designer auto-resolve via Newton-Raphson 1-D.

Pattern: Given a target RTP and a closed-form math function (+ its
gradient), solve for the free parameter that hits the target. Used in
math design to tune `trigger_probability` or `award_value` without
manual binary-search.

Industry references: every math designer's spreadsheet has manual
Goal-Seek; this kernel formalizes it as deterministic Newton-Raphson +
bisection-fallback.
"""
from slot_math_kernels import inverse_solver as solver

# Tune feature trigger probability p so that p × 100 = 0.5 RTP target.
# Analytic answer: p = 0.005.
def rtp(p):
    return p * 100.0

def grad(p):
    return 100.0

result = solver.newton_raphson_1d(
    rtp_func=rtp, gradient_func=grad,
    target_rtp=0.50, initial_guess=0.01,
    tolerance=1e-9, max_iterations=20,
    param_lo=0.0, param_hi=1.0,
)
print(f"Solved p:         {result.final_param:.6f}")
print(f"Final RTP:        {result.final_rtp:.6f}")
print(f"Iterations:       {result.iterations}")
print(f"Converged:        {result.converged}")
assert result.converged
assert abs(result.final_param - 0.005) < 1e-9
print("✓ Newton-Raphson hit analytic p=0.005 within 1e-9")

# Bisection fallback — slower but robust if gradient is unavailable.
print()
result_bi = solver.bisection_1d(
    rtp_func=rtp, target_rtp=0.50,
    param_lo=0.0, param_hi=1.0,
    tolerance=1e-9, max_iterations=60,
)
print(f"Bisection p:      {result_bi.final_param:.6f}")
print(f"Bisection iters:  {result_bi.iterations}")
print(f"Bisection conv:   {result_bi.converged}")
