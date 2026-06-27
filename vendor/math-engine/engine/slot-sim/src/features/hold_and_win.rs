//! W4.5 / W4.16 — Hold-and-Win runner (Cash Eruption Fireball + Fort Knox).
//!
//! Two pay paths share one trigger gate:
//!
//!   * **Flat path** (`avg_pay_per_trigger`) — pays a single
//!     deterministic value equal to the published expected payout per
//!     trigger. Mean RTP is exact; per-trigger volatility is
//!     degenerate. Backed by `Feature::HoldAndWin.units` to choose
//!     between `total_bet_x` (default — engine × lines so divide-back
//!     yields total-bet-×) and `coin` (raw coin units — engine does
//!     NOT multiply by lines; FKWR contract). Pre-W4.16 the kernel
//!     unconditionally multiplied by `lines` which over-paid FKWR
//!     ~5–7× because its `avg_pay_per_trigger` was already in coins.
//!
//!   * **Pages path** (`pages` non-empty) — samples per-bet-multiplier
//!     coin-distribution + respin chain (Cash Eruption Fireball math).
//!     Ported from `games/ce-copy-test/engine-rust/src/cash_eruption.rs`
//!     which converged to <0.1% delta on 50M MC. The page schema is
//!     the same as that pipeline (set_pool_weights /
//!     small_coin_dist / big_coin_dist / pots_small / pots_big /
//!     respin_tables / grand_prob_base / grand_prob_fs / top_award).
//!     Each respin draws additional Fireballs from
//!     `respin_tables[n_landed][remaining]`; each new Fireball pays a
//!     coin value sampled from the SMALL distribution (per CE rule
//!     C3961). When the grid fills (15 cells) the feature ends.

use crate::evaluate::SpinWin;
use crate::features::FeatureOutcome;
use crate::ir::{CoinValue, Evaluation, HoldAndWinPage, Ir, Pot, SetPoolWeights};
use crate::rng::Prng;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy)]
pub struct HoldAndWinParams<'a> {
    pub trigger_symbol: &'a str,
    pub trigger_count_min: u32,
    pub trigger_prob: Option<f64>,
    pub avg_pay_per_trigger: Option<f64>,
    /// W4.16 — when `Some` and non-empty, the runner uses the per-page
    /// CE Fireball math (set_pool / coin_dist / respin_tables /
    /// grand_prob). When `None`, falls back to the flat path.
    pub pages: Option<&'a BTreeMap<String, HoldAndWinPage>>,
    /// W4.16 — flat-path units contract (see `Feature::HoldAndWin::units`).
    pub units: Option<&'a str>,
    /// W4.16 — `true` when called from FS context. Affects the grand
    /// probability gate in the pages path (FS-only `grand_prob_fs`).
    pub fs_context: bool,
}

pub fn run(
    params: HoldAndWinParams,
    ir: &Ir,
    base: &SpinWin,
    rng: &mut Prng,
) -> FeatureOutcome {
    let mut out = FeatureOutcome::default();

    let triggered = if let Some(p) = params.trigger_prob {
        if p <= 0.0 {
            false
        } else {
            rng.gen_f64() < p
        }
    } else {
        let count = *base
            .role_counts
            .get(params.trigger_symbol)
            .unwrap_or(&0);
        count >= params.trigger_count_min
    };
    if !triggered {
        return out;
    }

    // W4.16 — pages-sampling path. When a page exists for BM=1 (or
    // the only emitted page), sample using the full Fireball math
    // ported from games/ce-copy-test/engine-rust/src/cash_eruption.rs.
    // CE published `pages` per-bet-multiplier; engine MC runs at
    // BM=1 (`Engine::run(_, 1, _)`), so we pick the BM=1 page.
    if let Some(pages) = params.pages {
        if let Some(page) = pick_page(pages) {
            // Base trigger: number of fireballs on grid = initial_samples
            // = initial_landed (one fireball = one cell). Each cell
            // draws coin value from the SMALL distribution per CE rule
            // C3961.
            let initial_landed = *base
                .role_counts
                .get(params.trigger_symbol)
                .unwrap_or(&page.fs_initial_landed.unwrap_or(6));
            let initial_samples = initial_landed;
            let coins_paid = run_pages_sample(
                page,
                initial_samples,
                initial_landed,
                false, // use SMALL dist for base trigger
                params.fs_context,
                rng,
            );
            // `coins_paid` is in raw coin units already. The slot-sim
            // dispatcher does `feat.coins / lines` to convert from
            // per-line to total-bet-× — to make that yield
            // `coins_paid / (lines × bm)` (CE's `payout_x =
            // coins / total_bet_coins`), we emit `coins_paid` and
            // rely on the divide-back. Since `Engine::run(n,
            // bet_multiplier=1, seed)` is the test path and total
            // bet at BM=1 = lines × 1 = lines, the divide-back
            // matches exactly: per-spin total-bet-× = coins_paid /
            // lines = coins_paid / total_bet_coins.
            out.coins += coins_paid;
            out.events.push("hold_and_win:triggered".into());
            return out;
        }
    }

    // Flat path. Determine pay value.
    let Some(avg_pay) = params.avg_pay_per_trigger else {
        out.events.push("hold_and_win:no_pay_configured".into());
        return out;
    };
    if avg_pay <= 0.0 {
        return out;
    }
    let lines = lines_of(ir);
    // W4.16 — units contract:
    //   * `total_bet_x` (default) → × lines so divide-back yields x;
    //   * `coin`                    → raw coin units, no multiply.
    let multiplier = match params.units {
        Some("coin") => 1.0,
        _ => lines as f64,
    };
    out.coins += avg_pay * multiplier;
    out.events.push("hold_and_win:triggered".into());
    out
}

