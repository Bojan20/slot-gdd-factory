//! W244.42 — multi_dim_inverse_solver Rust port.
//!
//! N-D Newton-Raphson with optional analytic Jacobian or central-diff
//! fallback. Mirror of `tools/math_dsl/multi_dim_inverse_solver.py`.
//!
//! Pure-Rust (no nalgebra / no scipy equivalent) — Gauss elimination with
//! partial pivoting handles the n×n linear solve in each iteration.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct MultiDimSolveResult {
    pub converged: bool,
    pub iterations: u32,
    pub final_params: Vec<f64>,
    pub final_residual: Vec<f64>,
    pub final_norm: f64,
    pub target: Vec<f64>,
}

/// Solve `A x = b` via Gauss elimination with partial pivoting.
/// Returns None if A is singular.
fn gauss_solve(a: Vec<Vec<f64>>, b: Vec<f64>) -> Option<Vec<f64>> {
    let n = b.len();
    if a.len() != n {
        return None;
    }
    // Build augmented [A | b]
    let mut aug: Vec<Vec<f64>> = a
        .into_iter()
        .zip(b.iter())
        .map(|(mut row, &bi)| {
            row.push(bi);
            row
        })
        .collect();

    // Forward elimination with partial pivoting
    for k in 0..n {
        // Find pivot
        let mut pivot_row = k;
        let mut max_val = aug[k][k].abs();
        for i in (k + 1)..n {
            if aug[i][k].abs() > max_val {
                max_val = aug[i][k].abs();
                pivot_row = i;
            }
        }
        if max_val < 1e-15 {
            return None; // Singular
        }
        if pivot_row != k {
            aug.swap(k, pivot_row);
        }
        // Eliminate below
        for i in (k + 1)..n {
            let factor = aug[i][k] / aug[k][k];
            for j in k..=n {
                aug[i][j] -= factor * aug[k][j];
            }
        }
    }

    // Back substitution
    let mut x = vec![0.0_f64; n];
    for i in (0..n).rev() {
        let mut s = aug[i][n];
        for j in (i + 1)..n {
            s -= aug[i][j] * x[j];
        }
        x[i] = s / aug[i][i];
    }
    Some(x)
}

fn norm(v: &[f64]) -> f64 {
    v.iter().map(|x| x * x).sum::<f64>().sqrt()
}

/// Numerical Jacobian via central difference.
fn numerical_jacobian<F>(f: &F, theta: &[f64], h: f64) -> Vec<Vec<f64>>
where
    F: Fn(&[f64]) -> Vec<f64>,
{
    let n = theta.len();
    let mut j: Vec<Vec<f64>> = vec![vec![0.0_f64; n]; n];
    for jc in 0..n {
        let mut theta_plus = theta.to_vec();
        theta_plus[jc] += h;
        let mut theta_minus = theta.to_vec();
        theta_minus[jc] -= h;
        let f_plus = f(&theta_plus);
        let f_minus = f(&theta_minus);
        for i in 0..n {
            j[i][jc] = (f_plus[i] - f_minus[i]) / (2.0 * h);
        }
    }
    j
}

