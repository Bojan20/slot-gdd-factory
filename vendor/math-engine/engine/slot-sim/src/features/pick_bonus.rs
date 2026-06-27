//! W4.3c — Pick Bonus runner (IGT Fort Knox / Wolf Run style).
//!
//! Triggered when `trigger_symbol` appears at least `trigger_count_min`
//! times on the base-game grid. The award table is weighted: one award is
//! sampled per trigger and its `pays_coins` value is returned (per-line
//! units so the engine's `feat.coins / lines` divide-back produces the
//! correct total-bet-× contribution).

use crate::evaluate::SpinWin;
use crate::features::FeatureOutcome;
use crate::ir::{Evaluation, Ir, PickAward};
use crate::rng::Prng;

#[derive(Debug, Clone, Copy)]
pub struct PickBonusParams<'a> {
    pub trigger_symbol: &'a str,
    pub trigger_count_min: u32,
    pub awards: &'a [PickAward],
    /// W4.3c — Bernoulli trigger override (Fort Knox style).
    pub trigger_prob: Option<f64>,
}

pub fn run(
    params: PickBonusParams,
    ir: &Ir,
    base: &SpinWin,
    rng: &mut Prng,
) -> FeatureOutcome {
    let mut out = FeatureOutcome::default();

    if params.awards.is_empty() {
        return out;
    }

    // Trigger dispatch:
    //   - Bernoulli when `trigger_prob` is Some (IGT FK style)
    //   - Scatter count threshold otherwise (Aristocrat etc.)
    let triggered = if let Some(p) = params.trigger_prob {
        if p <= 0.0 {
            false
        } else {
            rng.gen_f64() < p
        }
    } else {
        let trig = *base
            .role_counts
            .get(params.trigger_symbol)
            .unwrap_or(&0);
        trig >= params.trigger_count_min
    };
    if !triggered {
        return out;
    }

    // Sample one award using its weight column.
    let total: i64 = params.awards.iter().map(|a| a.weight).sum();
    if total <= 0 {
        return out;
    }
    let r = rng.gen_range_i64(total);
    let mut running: i64 = 0;
    let mut chosen = &params.awards[0];
    for a in params.awards {
        running += a.weight;
        if r < running {
            chosen = a;
            break;
        }
    }

    // pays_coins is in per-line accounting (mirror of `line_coins`); the
    // engine's `feat.coins / lines` will convert to total-bet-×.
    let lines = lines_of(ir);
    out.coins += chosen.pays_coins * (lines as f64);
    out.events.push(format!("pick_bonus:{}", chosen.label));
    out
}

fn lines_of(ir: &Ir) -> u32 {
    match &ir.evaluation {
        Evaluation::Lines { lines, .. } => lines.len() as u32,
        _ => ir.bet_table.lines,
    }
}
