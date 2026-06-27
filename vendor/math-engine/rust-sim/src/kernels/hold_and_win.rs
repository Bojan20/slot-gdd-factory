//! W244.27 — hold_and_win Rust port (composed kernel).
//!
//! Mirror of `tools/math_dsl/hold_and_win.py`. Composes:
//!   • money_collect — cash collection mehanik (locked symbols)
//!   • must_hit_by   — jackpot tier accounting
//!
//!   RTP_HW = RTP_money_collect_only + RTP_jackpot_tiers_only
//!
//! Industry-standard 2nd-order approximation: assumes jackpot probability
//! is small enough that joint conditioning between money + jackpot is
//! negligible.
//!
//! Used by IGT Lightning Link, Aristocrat Dragon Cash, Scientific Games
//! Lightning Cash, Pragmatic Big Bass H&W, Quickspin Hold'n'Link.

use crate::kernels::money_collect::{
    money_collect_rtp_contribution, MoneyCollectParams,
};
use crate::kernels::must_hit_by::{must_hit_by_rtp, MustHitByParams, MustHitByPot};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoldAndWinParams {
    pub money_params: MoneyCollectParams,
    pub jackpot_pots: Vec<MustHitByPot>,
}

impl HoldAndWinParams {
    pub fn validate(&self) -> Result<(), String> {
        self.money_params.validate()?;
        if self.jackpot_pots.is_empty() {
            return Err(
                "jackpot_pots must be non-empty (use money_collect alone otherwise)"
                    .into(),
            );
        }
        Ok(())
    }
}

#[derive(Debug, Serialize)]
pub struct MoneyComponent {
    pub rtp_contribution: f64,
    pub trigger_p: f64,
    pub expected_value_per_money: f64,
    pub expected_total_per_episode: f64,
}

#[derive(Debug, Serialize)]
pub struct JackpotComponent {
    pub rtp_contribution: f64,
    pub pots_count: usize,
}

#[derive(Debug, Serialize)]
pub struct HoldAndWinResult {
    pub rtp_contribution: f64,
    pub money_component: MoneyComponent,
    pub jackpot_component: JackpotComponent,
}

pub fn hold_and_win_rtp(params: &HoldAndWinParams) -> HoldAndWinResult {
    let money_result = money_collect_rtp_contribution(&params.money_params);
    let jackpot_params = MustHitByParams {
        pots: params.jackpot_pots.clone(),
    };
    let jackpot_result = must_hit_by_rtp(&jackpot_params);
    let total_rtp = money_result.rtp_contribution + jackpot_result.rtp_contribution;
    HoldAndWinResult {
        rtp_contribution: total_rtp,
        money_component: MoneyComponent {
            rtp_contribution: money_result.rtp_contribution,
            trigger_p: money_result.trigger_p,
            expected_value_per_money: money_result.expected_value_per_money,
            expected_total_per_episode: money_result.expected_total_per_episode,
        },
        jackpot_component: JackpotComponent {
            rtp_contribution: jackpot_result.rtp_contribution,
            pots_count: params.jackpot_pots.len(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn lightning_link_like() -> HoldAndWinParams {
        let mut value_table = BTreeMap::new();
        value_table.insert("1.0".to_string(), 50.0); // 50 % chance × 1 bet
        value_table.insert("2.0".to_string(), 30.0);
        value_table.insert("5.0".to_string(), 15.0);
        value_table.insert("10.0".to_string(), 5.0);
        let money = MoneyCollectParams {
            p_per_cell: 0.10,
            n_cells: 15,
            trigger_count_min: 6,
            value_table,
            respins_reset: 3,
            grid_cap: Some(15),
        };
        let pots = vec![
            MustHitByPot {
                name: "mini".to_string(),
                seed_x_bet: 10.0,
                contribution_x: 0.005,    // 0.5 % per spin
                must_hit_by_x_bet: 100.0,
                p_strike_per_spin: 0.001,
            },
            MustHitByPot {
                name: "minor".to_string(),
                seed_x_bet: 100.0,
                contribution_x: 0.01,
                must_hit_by_x_bet: 1000.0,
                p_strike_per_spin: 0.0001,
            },
        ];
        HoldAndWinParams {
            money_params: money,
            jackpot_pots: pots,
        }
    }

    #[test]
    fn composed_rtp_sums_components() {
        let p = lightning_link_like();
        let r = hold_and_win_rtp(&p);
        let expected_total = r.money_component.rtp_contribution
            + r.jackpot_component.rtp_contribution;
        assert!((r.rtp_contribution - expected_total).abs() < 1e-12);
    }

    #[test]
    fn money_component_has_positive_rtp() {
        let p = lightning_link_like();
        let r = hold_and_win_rtp(&p);
        assert!(r.money_component.rtp_contribution > 0.0);
        assert!(r.money_component.trigger_p > 0.0);
    }

    #[test]
    fn jackpot_component_has_positive_rtp() {
        let p = lightning_link_like();
        let r = hold_and_win_rtp(&p);
        assert!(r.jackpot_component.rtp_contribution > 0.0);
        assert_eq!(r.jackpot_component.pots_count, 2);
    }

    #[test]
    fn validate_rejects_empty_jackpot_pots() {
        let p = HoldAndWinParams {
            money_params: lightning_link_like().money_params,
            jackpot_pots: vec![],
        };
        assert!(p.validate().is_err());
    }
}