/// N-D Newton-Raphson with optional analytic Jacobian.
///
/// * `f`             maps θ ∈ R^n → result ∈ R^n
/// * `target`        desired f(θ)
/// * `initial_guess` starting θ
/// * `jacobian`      analytic Jacobian; if None → central-diff
/// * `tolerance`     ‖f(θ) − target‖₂ < tol → converged
/// * `max_iterations` hard cap
/// * `bounds`        optional (lo, hi) per dimension; θ clamped
/// * `damping`       step multiplier ∈ (0, 1]
#[allow(clippy::too_many_arguments)]
pub fn newton_raphson_nd<F>(
    f: F,
    target: &[f64],
    initial_guess: &[f64],
    jacobian: Option<Box<dyn Fn(&[f64]) -> Vec<Vec<f64>>>>,
    tolerance: f64,
    max_iterations: u32,
    bounds: Option<&[(f64, f64)]>,
    damping: f64,
) -> Result<MultiDimSolveResult, String>
where
    F: Fn(&[f64]) -> Vec<f64>,
{
    if target.len() != initial_guess.len() {
        return Err(format!(
            "target dim {} != initial_guess dim {}",
            target.len(),
            initial_guess.len()
        ));
    }
    let n = target.len();
    if let Some(b) = bounds {
        if b.len() != n {
            return Err(format!(
                "bounds dim {} != target dim {}",
                b.len(),
                n
            ));
        }
    }
    if damping <= 0.0 || damping > 1.0 {
        return Err(format!("damping {} outside (0, 1]", damping));
    }

    let mut theta = initial_guess.to_vec();
    for it in 0..max_iterations {
        let fx = f(&theta);
        let residual: Vec<f64> =
            fx.iter().zip(target.iter()).map(|(a, b)| a - b).collect();
        let n_norm = norm(&residual);
        if n_norm < tolerance {
            return Ok(MultiDimSolveResult {
                converged: true,
                iterations: it + 1,
                final_params: theta,
                final_residual: residual,
                final_norm: n_norm,
                target: target.to_vec(),
            });
        }
        let j = match jacobian.as_ref() {
            Some(jf) => jf(&theta),
            None => numerical_jacobian(&f, &theta, 1e-7),
        };
        let delta = match gauss_solve(j, residual.clone()) {
            Some(d) => d,
            None => break, // Singular Jacobian
        };
        // theta_new = theta - damping * delta, with bounds clamp
        for i in 0..n {
            let mut new_val = theta[i] - damping * delta[i];
            if let Some(b) = bounds {
                let (lo, hi) = b[i];
                if new_val < lo {
                    new_val = lo;
                }
                if new_val > hi {
                    new_val = hi;
                }
            }
            theta[i] = new_val;
        }
    }

    let fx = f(&theta);
    let residual: Vec<f64> =
        fx.iter().zip(target.iter()).map(|(a, b)| a - b).collect();
    let n_norm = norm(&residual);
    Ok(MultiDimSolveResult {
        converged: false,
        iterations: max_iterations,
        final_params: theta,
        final_residual: residual,
        final_norm: n_norm,
        target: target.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linear_2d_solves_in_one_step() {
        // f(x, y) = (2x + y, x − y); target = (3, 0); analytic solution (1, 1).
        let f = |theta: &[f64]| {
            vec![2.0 * theta[0] + theta[1], theta[0] - theta[1]]
        };
        let r = newton_raphson_nd(
            f,
            &[3.0, 0.0],
            &[0.0, 0.0],
            None,
            1e-9,
            10,
            None,
            1.0,
        )
        .unwrap();
        assert!(r.converged);
        assert!((r.final_params[0] - 1.0).abs() < 1e-6);
        assert!((r.final_params[1] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn quadratic_2d_converges() {
        // f(x, y) = (x² + y², x − y); target = (2, 0); answer (1, 1).
        let f = |theta: &[f64]| {
            vec![
                theta[0] * theta[0] + theta[1] * theta[1],
                theta[0] - theta[1],
            ]
        };
        let r = newton_raphson_nd(
            f,
            &[2.0, 0.0],
            &[0.5, 0.3],
            None,
            1e-6,
            30,
            None,
            1.0,
        )
        .unwrap();
        assert!(r.converged);
        assert!((r.final_params[0] - 1.0).abs() < 1e-4);
        assert!((r.final_params[1] - 1.0).abs() < 1e-4);
    }

    #[test]
    fn bounds_clamp() {
        let f = |theta: &[f64]| vec![10.0 * theta[0]];
        let r = newton_raphson_nd(
            f,
            &[100.0],
            &[1.0],
            None,
            1e-9,
            5,
            Some(&[(0.0, 5.0)]),
            1.0,
        )
        .unwrap();
        // Solution x=10 is outside bounds → clamp to 5
        assert!(r.final_params[0] <= 5.0 + 1e-9);
    }
}
