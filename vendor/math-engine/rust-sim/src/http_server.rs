//! LV3-2 — long-lived Axum HTTP simulator daemon.
//!
//! # Purpose
//!
//! The auto-converge solver in `slot-gdd-factory` (LV3-13) needs to issue
//! **thousands** of parameter probes to drive `slot_sim` toward an exact
//! RTP target inside a ±0.05 pp band. The current implementation
//! (`tools/sister-rust-server.mjs`, LV3-1) spawns the `slot_sim` CLI
//! binary once per probe and pays ~50 ms of process-setup cost on every
//! call. 10 000 probes × 50 ms = **8 minutes wasted** before any real
//! simulation work happens.
//!
//! This module exposes the same engine as a long-lived Axum daemon:
//!
//!   - `GET  /health` — liveness + engine version + uptime.
//!   - `POST /spin`   — single MC run (mirrors `slot_sim --quick`).
//!   - `POST /batch`  — N independent MC runs in one round-trip.
//!
//! Each `/spin` call reuses the warm `slot_sim` engine, so the per-probe
//! overhead drops from ~50 ms (process spawn) to ~1–3 ms (TCP round-trip
//! on loopback). The MC kernel itself dominates wall-time as it should.
//!
//! # Output contract
//!
//! Each spin response contains the **same three keys** the LV3-1
//! `_findSummary` parser requires (`rtp`, `hits`, `spins`) plus a
//! pre-formatted `summary` field with the canonical
//! `SUMMARY|rtp=...|hits=...|spins=...|hit_rate=...` line. That lets a
//! transitional HTTP-mode client reuse the existing SUMMARY-line parser
//! verbatim — no double contract drift.
//!
//! # Security
//!
//! The server binds to **loopback only** by default. Public-LAN binds
//! must pass `--allow-public-bind` explicitly (mirrors the Cortex daemon
//! `LOOPBACK default + secret ≥24 chars` rule the LV3 series inherits
//! from the wider Cortex hardening doctrine).
//!
//! Request limits are enforced **before** invoking the MC kernel so a
//! malicious payload cannot fork-bomb the box:
//!
//!   - per-request body size cap (`max_body_bytes`, default 8 MiB)
//!   - per-request total spin cap (`max_total_spins_per_request`,
//!     default 50 000 000 = same as `--quick`)
//!   - per-request seed cap (`max_seeds_per_request`, default 64)
//!   - batch item-count cap (`max_batch_items`, default 64)
//!   - global in-flight semaphore (`max_concurrent_runs`, default =
//!     `available_parallelism / 2`, min 1) so /batch with 1000 items
//!     does not starve the CPU
//!
//! Any violation returns `400 Bad Request` with a structured JSON error
//! and never reaches the simulator.
//!
//! # Feature gate
//!
//! Compiled only when `--features http` is enabled — pure-engine
//! consumers (wasm-oracle, gpu kernels) keep their build graph free of
//! axum/tokio. See `Cargo.toml` `[features] http = [...]`.

use crate::config::GameConfig;
use crate::simulator::{self, SimConfig};
use crate::stats::AtomicStats;

