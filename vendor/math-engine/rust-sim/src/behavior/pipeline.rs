//! Faza 3 — Symbol Behavior Plugin Layer: Effect Pipeline (Rust)
//!
//! Mirrors `src/behaviors/pipeline.ts`.

use super::types::{Effect, EffectScope, LockedPosition, SpinState};

// ─── apply_effect ─────────────────────────────────────────────────────────────

/// Apply a single Effect to SpinState in-place.
pub fn apply_effect(state: &mut SpinState, effect: &Effect) {
    match effect {
        Effect::Noop => {}

        Effect::MultiplierAdd { value, scope } => {
            adjust_multiplier(state, *scope, *value - 1.0, false);
        }

        Effect::MultiplierMul { value, scope } => {
            adjust_multiplier(state, *scope, *value, true);
        }

        Effect::TransformSymbol {
            reel,
            row,
            to_symbol,
        } => {
            if let Some(col) = state.grid.get_mut(*reel) {
                if let Some(cell) = col.get_mut(*row) {
                    *cell = to_symbol.clone();
                }
            }
        }

        Effect::ExpandWild { reel, symbol } => {
            if let Some(col) = state.grid.get_mut(*reel) {
                for cell in col.iter_mut() {
                    *cell = symbol.clone();
                }
            }
        }

        Effect::LockPosition {
            reel,
            row,
            remaining_spins,
        } => {
            let existing = state
                .locked_positions
                .iter_mut()
                .find(|lp| lp.reel == *reel && lp.row == *row);
            if let Some(lp) = existing {
                lp.remaining_spins = lp.remaining_spins.max(*remaining_spins);
            } else {
                let sym = state
                    .grid
                    .get(*reel)
                    .and_then(|c| c.get(*row))
                    .cloned()
                    .unwrap_or_else(|| "W".to_string());
                state.locked_positions.push(LockedPosition {
                    reel: *reel,
                    row: *row,
                    symbol: sym,
                    remaining_spins: *remaining_spins,
                });
            }
        }

        Effect::AddWild { reel, row, symbol } => {
            if let Some(col) = state.grid.get_mut(*reel) {
                if let Some(cell) = col.get_mut(*row) {
                    *cell = symbol.clone();
                }
            }
        }

        Effect::CollectCoin { reel, row, amount } => {
            state.collected_coins.push(super::types::CollectedCoin {
                reel: *reel,
                row: *row,
                amount: *amount,
            });
        }

        Effect::TriggerFeature { feature_id } => {
            state.triggered_features.insert(feature_id.clone());
        }

        Effect::AwardJackpot { tier, amount } => {
            if state.jackpot_awarded.is_none() {
                state.jackpot_awarded = Some((tier.clone(), *amount));
            }
        }

        Effect::UpgradeSymbols {
            from_symbol,
            to_symbol,
        } => {
            for col in state.grid.iter_mut() {
                for cell in col.iter_mut() {
                    if cell == from_symbol {
                        *cell = to_symbol.clone();
                    }
                }
            }
            state
                .upgrades
                .push((from_symbol.clone(), to_symbol.clone()));
        }

        Effect::ScatterPay { multiplier, .. } => {
            state.scatter_payout += multiplier;
        }

        Effect::Respin { count } => {
            state.respins_awarded += count;
        }
    }
}

/// Apply a slice of Effects in order.
pub fn apply_effects(state: &mut SpinState, effects: &[Effect]) {
    for e in effects {
        apply_effect(state, e);
    }
}

// ─── Multiplier helper ────────────────────────────────────────────────────────

fn adjust_multiplier(state: &mut SpinState, scope: EffectScope, value: f64, mul: bool) {
    let target = match scope {
        EffectScope::Line => &mut state.line_multiplier,
        EffectScope::Ways => &mut state.spin_multiplier,
        EffectScope::Spin => &mut state.spin_multiplier,
        EffectScope::Session => &mut state.session_multiplier,
    };
    if mul {
        *target *= value;
    } else {
        *target += value;
    }
}

// ─── Locked-position tick ─────────────────────────────────────────────────────

/// Decrement all locked positions. Removes those reaching 0.
/// Returns released positions.
pub fn tick_locked_positions(state: &mut SpinState) -> Vec<(usize, usize)> {
    let mut released = Vec::new();
    state.locked_positions.retain_mut(|lp| {
        lp.remaining_spins = lp.remaining_spins.saturating_sub(1);
        if lp.remaining_spins == 0 {
            released.push((lp.reel, lp.row));
            false
        } else {
            true
        }
    });
    released
}

/// Restore all locked-position symbols onto the grid (spin-start).
pub fn restore_locked_positions(state: &mut SpinState) {
    for lp in &state.locked_positions {
        if let Some(col) = state.grid.get_mut(lp.reel) {
            if let Some(cell) = col.get_mut(lp.row) {
                *cell = lp.symbol.clone();
            }
        }
    }
}
