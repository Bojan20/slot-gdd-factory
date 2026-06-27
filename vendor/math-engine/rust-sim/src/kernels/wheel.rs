//! W244.16 — wheel Rust port.
//!
//! Mirror of `tools/math_dsl/wheel.py`. Closed-form:
//!   E[terminal_award]   = Σ (w_i × v_i) / W for kind ∈ {credit, jackpot}
//!   p_again             = Σ w_j / W for kind = spin_again
//!   E[award_per_trigger]
//!     = E[terminal] × (1 − p_again^(N+1)) / (1 − p_again)   if p_again < 1
//!     = E[terminal] × (N + 1)                                 if p_again ≥ 1
//!   RTP_contribution     = trigger_p × E[award_per_trigger]
//!
//! Used by Wheel of Fortune-style bonuses, Dragon Cash wheel,
//! Aristocrat Mighty Cash wheel, IGT WAP wheels.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WheelSegment {
    pub kind: String, // "credit" | "jackpot" | "spin_again" | "no_win"
    pub weight: f64,
    #[serde(default)]
    pub value_x_bet: f64,
    #[serde(default)]
    pub jackpot_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WheelParams {
    pub trigger_p: f64,
    pub segments: Vec<WheelSegment>,
    #[serde(default = "default_max_spin_again")]
    pub max_spin_again: u32,
}

fn default_max_spin_again() -> u32 {
    5
}

impl WheelSegment {
    pub fn validate(&self) -> Result<(), String> {
        let known = ["credit", "jackpot", "spin_again", "no_win"];
        if !known.contains(&self.kind.as_str()) {
            return Err(format!("unknown segment kind {:?}", self.kind));
        }
        if self.weight < 0.0 {
            return Err("segment weight must be ≥ 0".into());
        }
        if (self.kind == "credit" || self.kind == "jackpot") && self.value_x_bet < 0.0 {
            return Err("credit/jackpot value_x_bet must be ≥ 0".into());
        }
        if self.kind == "jackpot" && self.jackpot_id.is_empty() {
            return Err("jackpot segment requires jackpot_id".into());
        }
        Ok(())
    }
}

impl WheelParams {
    pub fn validate(&self) -> Result<(), String> {
        if !(0.0..=1.0).contains(&self.trigger_p) {
            return Err(format!(
                "trigger_p {} outside [0,1]",
                self.trigger_p
            ));
        }
        if self.segments.is_empty() {
            return Err("segments must be non-empty".into());
        }
        for s in &self.segments {
            s.validate()?;
        }
        Ok(())
    }
}

pub fn total_weight(segments: &[WheelSegment]) -> f64 {
    segments.iter().map(|s| s.weight).sum()
}

pub fn terminal_award_expectation(segments: &[WheelSegment]) -> f64 {
    let w = total_weight(segments);
    if w <= 0.0 {
        return 0.0;
    }
    let s: f64 = segments
        .iter()
        .filter(|s| s.kind == "credit" || s.kind == "jackpot")
        .map(|s| s.weight * s.value_x_bet)
        .sum();
    s / w
}

pub fn spin_again_probability(segments: &[WheelSegment]) -> f64 {
    let w = total_weight(segments);
    if w <= 0.0 {
        return 0.0;
    }
    let s: f64 = segments
        .iter()
        .filter(|s| s.kind == "spin_again")
        .map(|s| s.weight)
        .sum();
    s / w
}

pub fn expected_award_per_trigger(params: &WheelParams) -> f64 {
    let e_term = terminal_award_expectation(&params.segments);
    let p_again = spin_again_probability(&params.segments);
    let n = params.max_spin_again;
    if p_again >= 1.0 {
        return if e_term == 0.0 {
            0.0
        } else {
            e_term * ((n + 1) as f64)
        };
    }
    if p_again <= 0.0 {
        return e_term;
    }
    let multiplier = (1.0 - p_again.powi((n + 1) as i32)) / (1.0 - p_again);
    e_term * multiplier
}