use axum::{
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::{IntoResponse, Json as AxumJson, Response},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Semaphore;

// ─── Compile-time engine version stamp ──────────────────────────────────────
//
// Pulled from the crate manifest so the `/health` payload always matches
// the binary the operator actually launched (manual string drift is the
// classic LV3-1 audit catch — never embed a literal version here).

const ENGINE_NAME: &str = env!("CARGO_PKG_NAME");
const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

// ─── Defaults (chosen to mirror existing CLI behavior 1-to-1) ───────────────
//
// `slot_sim --quick` runs 5_000_000 × 10 = 50_000_000 spins. The HTTP
// /spin defaults are exactly the same so a caller that ports a CLI
// probe to HTTP gets byte-identical numbers (modulo float epsilon).
const DEFAULT_SPINS_PER_SEED: u64 = 5_000_000;
const DEFAULT_NUM_SEEDS: u32 = 10;
const DEFAULT_BASE_SEED: u64 = 1;
const DEFAULT_TOTAL_BET_MC: i64 = 1_000;

// ─── ServerOptions — knobs the binary wires from CLI flags ──────────────────

/// Knob bundle for `router(...)`. Keeps the public surface small and
/// makes unit tests trivially configurable (pass a tighter cap, assert
/// 400 on overrun, no global state to reset).
#[derive(Debug, Clone)]
pub struct ServerOptions {
    /// Hard cap on total spins per single `/spin` or per `/batch` item
    /// (spins_per_seed × num_seeds). Anything larger → 400.
    pub max_total_spins_per_request: u64,
    /// Hard cap on `num_seeds` per request. Anything larger → 400.
    pub max_seeds_per_request: u32,
    /// Hard cap on items in one `/batch` request. Anything larger → 400.
    pub max_batch_items: usize,
    /// Per-request body size cap (axum `DefaultBodyLimit`). Anything
    /// larger → 413 Payload Too Large before deserialization.
    pub max_body_bytes: usize,
    /// Global in-flight semaphore permits. Bounds CPU starvation when
    /// many large /batch payloads arrive concurrently.
    pub max_concurrent_runs: usize,
}

impl Default for ServerOptions {
    fn default() -> Self {
        let cores = std::thread::available_parallelism()
            .map(std::num::NonZeroUsize::get)
            .unwrap_or(1);
        Self {
            max_total_spins_per_request: 50_000_000, // matches `--quick`
            max_seeds_per_request: 64,
            max_batch_items: 64,
            max_body_bytes: 8 * 1024 * 1024,         // 8 MiB
            max_concurrent_runs: (cores / 2).max(1), // leave room for OS
        }
    }
}

// ─── AppState — shared inside Router (Arc'd by axum) ────────────────────────

/// Daemon-wide state. Cheap to clone because every field is either
/// `Arc<_>` or `Copy`. Tests construct it directly via `AppState::for_test`.
#[derive(Clone)]
pub struct AppState {
    pub(crate) opts: ServerOptions,
    pub(crate) start_instant: Instant,
    pub(crate) start_epoch_secs: u64,
    pub(crate) spin_request_count: Arc<AtomicU64>,
    pub(crate) batch_request_count: Arc<AtomicU64>,
    pub(crate) total_spins_run: Arc<AtomicU64>,
    pub(crate) inflight_permits: Arc<Semaphore>,
}

impl AppState {
    /// Production constructor. `Instant::now()` + wall-clock epoch are
    /// captured once at daemon start so `/health` reports both monotonic
    /// uptime (drift-free) and a UNIX timestamp (operator-friendly).
    pub fn new(opts: ServerOptions) -> Self {
        let permits = Arc::new(Semaphore::new(opts.max_concurrent_runs));
        let start_epoch_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Self {
            opts,
            start_instant: Instant::now(),
            start_epoch_secs,
            spin_request_count: Arc::new(AtomicU64::new(0)),
            batch_request_count: Arc::new(AtomicU64::new(0)),
            total_spins_run: Arc::new(AtomicU64::new(0)),
            inflight_permits: permits,
        }
    }

    /// Test-only constructor with tighter defaults so integration tests
    /// can exercise overrun branches without burning real CPU.
    #[doc(hidden)]
    pub fn for_test() -> Self {
        Self::new(ServerOptions {
            max_total_spins_per_request: 10_000,
            max_seeds_per_request: 4,
            max_batch_items: 4,
            max_body_bytes: 64 * 1024,
            max_concurrent_runs: 2,
        })
    }
}

// ─── Router builder — the only function the binary calls ────────────────────

/// Construct the Axum `Router` for the simulator daemon. The binary
/// then attaches it to a `tokio::TcpListener`. Kept in the library so
/// integration tests can drive it via `tower::ServiceExt::oneshot`
/// without going through a TCP socket.
pub fn router(opts: ServerOptions) -> Router {
    let body_limit = opts.max_body_bytes;
    let state = AppState::new(opts);
    Router::new()
        .route("/health", get(handler_health))
        // Test helper: returns `GameConfig::default()` as JSON so external
        // clients (LV3-2 JS contract suite, future Python notebooks) have
        // a guaranteed-valid payload they can POST straight back to /spin.
        // Cheap (~1 KiB body), no side effects. Excluded from `/health`
        // counters so liveness probes still reflect real simulator load.
        .route("/default-config", get(handler_default_config))
        .route("/spin", post(handler_spin))
        .route("/batch", post(handler_batch))
        .layer(DefaultBodyLimit::max(body_limit))
        .with_state(state)
}

// ─── Wire shapes ────────────────────────────────────────────────────────────

/// `GET /health` response — also includes counters so a health probe can
/// detect a stuck daemon (uptime advances but `total_spins_run` does not
/// after a known-good warm-up call).
#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    pub ok: bool,
    pub engine: &'static str,
    pub version: &'static str,
    pub uptime_secs: u64,
    pub started_at_epoch_secs: u64,
    pub spin_requests: u64,
    pub batch_requests: u64,
    pub total_spins_run: u64,
    pub max_concurrent_runs: usize,
}

