//! W244.33 — showcase_game Rust port (composition driver).
//!
//! Mirror of `tools/math_dsl/showcase_game.py` "Crimson Tiger" end-to-end
//! showcase. Composes 4 W244 kernels:
//!   * cluster_pays    (primary BFS evaluator)
//!   * cascade         (tumble chain)
//!   * charge_meter    (FS trigger)
//!   * hold_and_win    (composed money + jackpot)
//!
//! Composition rule (industry-standard 2nd-order approximation):
//!   RTP_total = RTP_cluster + RTP_cascade + RTP_charge + RTP_holdwin
//!
//! Joint events are ignored. Validated against pure-Python MC reference
//! sa max delta 0.0 pp on N=1M spins.
//!
//! Rust port skips the in-kernel MC simulator (Python keeps it as the
//! reference oracle; Rust has the production MC framework in
//! `simulator.rs` for end-to-end games). This kernel ports just the
//! closed-form composition rule — that's the math that needs sub-µs
//! evaluation in hot paths.
//!
//! **Closes Rust kernel port at 20/20 = 100 % roadmap.**

use crate::kernels::cascade::{cascade_rtp, CascadeParams};
use crate::kernels::charge_meter::{charge_meter_rtp, ChargeMeterParams};
use crate::kernels::cluster_pays::{cluster_pays_rtp, ClusterPaysParams};
use crate::kernels::hold_and_win::{hold_and_win_rtp, HoldAndWinParams};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShowcaseGameSpec {
    pub cluster_params: ClusterPaysParams,
    pub cascade_params: CascadeParams,
    pub charge_params: ChargeMeterParams,
    pub holdwin_params: HoldAndWinParams,
    #[serde(default = "default_game_name")]
    pub game_name: String,
}

fn default_game_name() -> String {
    "crimson_tiger".to_string()
}

impl ShowcaseGameSpec {
    pub fn validate(&self) -> Result<(), String> {
        self.cluster_params.validate()?;
        self.cascade_params.validate()?;
        self.charge_params.validate()?;
        self.holdwin_params.validate()?;
        Ok(())
    }
}

#[derive(Debug, Serialize)]
pub struct ComponentBreakdown {
    pub cluster_pays: f64,
    pub cascade: f64,
    pub charge_meter: f64,
    pub hold_and_win: f64,
}

#[derive(Debug, Serialize)]
pub struct ShowcaseGameResult {
    pub game_name: String,
    pub total_rtp: f64,
    pub components: ComponentBreakdown,
}