fn lines_of(ir: &Ir) -> u32 {
    match &ir.evaluation {
        Evaluation::Lines { lines, .. } => lines.len() as u32,
        _ => ir.bet_table.lines,
    }
}

// ────────────────────────── pages sampling (CE Fireball) ──────────────────────────

/// W4.16 — pick the page used for a single trigger. Engine MC runs at
/// `bet_multiplier=1` so we prefer the page keyed `"1"`; if absent we
/// fall back to the page with the smallest `bet_multiplier` (CE's BM=1
/// is always emitted by the IR builder).
pub fn pick_page(pages: &BTreeMap<String, HoldAndWinPage>) -> Option<&HoldAndWinPage> {
    if let Some(p) = pages.get("1") {
        return Some(p);
    }
    let mut best: Option<&HoldAndWinPage> = None;
    for p in pages.values() {
        match best {
            None => best = Some(p),
            Some(b) if p.bet_multiplier < b.bet_multiplier => best = Some(p),
            _ => {}
        }
    }
    best
}

/// W4.16 — run one CE Fireball feature trigger and return the total
/// coin payout (raw coin units). Ports the
/// `games/ce-copy-test/engine-rust` `run_cash_eruption` math.
///
/// `initial_samples` — number of coin draws on trigger (base = #cells,
///                     FS = #blocks).
/// `initial_landed`  — grid coverage for respin-table lookup (base =
///                     #cells, FS = #blocks × 9 cells per block).
/// `initial_use_big` — when `true`, the initial draw samples from the
///                     BIG distribution (FS-only). Respin adds ALWAYS
///                     sample from the SMALL distribution (CE rule
///                     C3961).
/// `fs_context`      — when `true`, the GRAND gate uses `grand_prob_fs`
///                     instead of `grand_prob_base`.
pub fn run_pages_sample(
    page: &HoldAndWinPage,
    initial_samples: u32,
    initial_landed: u32,
    initial_use_big: bool,
    fs_context: bool,
    rng: &mut Prng,
) -> f64 {
    // GRAND gate — once per feature.
    let grand_prob = if fs_context {
        page.grand_prob_fs.unwrap_or(0.0)
    } else {
        page.grand_prob_base.unwrap_or(0.0)
    };
    if grand_prob > 0.0 && rng.gen_f64() < grand_prob {
        return page.top_award.unwrap_or(0) as f64;
    }
    // Pool select (low/med/high) — once per feature.
    let pool = pick_pool(&page.set_pool_weights, rng);
    // Initial draws.
    let small = build_pool_dist(&page.small_coin_dist, pots_for(page, false));
    let big = build_pool_dist(&page.big_coin_dist, pots_for(page, true));
    let init_dist = if initial_use_big { &big } else { &small };
    let respin_dist = &small;
    let mut payout = 0.0f64;
    for _ in 0..initial_samples {
        payout += sample_pool(init_dist, &pool, rng) as f64;
    }
    // Respin loop — start with 3 remaining; reset on any new Fireball.
    let mut landed = initial_landed.min(15);
    let mut remaining: u32 = 3;
    let mut iters: u32 = 0;
    while remaining > 0 && iters < 64 {
        iters += 1;
        let key_landed = landed.min(14);
        let table = lookup_respin(page, key_landed, remaining);
        let Some(table) = table else { break };
        let n_add = sample_cumtable(table, rng);
        if n_add == 0 {
            remaining -= 1;
            continue;
        }
        for _ in 0..n_add {
            payout += sample_pool(respin_dist, &pool, rng) as f64;
        }
        landed = (landed + n_add).min(15);
        remaining = 3; // reset on any new fireball
        if landed >= 15 {
            break;
        }
    }
    payout
}

#[derive(Debug, Clone, Copy)]
enum Pool {
    Low,
    Med,
    High,
}

fn pick_pool(w: &SetPoolWeights, rng: &mut Prng) -> Pool {
    let low = w.low.max(0) as u64;
    let med = w.med.max(0) as u64;
    let high = w.high.max(0) as u64;
    let total = (w.total.max(0) as u64).max(low + med + high).max(1);
    let r = (rng.gen_u32() as u64) % total;
    if r < low {
        Pool::Low
    } else if r < low + med {
        Pool::Med
    } else {
        Pool::High
    }
}

#[derive(Debug, Clone, Copy)]
enum FbValue {
    Coin(i64),
    Mini,
    Minor,
    Major,
}

#[derive(Debug, Clone)]
struct CumPool {
    items: Vec<(FbValue, i64)>,
    total: i64,
}

