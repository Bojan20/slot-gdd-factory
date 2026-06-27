//! W244.30 — both_ways Rust port.
//!
//! Closed-form: RTP = ltr_only_rtp × (1 + line_pay_share).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BothWaysParams {
    pub ltr_only_rtp: f64,
    pub line_pay_share: f64,
}

impl BothWaysParams {
    pub fn validate(&self) -> Result<(), String> {
        if !(0.0..=2.0).contains(&self.ltr_only_rtp) {
            return Err(format!(
                "ltr_only_rtp {} outside [0,2]", self.ltr_only_rtp
            ));
        }
        if !(0.0..=1.0).contains(&self.line_pay_share) {
            return Err(format!(
                "line_pay_share {} outside [0,1]", self.line_pay_share
            ));
        }
        Ok(())
    }
}

pub fn bidirectional_multiplier(p: &BothWaysParams) -> f64 {
    1.0 + p.line_pay_share
}

#[derive(Debug, Serialize)]
pub struct BothWaysResult {
    pub rtp_contribution: f64,
    pub ltr_only_rtp: f64,
    pub line_pay_share: f64,
    pub bidirectional_multiplier: f64,
    pub line_pay_ltr: f64,
    pub line_pay_doubled: f64,
    pub scatter_bonus_unchanged: f64,
    pub uplift_x_bet: f64,
}

pub fn both_ways_rtp(p: &BothWaysParams) -> BothWaysResult {
    let mult = bidirectional_multiplier(p);
    let new_rtp = p.ltr_only_rtp * mult;
    let line_part_ltr = p.ltr_only_rtp * p.line_pay_share;
    let scatter_part = p.ltr_only_rtp * (1.0 - p.line_pay_share);
    BothWaysResult {
        rtp_contribution: new_rtp,
        ltr_only_rtp: p.ltr_only_rtp,
        line_pay_share: p.line_pay_share,
        bidirectional_multiplier: mult,
        line_pay_ltr: line_part_ltr,
        line_pay_doubled: line_part_ltr * 2.0,
        scatter_bonus_unchanged: scatter_part,
        uplift_x_bet: new_rtp - p.ltr_only_rtp,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_line_share_doubles() {
        let p = BothWaysParams { ltr_only_rtp: 0.96, line_pay_share: 1.0 };
        let r = both_ways_rtp(&p);
        assert!((r.rtp_contribution - 1.92).abs() < 1e-12);
    }

    #[test]
    fn thunderstruck_proxy() {
        let p = BothWaysParams { ltr_only_rtp: 0.96, line_pay_share: 0.7 };
        let r = both_ways_rtp(&p);
        assert!((r.rtp_contribution - 1.632).abs() < 1e-12);
    }

    #[test]
    fn no_share_no_uplift() {
        let p = BothWaysParams { ltr_only_rtp: 0.96, line_pay_share: 0.0 };
        let r = both_ways_rtp(&p);
        assert!((r.rtp_contribution - 0.96).abs() < 1e-12);
        assert!((r.uplift_x_bet - 0.0).abs() < 1e-12);
    }
}
