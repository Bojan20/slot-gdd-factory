//! W244.21 — cluster_pays Rust port.
//!
//! Closed-form: operator-supplied empirical cluster_count_distribution
//! × pay_table aggregation, with min_cluster_size threshold.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterPaysParams {
    /// {symbol: {cluster_size: expected_count_per_spin}}
    pub cluster_count_distribution: BTreeMap<String, BTreeMap<u32, f64>>,
    /// {symbol: {cluster_size: pay_x_bet}}
    pub pay_table: BTreeMap<String, BTreeMap<u32, f64>>,
    #[serde(default = "default_min_cluster_size")]
    pub min_cluster_size: u32,
    #[serde(default = "default_grid_rows")]
    pub grid_rows: u32,
    #[serde(default = "default_grid_cols")]
    pub grid_cols: u32,
    #[serde(default = "default_adjacency")]
    pub adjacency: String,
}

fn default_min_cluster_size() -> u32 { 5 }
fn default_grid_rows() -> u32 { 7 }
fn default_grid_cols() -> u32 { 7 }
fn default_adjacency() -> String { "4-way".to_string() }

impl ClusterPaysParams {
    pub fn validate(&self) -> Result<(), String> {
        if self.min_cluster_size < 1 {
            return Err("min_cluster_size must be ≥ 1".into());
        }
        if self.grid_rows < 1 || self.grid_cols < 1 {
            return Err("grid dimensions must be ≥ 1".into());
        }
        if !matches!(self.adjacency.as_str(), "4-way" | "8-way") {
            return Err(format!(
                "adjacency must be '4-way' or '8-way', got {:?}",
                self.adjacency
            ));
        }
        if self.cluster_count_distribution.is_empty() {
            return Err("cluster_count_distribution must be non-empty".into());
        }
        if self.pay_table.is_empty() {
            return Err("pay_table must be non-empty".into());
        }
        for (sym, dist) in &self.cluster_count_distribution {
            for (&size, &cnt) in dist {
                if size < 1 {
                    return Err(format!("cluster_count[{}] size must be ≥ 1", sym));
                }
                if cnt < 0.0 {
                    return Err(format!("cluster_count[{}][{}] must be ≥ 0", sym, size));
                }
            }
        }
        for (sym, table) in &self.pay_table {
            for (&size, &pay) in table {
                if size < 1 {
                    return Err(format!("pay_table[{}] size must be ≥ 1", sym));
                }
                if pay < 0.0 {
                    return Err(format!("pay_table[{}][{}] must be ≥ 0", sym, size));
                }
            }
        }
        Ok(())
    }
}

pub fn expected_pay_per_spin(p: &ClusterPaysParams) -> f64 {
    let mut total = 0.0_f64;
    for (sym, dist) in &p.cluster_count_distribution {
        if let Some(sym_pay) = p.pay_table.get(sym) {
            for (&size, &cnt) in dist {
                if size < p.min_cluster_size {
                    continue;
                }
                if let Some(&pay) = sym_pay.get(&size) {
                    total += cnt * pay;
                }
            }
        }
    }
    total
}

#[derive(Debug, Serialize)]
pub struct PerSize {
    pub cluster_size: u32,
    pub expected_count_per_spin: f64,
    pub pay_x_bet: f64,
    pub contribution_x_bet: f64,
}

#[derive(Debug, Serialize)]
pub struct PerSymbol {
    pub symbol: String,
    pub total_contribution_x_bet: f64,
    pub sizes: Vec<PerSize>,
}

#[derive(Debug, Serialize)]
pub struct ClusterPaysResult {
    pub rtp_contribution: f64,
    pub grid: String,
    pub adjacency: String,
    pub min_cluster_size: u32,
    pub per_symbol: Vec<PerSymbol>,
}

pub fn cluster_pays_rtp(p: &ClusterPaysParams) -> ClusterPaysResult {
    let e_pay = expected_pay_per_spin(p);
    let mut per_symbol: Vec<PerSymbol> = Vec::new();
    for (sym, dist) in &p.cluster_count_distribution {
        let sym_pay = p.pay_table.get(sym);
        let mut sym_total = 0.0_f64;
        let mut sizes: Vec<PerSize> = Vec::new();
        for (&size, &cnt) in dist {
            if size < p.min_cluster_size {
                continue;
            }
            let pay = sym_pay.and_then(|t| t.get(&size).copied()).unwrap_or(0.0);
            let contrib = cnt * pay;
            sym_total += contrib;
            sizes.push(PerSize {
                cluster_size: size,
                expected_count_per_spin: cnt,
                pay_x_bet: pay,
                contribution_x_bet: contrib,
            });
        }
        per_symbol.push(PerSymbol {
            symbol: sym.clone(),
            total_contribution_x_bet: sym_total,
            sizes,
        });
    }
    ClusterPaysResult {
        rtp_contribution: e_pay,
        grid: format!("{}×{}", p.grid_rows, p.grid_cols),
        adjacency: p.adjacency.clone(),
        min_cluster_size: p.min_cluster_size,
        per_symbol,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_params() -> ClusterPaysParams {
        let mut dist = BTreeMap::new();
        let mut a_dist = BTreeMap::new();
        a_dist.insert(5, 0.1);
        dist.insert("A".to_string(), a_dist);
        let mut pay = BTreeMap::new();
        let mut a_pay = BTreeMap::new();
        a_pay.insert(5, 2.0);
        pay.insert("A".to_string(), a_pay);
        ClusterPaysParams {
            cluster_count_distribution: dist,
            pay_table: pay,
            min_cluster_size: 5,
            grid_rows: 5,
            grid_cols: 6,
            adjacency: "4-way".to_string(),
        }
    }

    #[test]
    fn simple_single_symbol() {
        let p = mk_params();
        let r = cluster_pays_rtp(&p);
        assert!((r.rtp_contribution - 0.2).abs() < 1e-12);
    }

    #[test]
    fn below_min_pays_zero() {
        let mut dist = BTreeMap::new();
        let mut a_dist = BTreeMap::new();
        a_dist.insert(3, 0.5);
        a_dist.insert(5, 0.1);
        dist.insert("A".to_string(), a_dist);
        let mut pay = BTreeMap::new();
        let mut a_pay = BTreeMap::new();
        a_pay.insert(3, 10.0);
        a_pay.insert(5, 2.0);
        pay.insert("A".to_string(), a_pay);
        let p = ClusterPaysParams {
            cluster_count_distribution: dist,
            pay_table: pay,
            min_cluster_size: 5,
            grid_rows: 5, grid_cols: 6,
            adjacency: "4-way".to_string(),
        };
        let r = cluster_pays_rtp(&p);
        // Only size 5 contributes (size 3 below min)
        assert!((r.rtp_contribution - 0.2).abs() < 1e-12);
    }
}
