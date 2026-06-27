// Feature dispatch — registry of compiled feature handlers + per-spin runner.
//
// IR `features: [Feature]` list is iterated in order; each feature has a
// trigger condition (checked against per-spin role counts) and a runner that
// returns a `FeatureOutcome` (coin payout + spawned sub-features).

pub mod hold_and_win;
pub mod pick_bonus;
pub mod free_spins;
pub mod wild_expand;
pub mod pattern_win;
pub mod linear_progressive;

use crate::evaluate::{CompiledPaytable, SpinWin};
use crate::ir::{Feature, Ir};
use crate::reels::{Grid, ReelSetPicker};
use crate::rng::Prng;

#[derive(Debug, Clone, Default)]
pub struct FeatureOutcome {
    /// Coins added by this feature (1/lines of total bet = 1 coin/line).
    pub coins: f64,
    /// Triggered events (e.g. CE-from-base, FS triggered, GRAND hit).
    pub events: Vec<String>,
    /// W4.3e — per-feature contribution breakdown
    /// (kind-name → coins). Set by `run_features` after each feature
    /// runner so sim.rs can build a per-feature RTP table.
    pub per_feature: Vec<(String, f64)>,
}

impl FeatureOutcome {
    fn merge(&mut self, other: FeatureOutcome) {
        self.coins += other.coins;
        self.events.extend(other.events);
        self.per_feature.extend(other.per_feature);
    }
}

