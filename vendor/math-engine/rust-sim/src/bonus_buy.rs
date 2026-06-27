//! PAR-012 — Bonus Buy economics.
//!
//! Modern slot vendors (Pragmatic Play, Nolimit City, Hacksaw, Push Gaming, etc.)
//! sell direct access to the bonus round for a fixed multiple of base bet
//! ("cost_x"). The mathematical contract is:
//!
//!   cost_x = (1 / hit_rate) × premium_multiplier
//!
//! where premium_multiplier ∈ [1.05, 1.30] (5–30 % house edge on top of the
//! natural trigger cost). EV(buy) / cost is then `feature_rtp / cost_x` which
//! is normally ~1.15–1.30 × the base game RTP — the buy converts low-volatility
//! cheap spins into a single high-volatility shot.
//!
//! Regulatory regime (PAR-012 audit):
//!   * **UK** — Banned since 14 Sept 2023 (UKGC RTS 14F-G).
//!   * **Italy** — Banned since 2022 (ADM Decreto Direttoriale).
//!   * **NL / DE / NO** — Either banned or heavily restricted.
//!   * **MGA / curaçao / most US tribal** — Allowed, must show RTP.
//!
//! This module computes the EV / premium / warn-flag triple per IR-declared
//! BuyOffer so the PAR sheet exposes whether the offer is in regulatory range
//! and whether it represents value to the player.

use crate::ir::SlotGameIR;
use serde::{Deserialize, Serialize};

/// Bonus Buy banned in these jurisdictions (PAR-012 regulator audit).
pub const BONUS_BUY_BANNED_JURISDICTIONS: &[&str] = &["UKGC", "ADM", "ITALY", "UK", "IT"];

/// Per-offer EV summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BonusBuyEntry {
    pub id: String,
    pub guaranteed: String,
    pub cost_x: f64,
    /// Expected feature payout in bet multiples (closed-form proxy from RTP allocation).
    pub feature_ev_x: f64,
    /// `(cost_x − feature_ev_x) / cost_x × 100` — vendor's house edge on the buy.
    pub premium_pct: f64,
    /// `feature_ev_x / cost_x × 100` — effective RTP for the buy itself.
    pub effective_rtp_pct: f64,
    /// True when any active jurisdiction is in `BONUS_BUY_BANNED_JURISDICTIONS`.
    pub regulatory_warn: bool,
}

/// Whole-section Bonus Buy summary.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BonusBuySection {
    pub offers: Vec<BonusBuyEntry>,
}

impl BonusBuySection {
    /// Build from an IR + active jurisdiction codes.
    pub fn from_ir(ir: &SlotGameIR, jurisdictions: &[String]) -> Self {
        let warn = jurisdictions.iter().any(|j| {
            BONUS_BUY_BANNED_JURISDICTIONS
                .iter()
                .any(|b| j.eq_ignore_ascii_case(b))
        });

        let offers = match &ir.bet.buy_feature {
            Some(buys) => buys
                .iter()
                .map(|offer| {
                    let feature_ev_x = feature_ev_x_for(&offer.guaranteed, ir);
                    let cost = offer.cost_x.max(1e-9);
                    let premium_pct = ((cost - feature_ev_x) / cost) * 100.0;
                    let effective_rtp_pct = (feature_ev_x / cost) * 100.0;
                    BonusBuyEntry {
                        id: offer.id.clone(),
                        guaranteed: offer.guaranteed.clone(),
                        cost_x: offer.cost_x,
                        feature_ev_x,
                        premium_pct,
                        effective_rtp_pct,
                        regulatory_warn: warn,
                    }
                })
                .collect(),
            None => Vec::new(),
        };
        BonusBuySection { offers }
    }
}

/// Map a "guaranteed feature" id to a fair EV in bet multiples.
/// Sources: `ir.rtp_allocation.free_spins`, `hold_and_win`, etc. Bet base = 1×.
/// Falls back to `base_game` for unknown feature names.
fn feature_ev_x_for(guaranteed: &str, ir: &SlotGameIR) -> f64 {
    // RTP is fraction (e.g. 0.30 = 30%). Premium-cost expressed in bet units.
    // EV(feature) = feature_rtp_share × total_target_rtp × 1.0 / trigger_prob
    // For closed-form, we use `share = rtp_allocation.<feature>` directly as
    // bet-multiplier proxy (gives 30× for 30% allocation × 1.0 bet).
    let share = match guaranteed.to_ascii_lowercase().as_str() {
        "free_spins" | "super_free_spins" | "fs" => ir.rtp_allocation.free_spins,
        "hold_and_win" | "hnw" => ir.rtp_allocation.hold_and_win,
        "jackpot" | "progressive" => ir.rtp_allocation.jackpot,
        _ => ir.rtp_allocation.base_game,
    };
    share * 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warn_flag_triggers_on_banned_jurisdiction() {
        // Manually craft minimal IR shape via fixture file would be ideal; here
        // we test the warn predicate alone.
        let active = vec!["UKGC".to_string(), "MGA".to_string()];
        let warn = active.iter().any(|j| {
            BONUS_BUY_BANNED_JURISDICTIONS
                .iter()
                .any(|b| j.eq_ignore_ascii_case(b))
        });
        assert!(warn, "UKGC active must trigger bonus-buy ban warn");

        let safe = vec!["MGA".to_string(), "CW".to_string()];
        let warn2 = safe.iter().any(|j| {
            BONUS_BUY_BANNED_JURISDICTIONS
                .iter()
                .any(|b| j.eq_ignore_ascii_case(b))
        });
        assert!(!warn2, "MGA-only must NOT warn");
    }
}
