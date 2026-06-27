//! W244.15 — buy_feature Rust port.
//!
//! Bonus Buy fair-price audit kernel sa codified jurisdiction passes:
//! UKGC RTS 13C + MGA RG 2021/02.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuyFeatureParams {
    pub bonus_average_pay_x_bet: f64,
    pub buy_cost_x_bet: f64,
    pub base_game_rtp: f64,
    #[serde(default = "default_target_buy_rtp")]
    pub target_buy_rtp: f64,
}

fn default_target_buy_rtp() -> f64 { 0.96 }

impl BuyFeatureParams {
    pub fn validate(&self) -> Result<(), String> {
        if self.bonus_average_pay_x_bet < 0.0 {
            return Err("bonus_average_pay_x_bet must be ≥ 0".into());
        }
        if self.buy_cost_x_bet <= 0.0 {
            return Err("buy_cost_x_bet must be > 0".into());
        }
        if !(self.base_game_rtp > 0.0 && self.base_game_rtp <= 1.0) {
            return Err(format!(
                "base_game_rtp {} outside (0,1]", self.base_game_rtp
            ));
        }
        if !(self.target_buy_rtp > 0.0 && self.target_buy_rtp <= 1.0) {
            return Err(format!(
                "target_buy_rtp {} outside (0,1]", self.target_buy_rtp
            ));
        }
        Ok(())
    }
}

pub fn buy_rtp(p: &BuyFeatureParams) -> f64 {
    p.bonus_average_pay_x_bet / p.buy_cost_x_bet
}

pub fn fair_buy_cost_x_bet(p: &BuyFeatureParams) -> f64 {
    p.bonus_average_pay_x_bet / p.target_buy_rtp
}

pub fn delta_pp_vs_base(p: &BuyFeatureParams) -> f64 {
    (buy_rtp(p) - p.base_game_rtp) * 100.0
}

pub fn ukgc_rts13c_pass(p: &BuyFeatureParams, tolerance_pp: f64) -> bool {
    delta_pp_vs_base(p).abs() <= tolerance_pp
}

pub fn mga_2021_02_pass(p: &BuyFeatureParams, ceiling_rtp: f64) -> bool {
    buy_rtp(p) <= ceiling_rtp
}

#[derive(Debug, Serialize)]
pub struct BuyFeatureResult {
    pub bonus_average_pay_x_bet: f64,
    pub buy_cost_x_bet: f64,
    pub base_game_rtp: f64,
    pub target_buy_rtp: f64,
    pub buy_rtp: f64,
    pub fair_buy_cost_x_bet: f64,
    pub delta_pp_vs_base: f64,
    pub delta_pp_vs_target: f64,
    pub ukgc_rts13c_pass_0p5: bool,
    pub ukgc_rts13c_pass_1p0: bool,
    pub mga_2021_02_pass_0p96: bool,
    pub mga_2021_02_pass_0p97: bool,
    /// For composition with other kernels: contributing RTP (= buy_rtp).
    pub rtp_contribution: f64,
}

pub fn buy_feature_audit(p: &BuyFeatureParams) -> BuyFeatureResult {
    let br = buy_rtp(p);
    BuyFeatureResult {
        bonus_average_pay_x_bet: p.bonus_average_pay_x_bet,
        buy_cost_x_bet: p.buy_cost_x_bet,
        base_game_rtp: p.base_game_rtp,
        target_buy_rtp: p.target_buy_rtp,
        buy_rtp: br,
        fair_buy_cost_x_bet: fair_buy_cost_x_bet(p),
        delta_pp_vs_base: delta_pp_vs_base(p),
        delta_pp_vs_target: (br - p.target_buy_rtp) * 100.0,
        ukgc_rts13c_pass_0p5: ukgc_rts13c_pass(p, 0.5),
        ukgc_rts13c_pass_1p0: ukgc_rts13c_pass(p, 1.0),
        mga_2021_02_pass_0p96: mga_2021_02_pass(p, 0.96),
        mga_2021_02_pass_0p97: mga_2021_02_pass(p, 0.97),
        rtp_contribution: br,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fair_buy_matches_target() {
        let p = BuyFeatureParams {
            bonus_average_pay_x_bet: 96.0,
            buy_cost_x_bet: 100.0,
            base_game_rtp: 0.96,
            target_buy_rtp: 0.96,
        };
        let r = buy_feature_audit(&p);
        assert!((r.buy_rtp - 0.96).abs() < 1e-12);
        assert!((r.fair_buy_cost_x_bet - 100.0).abs() < 1e-10);
        assert!(r.ukgc_rts13c_pass_0p5);
        assert!(r.mga_2021_02_pass_0p96);
    }

    #[test]
    fn exceeds_mga_ceiling() {
        let p = BuyFeatureParams {
            bonus_average_pay_x_bet: 97.0,
            buy_cost_x_bet: 100.0,
            base_game_rtp: 0.96,
            target_buy_rtp: 0.96,
        };
        let r = buy_feature_audit(&p);
        assert!(!r.mga_2021_02_pass_0p96);
    }
}