#[derive(Debug, Clone)]
struct PoolDist {
    low: CumPool,
    med: CumPool,
    high: CumPool,
    mini_value: i64,
    minor_value: i64,
    major_value: i64,
}

fn build_cum(pairs: Vec<(FbValue, i64)>) -> CumPool {
    let mut total = 0i64;
    let mut items = Vec::with_capacity(pairs.len());
    for (it, w) in pairs {
        if w <= 0 {
            continue;
        }
        total += w;
        items.push((it, total));
    }
    CumPool { items, total }
}

fn pots_for(page: &HoldAndWinPage, big_side: bool) -> &BTreeMap<String, Pot> {
    if big_side {
        if !page.pots_big.is_empty() {
            &page.pots_big
        } else {
            &page.pots
        }
    } else if !page.pots_small.is_empty() {
        &page.pots_small
    } else {
        &page.pots
    }
}

fn build_pool_dist(values: &[CoinValue], pots: &BTreeMap<String, Pot>) -> PoolDist {
    let mut low_pairs: Vec<(FbValue, i64)> = Vec::new();
    let mut med_pairs: Vec<(FbValue, i64)> = Vec::new();
    let mut high_pairs: Vec<(FbValue, i64)> = Vec::new();
    for v in values {
        if v.low > 0 {
            low_pairs.push((FbValue::Coin(v.coin_value), v.low));
        }
        if v.med > 0 {
            med_pairs.push((FbValue::Coin(v.coin_value), v.med));
        }
        if v.high > 0 {
            high_pairs.push((FbValue::Coin(v.coin_value), v.high));
        }
    }
    let mut mini_v = 0i64;
    let mut minor_v = 0i64;
    let mut major_v = 0i64;
    for (tier, pot) in pots {
        let fb = match tier.as_str() {
            "MINI" => {
                mini_v = pot.value;
                FbValue::Mini
            }
            "MINOR" => {
                minor_v = pot.value;
                FbValue::Minor
            }
            "MAJOR" => {
                major_v = pot.value;
                FbValue::Major
            }
            _ => continue,
        };
        if pot.low > 0 {
            low_pairs.push((fb, pot.low));
        }
        if pot.med > 0 {
            med_pairs.push((fb, pot.med));
        }
        if pot.high > 0 {
            high_pairs.push((fb, pot.high));
        }
    }
    PoolDist {
        low: build_cum(low_pairs),
        med: build_cum(med_pairs),
        high: build_cum(high_pairs),
        mini_value: mini_v,
        minor_value: minor_v,
        major_value: major_v,
    }
}

fn sample_pool(dist: &PoolDist, pool: &Pool, rng: &mut Prng) -> i64 {
    let cum = match pool {
        Pool::Low => &dist.low,
        Pool::Med => &dist.med,
        Pool::High => &dist.high,
    };
    if cum.items.is_empty() || cum.total <= 0 {
        return 0;
    }
    let r = rng.gen_range_i64(cum.total);
    let idx = cum.items.partition_point(|(_, cum_w)| *cum_w <= r);
    let idx = idx.min(cum.items.len() - 1);
    match cum.items[idx].0 {
        FbValue::Coin(c) => c,
        FbValue::Mini => dist.mini_value,
        FbValue::Minor => dist.minor_value,
        FbValue::Major => dist.major_value,
    }
}

fn lookup_respin(
    page: &HoldAndWinPage,
    landed: u32,
    remaining: u32,
) -> Option<RespinTable> {
    let mut try_landed = landed;
    loop {
        let key = try_landed.to_string();
        if let Some(by_remaining) = page.respin_tables.get(&key) {
            let rem_key = remaining.to_string();
            if let Some(by_add) = by_remaining.get(&rem_key) {
                let mut pairs: Vec<(u32, i64)> = Vec::new();
                for (k, v) in by_add {
                    if k == "total" {
                        continue;
                    }
                    let Ok(n_add) = k.parse::<u32>() else { continue };
                    if *v > 0 {
                        pairs.push((n_add, *v));
                    }
                }
                pairs.sort_by_key(|(a, _)| *a);
                if pairs.is_empty() {
                    return None;
                }
                let mut total = 0i64;
                let mut items: Vec<(u32, i64)> = Vec::with_capacity(pairs.len());
                for (n_add, w) in pairs {
                    total += w;
                    items.push((n_add, total));
                }
                return Some(RespinTable { items, total });
            }
        }
        if try_landed <= 6 {
            return None;
        }
        try_landed -= 1;
    }
}

#[derive(Debug, Clone)]
struct RespinTable {
    /// `(n_add, cum_weight)` sorted ascending by `cum_weight`.
    items: Vec<(u32, i64)>,
    total: i64,
}

fn sample_cumtable(table: RespinTable, rng: &mut Prng) -> u32 {
    if table.items.is_empty() || table.total <= 0 {
        return 0;
    }
    let r = rng.gen_range_i64(table.total);
    let idx = table.items.partition_point(|(_, cum_w)| *cum_w <= r);
    let idx = idx.min(table.items.len() - 1);
    table.items[idx].0
}