#[derive(Debug, Serialize)]
pub struct SegmentBreakdown {
    pub kind: String,
    pub weight: f64,
    pub probability: f64,
    pub value_x_bet: f64,
    pub jackpot_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct WheelResult {
    pub rtp_contribution: f64,
    pub trigger_p: f64,
    pub expected_award_per_trigger: f64,
    pub terminal_award_expectation: f64,
    pub spin_again_probability: f64,
    pub max_spin_again: u32,
    pub segments: Vec<SegmentBreakdown>,
}

pub fn wheel_rtp(params: &WheelParams) -> WheelResult {
    let e_award = expected_award_per_trigger(params);
    let rtp = params.trigger_p * e_award;
    let w = total_weight(&params.segments);
    let mut breakdown = Vec::with_capacity(params.segments.len());
    for seg in &params.segments {
        let p_segment = if w > 0.0 { seg.weight / w } else { 0.0 };
        breakdown.push(SegmentBreakdown {
            kind: seg.kind.clone(),
            weight: seg.weight,
            probability: p_segment,
            value_x_bet: seg.value_x_bet,
            jackpot_id: if seg.jackpot_id.is_empty() {
                None
            } else {
                Some(seg.jackpot_id.clone())
            },
        });
    }
    WheelResult {
        rtp_contribution: rtp,
        trigger_p: params.trigger_p,
        expected_award_per_trigger: e_award,
        terminal_award_expectation: terminal_award_expectation(&params.segments),
        spin_again_probability: spin_again_probability(&params.segments),
        max_spin_again: params.max_spin_again,
        segments: breakdown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_seg(kind: &str, weight: f64, value_x_bet: f64) -> WheelSegment {
        WheelSegment {
            kind: kind.into(),
            weight,
            value_x_bet,
            jackpot_id: String::new(),
        }
    }

    #[test]
    fn simple_two_segment_terminal_expectation() {
        // 50/50 between 10× and 0× → E[terminal] = 5
        let segs = vec![
            mk_seg("credit", 1.0, 10.0),
            mk_seg("no_win", 1.0, 0.0),
        ];
        assert!((terminal_award_expectation(&segs) - 5.0).abs() < 1e-12);
    }

    #[test]
    fn spin_again_probability_quarter() {
        let segs = vec![
            mk_seg("credit", 3.0, 4.0),
            mk_seg("spin_again", 1.0, 0.0),
        ];
        assert!((spin_again_probability(&segs) - 0.25).abs() < 1e-12);
    }

    #[test]
    fn geometric_amortisation_matches_closed_form() {
        // E_term = 3 × 4 / 4 = 3.0,  p_again = 0.25
        // E_total = 3 × (1 − 0.25^6) / (1 − 0.25)
        //         = 3 × (1 − 0.000244) / 0.75 ≈ 3 × 1.33268 ≈ 3.998
        let params = WheelParams {
            trigger_p: 1.0,
            segments: vec![
                mk_seg("credit", 3.0, 4.0),
                mk_seg("spin_again", 1.0, 0.0),
            ],
            max_spin_again: 5,
        };
        let e = expected_award_per_trigger(&params);
        let expected = 3.0 * (1.0 - 0.25_f64.powi(6)) / (1.0 - 0.25);
        assert!((e - expected).abs() < 1e-12);
    }

    #[test]
    fn rtp_contribution_includes_trigger_probability() {
        let params = WheelParams {
            trigger_p: 0.01,
            segments: vec![
                mk_seg("credit", 1.0, 100.0),
            ],
            max_spin_again: 5,
        };
        let r = wheel_rtp(&params);
        // 0.01 × 100 = 1.0
        assert!((r.rtp_contribution - 1.0).abs() < 1e-12);
    }

    #[test]
    fn validate_rejects_invalid_kind() {
        let s = mk_seg("invalid", 1.0, 1.0);
        assert!(s.validate().is_err());
    }
}
