//! W244.17 — state_machine Rust port.
//!
//! Markov stationary distribution via Gaussian elimination on (P^T - I)
//! sa sum=1 last-row constraint. Pure Rust, no numpy/scipy.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameState {
    pub name: String,
    pub rtp_component: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateMachineParams {
    pub states: Vec<GameState>,
    /// Transition matrix: transitions[from][to] = probability.
    /// Each row must sum to 1.0 (stochastic).
    pub transitions: Vec<Vec<f64>>,
}

impl StateMachineParams {
    pub fn validate(&self) -> Result<(), String> {
        let n = self.states.len();
        if n == 0 {
            return Err("states must be non-empty".into());
        }
        if self.transitions.len() != n {
            return Err(format!(
                "transitions has {} rows, expected {}",
                self.transitions.len(), n
            ));
        }
        for (i, row) in self.transitions.iter().enumerate() {
            if row.len() != n {
                return Err(format!(
                    "transitions row {} has {} entries, expected {}",
                    i, row.len(), n
                ));
            }
            let sum: f64 = row.iter().sum();
            if (sum - 1.0).abs() > 1e-9 {
                return Err(format!(
                    "transitions row {} sums to {}, expected 1.0",
                    i, sum
                ));
            }
            if row.iter().any(|&p| p < 0.0) {
                return Err(format!(
                    "transitions row {} has negative probability", i
                ));
            }
        }
        for s in &self.states {
            if s.name.is_empty() {
                return Err("state name must be non-empty".into());
            }
            if s.rtp_component < 0.0 {
                return Err("rtp_component must be ≥ 0".into());
            }
        }
        Ok(())
    }
}

/// Solve π × P = π with sum(π) = 1 via Gaussian elimination on (P^T - I).
pub fn stationary_distribution(params: &StateMachineParams) -> Result<Vec<f64>, String> {
    let n = params.states.len();
    let mut a: Vec<Vec<f64>> = vec![vec![0.0; n]; n];
    let mut b: Vec<f64> = vec![0.0; n];

    // Rows 0..n-1: (P^T - I) π = 0
    for i in 0..n - 1 {
        for j in 0..n {
            a[i][j] = params.transitions[j][i];
        }
        a[i][i] -= 1.0;
    }
    // Last row: sum(π) = 1
    for j in 0..n {
        a[n - 1][j] = 1.0;
    }
    b[n - 1] = 1.0;

    // Gaussian elimination with partial pivoting
    for i in 0..n {
        let mut pivot_row = i;
        let mut max_val = a[i][i].abs();
        for k in (i + 1)..n {
            if a[k][i].abs() > max_val {
                max_val = a[k][i].abs();
                pivot_row = k;
            }
        }
        if max_val < 1e-15 {
            return Err("Transition matrix is singular".into());
        }
        a.swap(i, pivot_row);
        b.swap(i, pivot_row);
        for k in (i + 1)..n {
            let factor = a[k][i] / a[i][i];
            for j in i..n {
                a[k][j] -= factor * a[i][j];
            }
            b[k] -= factor * b[i];
        }
    }

    // Back-substitution
    let mut pi: Vec<f64> = vec![0.0; n];
    for i in (0..n).rev() {
        let mut s = b[i];
        for j in (i + 1)..n {
            s -= a[i][j] * pi[j];
        }
        pi[i] = s / a[i][i];
    }

    // Numerical cleanup
    for p in pi.iter_mut() {
        *p = p.max(0.0);
    }
    let total: f64 = pi.iter().sum();
    if total <= 0.0 {
        return Err("stationary distribution sums to ≤ 0".into());
    }
    for p in pi.iter_mut() {
        *p /= total;
    }
    Ok(pi)
}

#[derive(Debug, Serialize)]
pub struct PerState {
    pub name: String,
    pub stationary_probability: f64,
    pub rtp_component_in_state: f64,
    pub weighted_rtp_contribution: f64,
}

#[derive(Debug, Serialize)]
pub struct StateMachineResult {
    pub rtp_contribution: f64,
    pub states_count: u32,
    pub stationary_distribution: Vec<f64>,
    pub states: Vec<PerState>,
}

pub fn state_machine_rtp(p: &StateMachineParams) -> StateMachineResult {
    let pi = stationary_distribution(p).expect("validated already");
    let mut per_state: Vec<PerState> = Vec::with_capacity(p.states.len());
    let mut total = 0.0_f64;
    for (s, &prob) in p.states.iter().zip(pi.iter()) {
        let contrib = prob * s.rtp_component;
        per_state.push(PerState {
            name: s.name.clone(),
            stationary_probability: prob,
            rtp_component_in_state: s.rtp_component,
            weighted_rtp_contribution: contrib,
        });
        total += contrib;
    }
    StateMachineResult {
        rtp_contribution: total,
        states_count: p.states.len() as u32,
        stationary_distribution: pi,
        states: per_state,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_state_symmetric() {
        let p = StateMachineParams {
            states: vec![
                GameState { name: "a".into(), rtp_component: 0.9 },
                GameState { name: "b".into(), rtp_component: 1.0 },
            ],
            transitions: vec![vec![0.5, 0.5], vec![0.5, 0.5]],
        };
        let pi = stationary_distribution(&p).unwrap();
        assert!((pi[0] - 0.5).abs() < 1e-10);
        assert!((pi[1] - 0.5).abs() < 1e-10);
    }

    #[test]
    fn supermeter_asymmetric() {
        let p = StateMachineParams {
            states: vec![
                GameState { name: "base".into(), rtp_component: 0.96 },
                GameState { name: "super".into(), rtp_component: 2.50 },
            ],
            transitions: vec![vec![0.99, 0.01], vec![0.50, 0.50]],
        };
        let r = state_machine_rtp(&p);
        // π_base ≈ 0.9804, π_super ≈ 0.0196
        // RTP = 0.9804 × 0.96 + 0.0196 × 2.5 ≈ 0.9902
        assert!((r.rtp_contribution - 0.9902).abs() < 1e-4);
    }
}