/// `POST /spin` request body. Mirrors the field naming the LV3-1
/// `runOnce()` JS helper already emits — every field but `config` is
/// optional and the defaults match `slot_sim --quick` exactly.
#[derive(Debug, Clone, Deserialize)]
pub struct SpinRequest {
    pub config: GameConfig,
    /// Spins per seed. Defaults to 5_000_000.
    #[serde(default)]
    pub spins: Option<u64>,
    /// Number of seeds. Defaults to 10.
    #[serde(default)]
    pub seeds: Option<u32>,
    /// Base seed (kept for parity with CLI `--seed`). Defaults to 1.
    #[serde(default)]
    pub seed: Option<u64>,
    /// Sequential (single-threaded) mode — set to true for byte-identical
    /// TS comparison runs. Defaults to false.
    #[serde(default)]
    pub sequential: Option<bool>,
    /// PAR-6 (Boki 2026-06-26): total bet in millicredits per spin.
    /// Defaults to 1_000 (= 1.0 credit, matches `slot_sim --quick` CLI
    /// default). The factory PAR-5 convergence solver overrides this
    /// with `paylines × 1_000` (industry "bet per line × N lines"
    /// convention) so paytable pay multipliers — which scale against
    /// per-line bet — produce a measured RTP comparable to declared.
    /// Without the override, all 5 par sheets converged ~100-1000× too
    /// high because the engine treated pay × total_bet instead of
    /// pay × per_line_bet. Range: 1..1_000_000_000 (1 mc to 1M credit
    /// spin). Outside the range → 400 with code `bet_out_of_range`.
    #[serde(default)]
    pub total_bet_mc: Option<i64>,
}

/// `POST /spin` response. Includes:
///
///   - the three keys the JS `_findSummary` parser requires (rtp, hits,
///     spins) — values are also embedded in the canonical pipe-delimited
///     `summary` line so transitional clients can stay on the SUMMARY
///     parser without code change;
///   - `latency_ms` so the solver can budget remaining iterations;
///   - `request_id` is the daemon-monotonic counter at the time of
///     accept — useful for cross-correlating with `/health` counters.
#[derive(Debug, Clone, Serialize)]
pub struct SpinResponse {
    pub ok: bool,
    pub request_id: u64,
    pub rtp: f64,
    pub hits: u64,
    pub spins: u64,
    pub hit_rate: f64,
    pub latency_ms: u64,
    pub summary: String,
}

