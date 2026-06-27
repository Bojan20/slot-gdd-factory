//! W244.13 — pick_chain Rust port.
//!
//! Multi-level pick bonus with first-order-statistic E[picks] +
//! relative-odds advance probability.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickLevel {
    pub name: String,
    pub pool_size: u32,
    /// {award (positive=credit_x_bet, 0=end, negative=advance): count}
    /// Encoded as string keys to allow float keys including -1.0 / 0.0.
    pub award_distribution: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickChainParams {
    pub trigger_p: f64,
    pub levels: Vec<PickLevel>,
}

fn parse_award_key(k: &str) -> f64 {
    k.parse::<f64>().unwrap_or(0.0)
}

impl PickLevel {
    pub fn validate(&self) -> Result<(), String> {
        if self.pool_size == 0 {
            return Err(format!("level {}: pool_size must be > 0", self.name));
        }
        if self.award_distribution.is_empty() {
            return Err(format!("level {}: award_distribution must be non-empty", self.name));
        }
        let total: i64 = self.award_distribution.values().sum();
        if total != self.pool_size as i64 {
            return Err(format!(
                "level {}: counts {} ≠ pool_size {}",
                self.name, total, self.pool_size
            ));
        }
        if self.award_distribution.values().any(|&c| c < 0) {
            return Err(format!("level {}: counts must be ≥ 0", self.name));
        }
        Ok(())
    }
}

impl PickChainParams {
    pub fn validate(&self) -> Result<(), String> {
        if !(0.0..=1.0).contains(&self.trigger_p) {
            return Err(format!("trigger_p {} outside [0,1]", self.trigger_p));
        }
        if self.levels.is_empty() {
            return Err("levels must be non-empty".into());
        }
        for lvl in &self.levels {
            lvl.validate()?;
        }
        Ok(())
    }
}

pub fn level_advance_probability(level: &PickLevel) -> f64 {
    let advance_count = level.award_distribution.iter()
        .filter(|(k, _)| parse_award_key(k) < 0.0)
        .map(|(_, &c)| c as f64)
        .sum::<f64>();
    advance_count / level.pool_size as f64
}

pub fn level_end_probability(level: &PickLevel) -> f64 {
    let end_count = level.award_distribution.iter()
        .filter(|(k, _)| parse_award_key(k) == 0.0)
        .map(|(_, &c)| c as f64)
        .sum::<f64>();
    end_count / level.pool_size as f64
}

pub fn level_credit_probability(level: &PickLevel) -> f64 {
    1.0 - level_advance_probability(level) - level_end_probability(level)
}

pub fn expected_credit_per_pick(level: &PickLevel) -> f64 {
    let mut total_credit_count = 0.0_f64;
    let mut weighted_sum = 0.0_f64;
    for (k, &c) in &level.award_distribution {
        let award = parse_award_key(k);
        if award > 0.0 {
            total_credit_count += c as f64;
            weighted_sum += award * (c as f64);
        }
    }
    if total_credit_count == 0.0 {
        return 0.0;
    }
    weighted_sum / total_credit_count
}

pub fn expected_picks_at_level(level: &PickLevel) -> f64 {
    let n = level.pool_size as f64;
    let end_count = level.award_distribution.iter()
        .filter(|(k, _)| parse_award_key(k) == 0.0)
        .map(|(_, &c)| c as f64)
        .sum::<f64>();
    if end_count == 0.0 {
        return n;
    }
    (n + 1.0) / (end_count + 1.0)
}

pub fn expected_level_credit_contribution(level: &PickLevel) -> f64 {
    expected_picks_at_level(level)
        * level_credit_probability(level)
        * expected_credit_per_pick(level)
}

pub fn expected_total_award(p: &PickChainParams) -> f64 {
    let mut total = 0.0_f64;
    let mut p_reach = 1.0_f64;
    for level in &p.levels {
        total += p_reach * expected_level_credit_contribution(level);
        let adv_p = level_advance_probability(level);
        let end_p = level_end_probability(level);
        let denom = adv_p + end_p;
        if denom > 0.0 {
            p_reach *= adv_p / denom;
        } else {
            p_reach = 0.0;
        }
    }
    total
}

#[derive(Debug, Serialize)]
pub struct PerLevel {
    pub name: String,
    pub pool_size: u32,
    pub p_credit: f64,
    pub p_end: f64,
    pub p_advance: f64,
    pub expected_credit_per_pick: f64,
    pub expected_picks: f64,
    pub probability_reached: f64,
    pub credit_contribution_x_bet: f64,
}

#[derive(Debug, Serialize)]
pub struct PickChainResult {
    pub rtp_contribution: f64,
    pub trigger_p: f64,
    pub expected_total_award_x_bet: f64,
    pub levels: Vec<PerLevel>,
}

pub fn pick_chain_rtp(p: &PickChainParams) -> PickChainResult {
    let mut per_level: Vec<PerLevel> = Vec::with_capacity(p.levels.len());
    let mut p_reach = 1.0_f64;
    for level in &p.levels {
        let credit_p = level_credit_probability(level);
        let end_p = level_end_probability(level);
        let adv_p = level_advance_probability(level);
        let e_credit = expected_credit_per_pick(level);
        let e_picks = expected_picks_at_level(level);
        let contrib = p_reach * expected_level_credit_contribution(level);
        per_level.push(PerLevel {
            name: level.name.clone(),
            pool_size: level.pool_size,
            p_credit: credit_p,
            p_end: end_p,
            p_advance: adv_p,
            expected_credit_per_pick: e_credit,
            expected_picks: e_picks,
            probability_reached: p_reach,
            credit_contribution_x_bet: contrib,
        });
        let denom = adv_p + end_p;
        if denom > 0.0 {
            p_reach *= adv_p / denom;
        } else {
            p_reach = 0.0;
        }
    }
    let e_total: f64 = per_level.iter().map(|l| l.credit_contribution_x_bet).sum();
    PickChainResult {
        rtp_contribution: p.trigger_p * e_total,
        trigger_p: p.trigger_p,
        expected_total_award_x_bet: e_total,
        levels: per_level,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_level_all_credit() {
        let mut dist: BTreeMap<String, i64> = BTreeMap::new();
        dist.insert("2.0".into(), 6);
        let p = PickChainParams {
            trigger_p: 0.01,
            levels: vec![PickLevel {
                name: "L1".into(),
                pool_size: 6,
                award_distribution: dist,
            }],
        };
        // E[picks] = 6 (no end), credit_p=1, E[credit]=2 → contrib=12
        // RTP = 0.01 × 12 = 0.12
        let r = pick_chain_rtp(&p);
        assert!((r.rtp_contribution - 0.12).abs() < 1e-12);
    }
}