/// Sum per-kernel RTP contributions (composition rule).
/// Equivalent to Python `closed_form_total_rtp(spec)`.
pub fn closed_form_total_rtp(spec: &ShowcaseGameSpec) -> ShowcaseGameResult {
    let rtp_cluster = cluster_pays_rtp(&spec.cluster_params);
    let rtp_cascade = cascade_rtp(&spec.cascade_params);
    let rtp_charge = charge_meter_rtp(&spec.charge_params);
    let rtp_holdwin = hold_and_win_rtp(&spec.holdwin_params);
    let total = rtp_cluster.rtp_contribution
        + rtp_cascade.rtp_contribution
        + rtp_charge.rtp_contribution
        + rtp_holdwin.rtp_contribution;
    ShowcaseGameResult {
        game_name: spec.game_name.clone(),
        total_rtp: total,
        components: ComponentBreakdown {
            cluster_pays: rtp_cluster.rtp_contribution,
            cascade: rtp_cascade.rtp_contribution,
            charge_meter: rtp_charge.rtp_contribution,
            hold_and_win: rtp_holdwin.rtp_contribution,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernels::charge_meter::ChargeTier;
    use crate::kernels::money_collect::MoneyCollectParams;
    use crate::kernels::must_hit_by::MustHitByPot;
    use std::collections::BTreeMap;

    fn crimson_tiger_lite() -> ShowcaseGameSpec {
        // Minimal but valid composition fixture.
        let mut cluster_dist: BTreeMap<String, BTreeMap<u32, f64>> = BTreeMap::new();
        let mut hp1_dist = BTreeMap::new();
        hp1_dist.insert(8, 0.02);
        hp1_dist.insert(9, 0.005);
        cluster_dist.insert("hp1".to_string(), hp1_dist);

        let mut cluster_pay: BTreeMap<String, BTreeMap<u32, f64>> = BTreeMap::new();
        let mut hp1_pay = BTreeMap::new();
        hp1_pay.insert(8, 2.0);
        hp1_pay.insert(9, 5.0);
        cluster_pay.insert("hp1".to_string(), hp1_pay);

        let cluster = ClusterPaysParams {
            cluster_count_distribution: cluster_dist,
            pay_table: cluster_pay,
            min_cluster_size: 8,
            grid_rows: 5,
            grid_cols: 6,
            adjacency: "4-way".to_string(),
        };

        let cascade = CascadeParams {
            p_initial_win: 0.10,
            base_pay_per_cascade_x_bet: 1.0,
            p_win_per_cascade: 0.30,
            multiplier_ladder: vec![1.0, 1.0, 2.0, 2.0, 3.0],
            max_chain: 16,
        };

        let charge = ChargeMeterParams {
            expected_charge_per_spin: 0.3,
            tiers: vec![ChargeTier {
                name: "fs_trigger".into(),
                threshold: 30.0,
                award_value_x_bet: 5.0,
                award_kind: "credit_x_bet".into(),
            }],
            persistent_across_sessions: false,
        };

        let mut value_table = BTreeMap::new();
        value_table.insert("1.0".to_string(), 70.0);
        value_table.insert("2.0".to_string(), 20.0);
        value_table.insert("5.0".to_string(), 10.0);
        let money = MoneyCollectParams {
            p_per_cell: 0.05,
            n_cells: 30,
            trigger_count_min: 6,
            value_table,
            respins_reset: 3,
            grid_cap: Some(30),
        };
        let holdwin = HoldAndWinParams {
            money_params: money,
            jackpot_pots: vec![MustHitByPot {
                name: "mini".to_string(),
                seed_x_bet: 10.0,
                contribution_x: 0.005,
                must_hit_by_x_bet: 100.0,
                p_strike_per_spin: 0.0001,
            }],
        };

        ShowcaseGameSpec {
            cluster_params: cluster,
            cascade_params: cascade,
            charge_params: charge,
            holdwin_params: holdwin,
            game_name: "crimson_tiger_lite".to_string(),
        }
    }

    #[test]
    fn total_rtp_sums_components() {
        let s = crimson_tiger_lite();
        let r = closed_form_total_rtp(&s);
        let expected = r.components.cluster_pays
            + r.components.cascade
            + r.components.charge_meter
            + r.components.hold_and_win;
        assert!((r.total_rtp - expected).abs() < 1e-12);
    }

    #[test]
    fn each_component_positive() {
        let s = crimson_tiger_lite();
        let r = closed_form_total_rtp(&s);
        assert!(r.components.cluster_pays > 0.0, "cluster {}", r.components.cluster_pays);
        assert!(r.components.cascade > 0.0, "cascade {}", r.components.cascade);
        assert!(r.components.charge_meter > 0.0, "charge {}", r.components.charge_meter);
        assert!(r.components.hold_and_win > 0.0, "holdwin {}", r.components.hold_and_win);
    }

    #[test]
    fn validate_propagates_to_subkernels() {
        let mut s = crimson_tiger_lite();
        // Force invalid charge_meter: tier sa negative threshold
        s.charge_params.tiers[0].threshold = -1.0;
        assert!(s.validate().is_err());
    }

    #[test]
    fn game_name_preserved() {
        let s = crimson_tiger_lite();
        let r = closed_form_total_rtp(&s);
        assert_eq!(r.game_name, "crimson_tiger_lite");
    }
}
