//! W244.31 — asymmetric_paytable Rust port.
//!
//! Mirror of `tools/math_dsl/asymmetric_paytable.py`. Closed-form:
//!   RTP_total = Σ_symbol Σ_shape per_symbol_contributions[symbol][shape]
//!
//! Operator pre-computes per-(symbol, shape-key) contribution from PAR or
//! MC; kernel aggregates. Used by NetEnt Twin Spin, Yggdrasil Wild West
//! Gold, Microgaming Wild Toro (any game where the same symbol pays
//! differently depending on which reels it occupies).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsymmetricPaytableParams {
    /// {symbol → {shape_key → contribution_x_bet}}
    pub per_symbol_contributions: BTreeMap<String, BTreeMap<String, f64>>,
}

impl AsymmetricPaytableParams {
    pub fn validate(&self) -> Result<(), String> {
        if self.per_symbol_contributions.is_empty() {
            return Err("per_symbol_contributions must be non-empty".into());
        }
        for (sym, table) in &self.per_symbol_contributions {
            if table.is_empty() {
                return Err(format!(
                    "per_symbol_contributions[{}] must be non-empty",
                    sym
                ));
            }
            for (shape, &v) in table {
                if v < 0.0 {
                    return Err(format!(
                        "contribution[{}][{}] = {} must be ≥ 0",
                        sym, shape, v
                    ));
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Serialize)]
pub struct PerSymbol {
    pub symbol: String,
    pub total_contribution_x_bet: f64,
    pub per_shape: BTreeMap<String, f64>,
}

#[derive(Debug, Serialize)]
pub struct AsymmetricPaytableResult {
    pub rtp_contribution: f64,
    pub symbols_count: usize,
    pub per_symbol_breakdown: Vec<PerSymbol>,
}

pub fn asymmetric_paytable_rtp(params: &AsymmetricPaytableParams) -> AsymmetricPaytableResult {
    let mut total = 0.0_f64;
    let mut per_symbol = Vec::with_capacity(params.per_symbol_contributions.len());
    // BTreeMap iterates sorted by key (matches Python `sorted(...)` semantics).
    for (sym, table) in &params.per_symbol_contributions {
        let sym_total: f64 = table.values().sum();
        total += sym_total;
        per_symbol.push(PerSymbol {
            symbol: sym.clone(),
            total_contribution_x_bet: sym_total,
            per_shape: table.clone(),
        });
    }
    AsymmetricPaytableResult {
        rtp_contribution: total,
        symbols_count: params.per_symbol_contributions.len(),
        per_symbol_breakdown: per_symbol,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn twin_spin_like() -> AsymmetricPaytableParams {
        let mut wd1 = BTreeMap::new();
        wd1.insert("twin_reels".to_string(), 0.20);
        wd1.insert("triple_reels".to_string(), 0.10);
        wd1.insert("quad_reels".to_string(), 0.05);

        let mut wd2 = BTreeMap::new();
        wd2.insert("twin_reels".to_string(), 0.10);
        wd2.insert("triple_reels".to_string(), 0.05);

        let mut top = BTreeMap::new();
        top.insert("S_HP1".to_string(), wd1);
        top.insert("S_HP2".to_string(), wd2);
        AsymmetricPaytableParams { per_symbol_contributions: top }
    }

    #[test]
    fn aggregates_correctly() {
        let p = twin_spin_like();
        let r = asymmetric_paytable_rtp(&p);
        // Σ all values: 0.20+0.10+0.05+0.10+0.05 = 0.50
        assert!((r.rtp_contribution - 0.50).abs() < 1e-12);
        assert_eq!(r.symbols_count, 2);
    }

    #[test]
    fn per_symbol_breakdown_sums_correctly() {
        let p = twin_spin_like();
        let r = asymmetric_paytable_rtp(&p);
        // First symbol (S_HP1 alphabetically) → 0.35
        let hp1 = r.per_symbol_breakdown.iter()
            .find(|s| s.symbol == "S_HP1").unwrap();
        assert!((hp1.total_contribution_x_bet - 0.35).abs() < 1e-12);
        // Second symbol (S_HP2) → 0.15
        let hp2 = r.per_symbol_breakdown.iter()
            .find(|s| s.symbol == "S_HP2").unwrap();
        assert!((hp2.total_contribution_x_bet - 0.15).abs() < 1e-12);
    }

    #[test]
    fn validate_rejects_empty() {
        let p = AsymmetricPaytableParams {
            per_symbol_contributions: BTreeMap::new(),
        };
        assert!(p.validate().is_err());
    }

    #[test]
    fn validate_rejects_negative_contribution() {
        let mut inner = BTreeMap::new();
        inner.insert("shape".to_string(), -0.5);
        let mut top = BTreeMap::new();
        top.insert("sym".to_string(), inner);
        let p = AsymmetricPaytableParams { per_symbol_contributions: top };
        assert!(p.validate().is_err());
    }
}