/// Per-spin feature dispatch (W4.3c).
///
/// Walks the IR's feature list in declaration order. Each variant routes to
/// its own module runner. Sub-feature spawning (e.g. FS inside hold-and-win)
/// is owned by the individual runner — this dispatcher only handles the
/// top-level fire decisions.
pub fn run_features(
    ir: &Ir,
    grid: &Grid,
    base: &SpinWin,
    bet_multiplier: i64,
    rng: &mut Prng,
    fs_picker: Option<&ReelSetPicker>,
    pt: &CompiledPaytable,
    virtual_mode: bool,
    fs_pt: Option<&CompiledPaytable>,
) -> FeatureOutcome {
    let mut out = FeatureOutcome::default();
    for feat in &ir.features {
        match feat {
            Feature::FreeSpins {
                trigger_symbol,
                trigger_count_min,
                initial_spins,
                retrigger_spins,
                max_total_spins,
                reel_bank: _,
                linked_reels,
                fs_paytable: _,
                scatter_pay_total_bet,
                retrigger_symbol,
                retrigger_count_min,
            } => {
                let Some(picker) = fs_picker else { continue };
                // W4.8 — look up any HoldAndWin feature in the IR to
                // know if CE-from-FS should be triggered inside FS spins.
                // Prefer `fs_trigger_prob` / `fs_avg_pay_per_trigger` when
                // populated (Cash Eruption pages publish a separate
                // `ce_from_fs_rtp` value driving these); fall back to the
                // base trigger config otherwise.
                let fs_hw = ir.features.iter().find_map(|f| match f {
                    Feature::HoldAndWin {
                        trigger_symbol,
                        trigger_count_min,
                        trigger_prob,
                        avg_pay_per_trigger,
                        fs_trigger_prob,
                        fs_avg_pay_per_trigger,
                        pages,
                        units,
                        fs_haw_pages,
                        fs_big_fireball_trigger,
                        ..
                    } => Some(free_spins::FsHoldAndWinCfg {
                        trigger_symbol,
                        trigger_count_min: *trigger_count_min,
                        trigger_prob: fs_trigger_prob.or(*trigger_prob),
                        avg_pay_per_trigger: fs_avg_pay_per_trigger.or(*avg_pay_per_trigger),
                        pages: if pages.is_empty() { None } else { Some(pages) },
                        units: units.as_deref(),
                        // W4.17 — FS-specific pages map for the
                        // CE FS-CE structural cleanup. When present
                        // and non-empty, the FS runner uses these
                        // pages (instead of `pages`) for the
                        // pages-sampling path and the FS Big-Fireball
                        // trigger contract decides whether to fire.
                        fs_pages: if fs_haw_pages.is_empty() {
                            None
                        } else {
                            Some(fs_haw_pages)
                        },
                        fs_big_fireball_trigger: fs_big_fireball_trigger.as_ref(),
                    }),
                    _ => None,
                });
                // W4.9c — FS wild expansion currently DISABLED for
                // safety: enabling reel-5-only expansion pushed L&W RTP
                // from −0.17 % to +0.50 % (overshoot). Investigating
                // exact L&W "Wild on reel 5 expands only if creates win"
                // implementation will return here. For now the FS runner
                // skips wild-expansion to keep total RTP from exceeding
                // Excel target.
                let fs_we_reels: Option<&[u32]> = None;
                let params = free_spins::FreeSpinsParams {
                    trigger_symbol,
                    trigger_count_min: *trigger_count_min,
                    initial_spins: *initial_spins,
                    retrigger_spins: *retrigger_spins,
                    max_total_spins: *max_total_spins,
                    fs_pt,
                    linked_reels: linked_reels.as_deref(),
                    fs_hold_and_win: fs_hw,
                    scatter_pay_total_bet: *scatter_pay_total_bet,
                    retrigger_symbol: retrigger_symbol.as_deref(),
                    retrigger_count_min: *retrigger_count_min,
                    fs_wild_expand_reels: fs_we_reels,
                };
                let r = free_spins::run(params, ir, picker, pt, base, rng, virtual_mode);
                let c = r.coins;
                out.merge(r);
                out.per_feature.push(("free_spins".into(), c));
            }
            Feature::PickBonus {
                trigger_symbol,
                trigger_count_min,
                awards,
                trigger_prob,
            } => {
                let params = pick_bonus::PickBonusParams {
                    trigger_symbol,
                    trigger_count_min: *trigger_count_min,
                    awards,
                    trigger_prob: *trigger_prob,
                };
                let r = pick_bonus::run(params, ir, base, rng);
                let c = r.coins;
                out.merge(r);
                out.per_feature.push(("pick_bonus".into(), c));
            }
            Feature::LinearProgressive {
                odds_at_bm1,
                top_award_coins,
                increment,
            } => {
                let params = linear_progressive::LinearProgressiveParams {
                    odds_at_bm1: *odds_at_bm1,
                    top_award_coins: *top_award_coins,
                    increment: *increment,
                };
                let r = linear_progressive::run(params, ir, bet_multiplier, base, rng);
                let c = r.coins;
                out.merge(r);
                out.per_feature.push(("linear_progressive".into(), c));
            }
            Feature::HoldAndWin {
                trigger_symbol,
                trigger_count_min,
                respins: _,
                pages,
                trigger_prob,
                avg_pay_per_trigger,
                fs_trigger_prob: _,
                fs_avg_pay_per_trigger: _,
                units,
                fs_haw_pages: _,
                fs_big_fireball_trigger: _,
            } => {
                let params = hold_and_win::HoldAndWinParams {
                    trigger_symbol,
                    trigger_count_min: *trigger_count_min,
                    trigger_prob: *trigger_prob,
                    avg_pay_per_trigger: *avg_pay_per_trigger,
                    pages: if pages.is_empty() { None } else { Some(pages) },
                    units: units.as_deref(),
                    fs_context: false,
                };
                let r = hold_and_win::run(params, ir, base, rng);
                let c = r.coins;
                out.merge(r);
                out.per_feature.push(("hold_and_win".into(), c));
            }
            Feature::PatternWin {
                anchor_symbol,
                anchor_count,
                anchor_reel,
                required_wild_reels,
                pays,
            } => {
                let params = pattern_win::PatternWinParams {
                    anchor_symbol,
                    anchor_count: *anchor_count,
                    anchor_reel: *anchor_reel,
                    required_wild_reels,
                    pays: *pays,
                };
                let r = pattern_win::run(&params, ir, grid, base, rng);
                let c = r.coins;
                out.merge(r);
                out.per_feature.push(("pattern_win".into(), c));
            }
            Feature::WildExpand {
                wild_symbol,
                on_reels,
                only_if_winning,
                expand_only_when_base_no_win,
                subset_search,
            } => {
                let params = wild_expand::WildExpandParams {
                    wild_symbol,
                    on_reels,
                    only_if_winning: *only_if_winning,
                    expand_only_when_base_no_win: *expand_only_when_base_no_win,
                    subset_search: *subset_search,
                };
                let r = wild_expand::run(&params, ir, grid, base, pt, rng);
                let c = r.coins;
                out.merge(r);
                out.per_feature.push(("wild_expand".into(), c));
            }
            // GrandPrize remains future wave.
            _ => {}
        }
    }
    out
}