/// `POST /batch` request body. The `id` field on each item is opaque to
/// the server — it's echoed back on the corresponding result entry so
/// callers can fan out / merge by stable handle without relying on
/// array index ordering.
#[derive(Debug, Clone, Deserialize)]
pub struct BatchRequest {
    pub items: Vec<BatchItem>,
    /// When `true`, the first failing item short-circuits the batch and
    /// the response carries only the items processed so far. When
    /// `false` (default), every item is run independently.
    #[serde(default)]
    pub stop_on_error: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BatchItem {
    pub id: String,
    pub config: GameConfig,
    #[serde(default)]
    pub spins: Option<u64>,
    #[serde(default)]
    pub seeds: Option<u32>,
    #[serde(default)]
    pub seed: Option<u64>,
    #[serde(default)]
    pub sequential: Option<bool>,
    /// PAR-6: per-item total bet override (mirrors SpinRequest field).
    #[serde(default)]
    pub total_bet_mc: Option<i64>,
}

/// `POST /batch` response. `results.len()` may be less than
/// `request.items.len()` when `stop_on_error` is set and a failure
/// short-circuited the run.
#[derive(Debug, Clone, Serialize)]
pub struct BatchResponse {
    pub ok: bool,
    pub request_id: u64,
    pub item_count: usize,
    pub success_count: usize,
    pub failure_count: usize,
    pub total_latency_ms: u64,
    pub results: Vec<BatchResult>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchResult {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rtp: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hits: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spins: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hit_rate: Option<f64>,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Uniform error envelope. axum hands this back as JSON with the right
/// status code via the `IntoResponse` impl on `(StatusCode, Json<_>)`.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorBody {
    pub ok: bool,
    pub error: String,
    /// Stable machine-readable code so clients can match without parsing
    /// the human-friendly `error` string.
    pub code: &'static str,
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async fn handler_default_config() -> AxumJson<GameConfig> {
    AxumJson(GameConfig::default())
}

async fn handler_health(State(state): State<AppState>) -> AxumJson<HealthResponse> {
    AxumJson(HealthResponse {
        ok: true,
        engine: ENGINE_NAME,
        version: ENGINE_VERSION,
        uptime_secs: state.start_instant.elapsed().as_secs(),
        started_at_epoch_secs: state.start_epoch_secs,
        spin_requests: state.spin_request_count.load(Ordering::Relaxed),
        batch_requests: state.batch_request_count.load(Ordering::Relaxed),
        total_spins_run: state.total_spins_run.load(Ordering::Relaxed),
        max_concurrent_runs: state.opts.max_concurrent_runs,
    })
}

async fn handler_spin(
    State(state): State<AppState>,
    AxumJson(req): AxumJson<SpinRequest>,
) -> Response {
    let request_id = state.spin_request_count.fetch_add(1, Ordering::Relaxed) + 1;

    let spins = req.spins.unwrap_or(DEFAULT_SPINS_PER_SEED);
    let seeds = req.seeds.unwrap_or(DEFAULT_NUM_SEEDS);
    let base_seed = req.seed.unwrap_or(DEFAULT_BASE_SEED);
    let sequential = req.sequential.unwrap_or(false);

    if let Err(resp) = validate_run_size(&state.opts, spins, seeds) {
        return resp;
    }

    let total_bet_mc = match validate_total_bet(req.total_bet_mc) {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let permit = match state.inflight_permits.clone().acquire_owned().await {
        Ok(p) => p,
        Err(_) => return server_error("inflight semaphore closed", "permit_closed"),
    };

    let sim_config = SimConfig {
        spins_per_seed: spins,
        num_seeds: seeds,
        base_seed,
        total_bet_mc,
        verbose: false,
        sequential,
    };
    let config = req.config;
    let total_spins_run_counter = Arc::clone(&state.total_spins_run);

    // The MC kernel is CPU-bound and uses rayon internally — push it onto
    // the blocking pool so the tokio reactor stays responsive for other
    // concurrent requests.
    let t0 = Instant::now();
    let join_res = tokio::task::spawn_blocking(move || {
        let (_result, global_stats) = simulator::run_simulation_detailed(&config, &sim_config);
        run_metrics_from_stats(&global_stats, &sim_config)
    })
    .await;

    drop(permit); // release before returning so /health reflects current load

    let metrics = match join_res {
        Ok(m) => m,
        Err(e) => return server_error(format!("sim panic: {e}"), "sim_panic"),
    };

    total_spins_run_counter.fetch_add(metrics.total_spins, Ordering::Relaxed);

    let latency_ms = t0.elapsed().as_millis() as u64;
    let summary = format_summary_line(&metrics);

    AxumJson(SpinResponse {
        ok: true,
        request_id,
        rtp: metrics.rtp,
        hits: metrics.hits,
        spins: metrics.total_spins,
        hit_rate: metrics.hit_rate,
        latency_ms,
        summary,
    })
    .into_response()
}

async fn handler_batch(
    State(state): State<AppState>,
    AxumJson(req): AxumJson<BatchRequest>,
) -> Response {
    let request_id = state.batch_request_count.fetch_add(1, Ordering::Relaxed) + 1;

    if req.items.is_empty() {
        return bad_request("batch payload has no items", "empty_batch");
    }
    if req.items.len() > state.opts.max_batch_items {
        return bad_request(
            format!(
                "batch payload has {} items, cap is {}",
                req.items.len(),
                state.opts.max_batch_items
            ),
            "batch_too_large",
        );
    }
    // Pre-validate every item BEFORE running anything, so a payload that
    // is invalid in position 17 doesn't waste 16 successful sims first.
    for (i, item) in req.items.iter().enumerate() {
        let spins = item.spins.unwrap_or(DEFAULT_SPINS_PER_SEED);
        let seeds = item.seeds.unwrap_or(DEFAULT_NUM_SEEDS);
        if let Err(resp) = validate_run_size(&state.opts, spins, seeds) {
            // Re-wrap with item index so the caller knows which one failed.
            let body = ErrorBody {
                ok: false,
                error: format!("item[{i}] id={:?}: invalid run size", item.id),
                code: "item_invalid_size",
            };
            // We can't easily extract the original status from `resp`
            // without parsing it back, so emit a fresh 400 with index.
            drop(resp);
            return (StatusCode::BAD_REQUEST, AxumJson(body)).into_response();
        }
    }

    let batch_t0 = Instant::now();
    let mut results = Vec::with_capacity(req.items.len());
    let mut success_count: usize = 0;
    let mut failure_count: usize = 0;

    for item in req.items {
        let spins = item.spins.unwrap_or(DEFAULT_SPINS_PER_SEED);
        let seeds = item.seeds.unwrap_or(DEFAULT_NUM_SEEDS);
        let base_seed = item.seed.unwrap_or(DEFAULT_BASE_SEED);
        let sequential = item.sequential.unwrap_or(false);

        let permit = match state.inflight_permits.clone().acquire_owned().await {
            Ok(p) => p,
            Err(_) => {
                results.push(BatchResult {
                    id: item.id,
                    ok: false,
                    rtp: None,
                    hits: None,
                    spins: None,
                    hit_rate: None,
                    latency_ms: 0,
                    summary: None,
                    error: Some("inflight semaphore closed".into()),
                });
                failure_count += 1;
                if req.stop_on_error {
                    break;
                }
                continue;
            }
        };

        let item_total_bet = match validate_total_bet(item.total_bet_mc) {
            Ok(v) => v,
            Err(_) => {
                /* Per-item bet-out-of-range: surface as a per-item error
                 * rather than poisoning the whole batch. Pre-validation
                 * earlier in the handler already caught run-size faults
                 * for every item, so this branch only fires when a
                 * caller mixes legit + out-of-range bets in one batch. */
                results.push(BatchResult {
                    id: item.id.clone(),
                    ok: false,
                    rtp: None,
                    hits: None,
                    spins: None,
                    hit_rate: None,
                    latency_ms: 0,
                    summary: None,
                    error: Some(format!(
                        "total_bet_mc out of range (1..=1_000_000_000): {:?}",
                        item.total_bet_mc
                    )),
                });
                failure_count += 1;
                drop(permit);
                if req.stop_on_error {
                    break;
                }
                continue;
            }
        };
        let sim_config = SimConfig {
            spins_per_seed: spins,
            num_seeds: seeds,
            base_seed,
            total_bet_mc: item_total_bet,
            verbose: false,
            sequential,
        };
        let config = item.config;
        let item_t0 = Instant::now();

        let join_res = tokio::task::spawn_blocking(move || {
            let (_r, global_stats) = simulator::run_simulation_detailed(&config, &sim_config);
            run_metrics_from_stats(&global_stats, &sim_config)
        })
        .await;
        drop(permit);

        match join_res {
            Ok(m) => {
                state
                    .total_spins_run
                    .fetch_add(m.total_spins, Ordering::Relaxed);
                let summary = format_summary_line(&m);
                results.push(BatchResult {
                    id: item.id,
                    ok: true,
                    rtp: Some(m.rtp),
                    hits: Some(m.hits),
                    spins: Some(m.total_spins),
                    hit_rate: Some(m.hit_rate),
                    latency_ms: item_t0.elapsed().as_millis() as u64,
                    summary: Some(summary),
                    error: None,
                });
                success_count += 1;
            }
            Err(e) => {
                results.push(BatchResult {
                    id: item.id,
                    ok: false,
                    rtp: None,
                    hits: None,
                    spins: None,
                    hit_rate: None,
                    latency_ms: item_t0.elapsed().as_millis() as u64,
                    summary: None,
                    error: Some(format!("sim panic: {e}")),
                });
                failure_count += 1;
                if req.stop_on_error {
                    break;
                }
            }
        }
    }

    AxumJson(BatchResponse {
        ok: failure_count == 0,
        request_id,
        item_count: results.len(),
        success_count,
        failure_count,
        total_latency_ms: batch_t0.elapsed().as_millis() as u64,
        results,
    })
    .into_response()
}

// ─── Helpers ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
struct RunMetrics {
    rtp: f64,
    hits: u64,
    total_spins: u64,
    hit_rate: f64,
}

/// Collapse `AtomicStats` into the narrow shape every handler returns.
/// Kept private to this module so callers can't accidentally couple to
/// fields that may move around inside `AtomicStats`.
fn run_metrics_from_stats(stats: &AtomicStats, _sim: &SimConfig) -> RunMetrics {
    let hits = stats.winning_spins.load(Ordering::Relaxed);
    let total_spins = stats.total_spins.load(Ordering::Relaxed);
    RunMetrics {
        rtp: stats.rtp(),
        hits,
        total_spins,
        hit_rate: stats.hit_rate(),
    }
}

/// Canonical pipe-delimited SUMMARY line matching the contract the LV3-1
/// `_findSummary` parser expects. Embedded inside the JSON response so
/// transitional HTTP-mode callers can reuse the existing parser unchanged.
fn format_summary_line(m: &RunMetrics) -> String {
    format!(
        "SUMMARY|rtp={:.6}|hits={}|spins={}|hit_rate={:.6}",
        m.rtp, m.hits, m.total_spins, m.hit_rate
    )
}

/// Reject zero / cap-exceeding run shapes before touching the simulator.
fn validate_run_size(opts: &ServerOptions, spins: u64, seeds: u32) -> Result<(), Response> {
    if spins == 0 {
        return Err(bad_request("spins must be > 0", "spins_zero"));
    }
    if seeds == 0 {
        return Err(bad_request("seeds must be > 0", "seeds_zero"));
    }
    if seeds > opts.max_seeds_per_request {
        return Err(bad_request(
            format!("seeds={} exceeds cap {}", seeds, opts.max_seeds_per_request),
            "seeds_too_large",
        ));
    }
    // `seeds as u64 * spins` can overflow on adversarial input — use
    // checked math and refuse anything that would.
    let total = (seeds as u64).checked_mul(spins);
    match total {
        Some(t) if t > opts.max_total_spins_per_request => Err(bad_request(
            format!(
                "total spins {} exceeds cap {}",
                t, opts.max_total_spins_per_request
            ),
            "total_spins_too_large",
        )),
        None => Err(bad_request(
            "spins × seeds overflows u64",
            "total_spins_overflow",
        )),
        _ => Ok(()),
    }
}

/// PAR-6: normalize + validate the optional `total_bet_mc` override.
/// `None` → DEFAULT_TOTAL_BET_MC (preserves backwards-compat with
/// existing LV3-1 / LV3-2 callers that never sent the field).
/// Out of [1, 1_000_000_000] mc → 400 with code `bet_out_of_range`.
fn validate_total_bet(v: Option<i64>) -> Result<i64, Response> {
    match v {
        None => Ok(DEFAULT_TOTAL_BET_MC),
        Some(b) if b >= 1 && b <= 1_000_000_000 => Ok(b),
        Some(b) => Err(bad_request(
            format!("total_bet_mc out of range (1..=1_000_000_000): {}", b),
            "bet_out_of_range",
        )),
    }
}

fn bad_request(msg: impl Into<String>, code: &'static str) -> Response {
    let body = ErrorBody {
        ok: false,
        error: msg.into(),
        code,
    };
    (StatusCode::BAD_REQUEST, AxumJson(body)).into_response()
}

fn server_error(msg: impl Into<String>, code: &'static str) -> Response {
    let body = ErrorBody {
        ok: false,
        error: msg.into(),
        code,
    };
    (StatusCode::INTERNAL_SERVER_ERROR, AxumJson(body)).into_response()
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use serde_json::json;
    use tower::ServiceExt;

    fn minimal_config_json() -> serde_json::Value {
        // GameConfig::default() doesn't implement Serialize on its own
        // path, so build a small JSON literal that round-trips through
        // serde_json::from_value(...).
        let cfg = GameConfig::default();
        serde_json::to_value(&cfg).expect("GameConfig serializable")
    }

    async fn body_json(resp: Response) -> serde_json::Value {
        let body = resp.into_body();
        let bytes = to_bytes(body, 8 * 1024 * 1024).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn health_returns_ok_with_engine_metadata() {
        let app = router(ServerOptions::default());
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(resp).await;
        assert_eq!(v["ok"], true);
        assert_eq!(v["engine"], ENGINE_NAME);
        assert_eq!(v["version"], ENGINE_VERSION);
        assert_eq!(v["spin_requests"], 0);
        assert_eq!(v["batch_requests"], 0);
        assert!(v["max_concurrent_runs"].as_u64().unwrap() >= 1);
    }

    #[tokio::test]
    async fn spin_runs_minimal_sim_and_returns_summary() {
        // Tight caps so the test runs in well under a second.
        let opts = ServerOptions {
            max_total_spins_per_request: 50_000,
            max_seeds_per_request: 4,
            max_batch_items: 4,
            max_body_bytes: 1024 * 1024,
            max_concurrent_runs: 2,
        };
        let app = router(opts);
        let payload = json!({
            "config": minimal_config_json(),
            "spins": 200,
            "seeds": 2,
            "sequential": true,
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/spin")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(resp).await;
        assert_eq!(v["ok"], true);
        assert!(v["spins"].as_u64().unwrap() >= 200);
        assert!(v["rtp"].as_f64().unwrap() >= 0.0);
        let summary = v["summary"].as_str().unwrap();
        // SUMMARY-line contract verbatim — same parser LV3-1 already uses.
        assert!(summary.starts_with("SUMMARY|rtp="));
        assert!(summary.contains("|hits="));
        assert!(summary.contains("|spins="));
        assert!(summary.contains("|hit_rate="));
    }

    #[tokio::test]
    async fn spin_rejects_zero_spins() {
        let app = router(ServerOptions::default());
        let payload = json!({
            "config": minimal_config_json(),
            "spins": 0,
            "seeds": 1,
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/spin")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert_eq!(v["ok"], false);
        assert_eq!(v["code"], "spins_zero");
    }

    #[tokio::test]
    async fn spin_rejects_seed_cap_overrun() {
        let opts = ServerOptions {
            max_seeds_per_request: 2,
            ..ServerOptions::default()
        };
        let app = router(opts);
        let payload = json!({
            "config": minimal_config_json(),
            "spins": 100,
            "seeds": 999,
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/spin")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert_eq!(v["code"], "seeds_too_large");
    }

    #[tokio::test]
    async fn spin_rejects_total_spins_cap_overrun() {
        let opts = ServerOptions {
            max_total_spins_per_request: 1_000,
            max_seeds_per_request: 64,
            ..ServerOptions::default()
        };
        let app = router(opts);
        let payload = json!({
            "config": minimal_config_json(),
            "spins": 10_000,
            "seeds": 10,
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/spin")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert_eq!(v["code"], "total_spins_too_large");
    }

    #[tokio::test]
    async fn spin_rejects_u64_overflow_combo() {
        let opts = ServerOptions {
            max_total_spins_per_request: u64::MAX,
            max_seeds_per_request: u32::MAX,
            ..ServerOptions::default()
        };
        let app = router(opts);
        // (u32::MAX as u64) × u64::MAX trivially overflows.
        let payload = json!({
            "config": minimal_config_json(),
            "spins": u64::MAX,
            "seeds": u32::MAX,
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/spin")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert_eq!(v["code"], "total_spins_overflow");
    }

    #[tokio::test]
    async fn batch_runs_independent_items_and_preserves_id_order() {
        let opts = ServerOptions {
            max_total_spins_per_request: 10_000,
            max_seeds_per_request: 4,
            max_batch_items: 4,
            max_body_bytes: 1024 * 1024,
            max_concurrent_runs: 2,
        };
        let app = router(opts);
        let payload = json!({
            "items": [
                {"id": "alpha", "config": minimal_config_json(), "spins": 100, "seeds": 1, "sequential": true},
                {"id": "beta",  "config": minimal_config_json(), "spins": 100, "seeds": 1, "sequential": true},
                {"id": "gamma", "config": minimal_config_json(), "spins": 100, "seeds": 1, "sequential": true}
            ]
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/batch")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(resp).await;
        assert_eq!(v["ok"], true);
        assert_eq!(v["item_count"], 3);
        assert_eq!(v["success_count"], 3);
        assert_eq!(v["failure_count"], 0);
        let results = v["results"].as_array().unwrap();
        assert_eq!(results[0]["id"], "alpha");
        assert_eq!(results[1]["id"], "beta");
        assert_eq!(results[2]["id"], "gamma");
        for r in results {
            assert_eq!(r["ok"], true);
            assert!(r["summary"].as_str().unwrap().starts_with("SUMMARY|rtp="));
        }
    }

    #[tokio::test]
    async fn batch_rejects_empty_items() {
        let app = router(ServerOptions::default());
        let payload = json!({"items": []});
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/batch")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert_eq!(v["code"], "empty_batch");
    }

    #[tokio::test]
    async fn batch_rejects_oversized_item_count() {
        let opts = ServerOptions {
            max_batch_items: 2,
            ..ServerOptions::default()
        };
        let app = router(opts);
        let payload = json!({
            "items": [
                {"id": "a", "config": minimal_config_json()},
                {"id": "b", "config": minimal_config_json()},
                {"id": "c", "config": minimal_config_json()}
            ]
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/batch")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert_eq!(v["code"], "batch_too_large");
    }

    #[tokio::test]
    async fn batch_pre_validates_all_items_before_running() {
        let opts = ServerOptions {
            max_total_spins_per_request: 10_000,
            max_seeds_per_request: 4,
            max_batch_items: 4,
            ..ServerOptions::default()
        };
        let app = router(opts);
        // First item is fine; second item exceeds the seed cap. Server
        // must reject the whole batch with 400 + item index in error.
        let payload = json!({
            "items": [
                {"id": "good", "config": minimal_config_json(), "spins": 100, "seeds": 1},
                {"id": "bad",  "config": minimal_config_json(), "spins": 100, "seeds": 999}
            ]
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/batch")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert_eq!(v["code"], "item_invalid_size");
        assert!(v["error"].as_str().unwrap().contains("item[1]"));
    }

    #[tokio::test]
    async fn spin_accepts_total_bet_mc_override() {
        // PAR-6: factory passes paylines × 1_000 to scale paytable
        // pays correctly. A custom 20_000 mc (20-line × 1 credit per
        // line) override must not be rejected by validate_total_bet,
        // must not regress the SUMMARY shape, and must produce a
        // valid 2xx response.
        let opts = ServerOptions {
            max_total_spins_per_request: 50_000,
            max_seeds_per_request: 4,
            max_batch_items: 4,
            max_body_bytes: 1024 * 1024,
            max_concurrent_runs: 2,
        };
        let app = router(opts);
        let payload = json!({
            "config": minimal_config_json(),
            "spins": 200,
            "seeds": 1,
            "sequential": true,
            "total_bet_mc": 20_000,
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/spin")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(resp).await;
        assert_eq!(v["ok"], true);
        assert!(v["summary"].as_str().unwrap().starts_with("SUMMARY|rtp="));
    }

    #[tokio::test]
    async fn spin_rejects_total_bet_below_one() {
        let app = router(ServerOptions::default());
        let payload = json!({
            "config": minimal_config_json(),
            "spins": 100,
            "seeds": 1,
            "total_bet_mc": 0,
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/spin")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert_eq!(v["code"], "bet_out_of_range");
    }

    #[tokio::test]
    async fn spin_rejects_total_bet_above_cap() {
        let app = router(ServerOptions::default());
        let payload = json!({
            "config": minimal_config_json(),
            "spins": 100,
            "seeds": 1,
            "total_bet_mc": 1_000_000_001_i64,
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/spin")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let v = body_json(resp).await;
        assert_eq!(v["code"], "bet_out_of_range");
    }

    #[tokio::test]
    async fn batch_per_item_total_bet_override_applies() {
        let opts = ServerOptions {
            max_total_spins_per_request: 50_000,
            max_seeds_per_request: 4,
            max_batch_items: 4,
            max_body_bytes: 1024 * 1024,
            max_concurrent_runs: 2,
        };
        let app = router(opts);
        let cfg = minimal_config_json();
        let payload = json!({
            "items": [
                {"id": "a", "config": cfg, "spins": 100, "seeds": 1,
                 "sequential": true, "total_bet_mc": 10_000},
                {"id": "b", "config": cfg, "spins": 100, "seeds": 1,
                 "sequential": true, "total_bet_mc": 25_000}
            ]
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/batch")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(resp).await;
        assert_eq!(v["success_count"], 2);
        assert_eq!(v["failure_count"], 0);
    }

    #[tokio::test]
    async fn batch_mixed_bet_validity_isolates_failure() {
        let opts = ServerOptions {
            max_total_spins_per_request: 50_000,
            max_seeds_per_request: 4,
            max_batch_items: 4,
            max_body_bytes: 1024 * 1024,
            max_concurrent_runs: 2,
        };
        let app = router(opts);
        let cfg = minimal_config_json();
        // First item: legit. Second: bet out of range. Without
        // stop_on_error the legit one must still pass; the bad one
        // surfaces as a per-item error, not a whole-batch 400.
        let payload = json!({
            "items": [
                {"id": "a", "config": cfg, "spins": 100, "seeds": 1,
                 "sequential": true, "total_bet_mc": 5_000},
                {"id": "b", "config": cfg, "spins": 100, "seeds": 1,
                 "sequential": true, "total_bet_mc": 0}
            ]
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/batch")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let v = body_json(resp).await;
        assert_eq!(v["success_count"], 1);
        assert_eq!(v["failure_count"], 1);
        let bad = v["results"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == "b")
            .unwrap();
        assert_eq!(bad["ok"], false);
        assert!(bad["error"]
            .as_str()
            .unwrap()
            .contains("total_bet_mc out of range"));
    }

    #[test]
    fn validate_total_bet_normalizes_none_to_default() {
        let v = validate_total_bet(None).expect("None must be valid");
        assert_eq!(v, DEFAULT_TOTAL_BET_MC);
    }

    #[test]
    fn validate_total_bet_accepts_band() {
        for b in [1_i64, 1_000, 20_000, 1_000_000_000] {
            assert!(validate_total_bet(Some(b)).is_ok(), "rejected legit {b}");
        }
    }

    #[test]
    fn validate_total_bet_rejects_oob() {
        assert!(validate_total_bet(Some(0)).is_err());
        assert!(validate_total_bet(Some(-1)).is_err());
        assert!(validate_total_bet(Some(1_000_000_001)).is_err());
    }

    #[test]
    fn format_summary_line_matches_required_keys() {
        let m = RunMetrics {
            rtp: 0.9650,
            hits: 26_234,
            total_spins: 100_000,
            hit_rate: 0.26234,
        };
        let line = format_summary_line(&m);
        assert!(line.starts_with("SUMMARY|"));
        // Same three keys the LV3-1 _findSummary parser requires.
        for k in ["rtp=", "hits=", "spins=", "hit_rate="] {
            assert!(line.contains(k), "summary line missing {k}: {line}");
        }
    }

    #[test]
    fn for_test_state_has_tight_caps() {
        let s = AppState::for_test();
        assert!(s.opts.max_total_spins_per_request <= 10_000);
        assert!(s.opts.max_batch_items <= 4);
        assert!(s.opts.max_seeds_per_request <= 4);
    }
}
