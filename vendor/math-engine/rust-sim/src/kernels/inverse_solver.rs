//! W244.32 — inverse_solver Rust port.
//!
//! Mirror of `tools/math_dsl/inverse_solver.py`. Two convergence
//! primitives:
//!   * `newton_raphson_1d` — quadratic convergence with analytic ∂rtp/∂param.
//!   * `bisection_1d`      — robust fallback (no gradient required).
//!
//! Designer workflow:
//!   Input:  target_rtp + kernel callable + fixed parameters
//!   Output: param value that achieves target (sub-millisecond, 3-8 iter)
//!
//! Closes W244 Rust port at 19/20 kernel implementations (only
//! `showcase_game` end-to-end driver remains).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SolveResult {
    pub converged: bool,
    pub iterations: usize,
    pub final_param: f64,
    pub final_rtp: f64,
    pub error: f64,
    pub target_rtp: f64,
    pub history: Vec<(f64, f64)>,
}

/// 1-D Newton-Raphson: find `param` such that `rtp_func(param) == target_rtp`.
///
/// Iteration: `param ← param − (rtp − target) / gradient`, clamped to
/// `[param_lo, param_hi]`.
pub fn newton_raphson_1d<F, G>(
    rtp_func: F,
    gradient_func: G,
    target_rtp: f64,
    initial_guess: f64,
    tolerance: f64,
    max_iterations: usize,
    param_lo: f64,
    param_hi: f64,
) -> SolveResult
where
    F: Fn(f64) -> f64,
    G: Fn(f64) -> f64,
{
    let mut param = initial_guess;
    let mut history: Vec<(f64, f64)> = Vec::with_capacity(max_iterations);
    for i in 0..max_iterations {
        let rtp = rtp_func(param);
        history.push((param, rtp));
        let error = (rtp - target_rtp).abs();
        if error < tolerance {
            return SolveResult {
                converged: true,
                iterations: i + 1,
                final_param: param,
                final_rtp: rtp,
                error,
                target_rtp,
                history,
            };
        }
        let grad = gradient_func(param);
        if grad.abs() < 1e-15 {
            // Stuck — gradient too small, can't progress.
            break;
        }
        let delta = (rtp - target_rtp) / grad;
        let new_param = (param - delta).max(param_lo).min(param_hi);
        if new_param == param {
            // Hit bracket boundary without convergence.
            break;
        }
        param = new_param;
    }
    let final_rtp = rtp_func(param);
    SolveResult {
        iterations: history.len(),
        final_param: param,
        final_rtp,
        error: (final_rtp - target_rtp).abs(),
        target_rtp,
        history,
        converged: false,
    }
}

/// 1-D bisection — gradient-free, robust to non-smooth kernels.
///
/// Auto-detects monotonic direction from endpoints; refuses to run if
/// target_rtp lies outside the bracket.
pub fn bisection_1d<F>(
    rtp_func: F,
    target_rtp: f64,
    param_lo: f64,
    param_hi: f64,
    tolerance: f64,
    max_iterations: usize,
) -> SolveResult
where
    F: Fn(f64) -> f64,
{
    let mut lo = param_lo;
    let mut hi = param_hi;
    let mut rtp_lo = rtp_func(lo);
    let mut rtp_hi = rtp_func(hi);
    let mut history: Vec<(f64, f64)> = vec![(lo, rtp_lo), (hi, rtp_hi)];

    let increasing = rtp_hi >= rtp_lo;

    // Bracket check
    let in_bracket = if increasing {
        rtp_lo <= target_rtp && target_rtp <= rtp_hi
    } else {
        rtp_hi <= target_rtp && target_rtp <= rtp_lo
    };
    if !in_bracket {
        let (best_param, best_rtp) = if (target_rtp - rtp_lo).abs() <= (target_rtp - rtp_hi).abs() {
            (lo, rtp_lo)
        } else {
            (hi, rtp_hi)
        };
        return SolveResult {
            converged: false,
            iterations: 2,
            final_param: best_param,
            final_rtp: best_rtp,
            error: (best_rtp - target_rtp).abs(),
            target_rtp,
            history,
        };
    }

    for _ in 0..max_iterations {
        let mid = (lo + hi) / 2.0;
        let rtp_mid = rtp_func(mid);
        history.push((mid, rtp_mid));
        let error = (rtp_mid - target_rtp).abs();
        if error < tolerance {
            return SolveResult {
                converged: true,
                iterations: history.len(),
                final_param: mid,
                final_rtp: rtp_mid,
                error,
                target_rtp,
                history,
            };
        }
        let go_higher = (increasing && rtp_mid < target_rtp)
            || (!increasing && rtp_mid > target_rtp);
        if go_higher {
            lo = mid;
            rtp_lo = rtp_mid;
        } else {
            hi = mid;
            rtp_hi = rtp_mid;
        }
        let _ = (rtp_lo, rtp_hi); // silence unused-warning, kept for clarity
    }

    let mid = (lo + hi) / 2.0;
    let final_rtp = rtp_func(mid);
    SolveResult {
        converged: false,
        iterations: history.len(),
        final_param: mid,
        final_rtp,
        error: (final_rtp - target_rtp).abs(),
        target_rtp,
        history,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Charge-meter shape: rtp = p × 10 with target 0.10 → p = 0.5.
    fn charge_meter_rtp(p: f64) -> f64 {
        p * 0.20 // expected_charge_per_spin × award/threshold = 0.5×10/50
    }

    fn charge_meter_grad(_p: f64) -> f64 {
        0.20
    }

    #[test]
    fn newton_finds_charge_meter_target_in_one_iter() {
        let res = newton_raphson_1d(
            charge_meter_rtp,
            charge_meter_grad,
            0.10,    // target
            0.3,     // initial guess
            1e-4,
            30,
            0.0, 1.0,
        );
        assert!(res.converged);
        assert!((res.final_param - 0.5).abs() < 1e-4);
        // Quadratic convergence: should hit target on 2nd or 3rd iter.
        assert!(res.iterations <= 3);
    }

    #[test]
    fn newton_clamps_to_bracket() {
        // Force overshoot: tiny gradient on very off-target.
        let res = newton_raphson_1d(
            |p| p,
            |_p| 0.01, // tiny gradient → big delta
            0.5,
            0.99,
            1e-6,
            5,
            0.0,
            1.0,
        );
        // Hit boundary, didn't converge (param stuck at clamp).
        assert!(res.final_param >= 0.0 && res.final_param <= 1.0);
    }

    #[test]
    fn bisection_finds_monotone_increasing_target() {
        // pay_anywhere shape: rtp ∝ p (increasing)
        let res = bisection_1d(
            |p| p * 0.5,
            0.20,
            0.0, 1.0,
            1e-4,
            50,
        );
        assert!(res.converged);
        assert!((res.final_param - 0.4).abs() < 1e-3);
    }

    #[test]
    fn bisection_handles_decreasing_direction() {
        let res = bisection_1d(
            |p| 1.0 - p, // decreasing in p
            0.4,
            0.0, 1.0,
            1e-4,
            50,
        );
        assert!(res.converged);
        assert!((res.final_param - 0.6).abs() < 1e-3);
    }

    #[test]
    fn bisection_refuses_out_of_bracket_target() {
        let res = bisection_1d(
            |p| p,
            2.0, // target outside [0, 1] image
            0.0, 1.0,
            1e-4,
            50,
        );
        assert!(!res.converged);
    }
}
