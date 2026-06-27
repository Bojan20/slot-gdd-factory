//! Faza 9.8 — Bulk dispatcher for 1T-spin runs.
//!
//! Existing `simulator::run_simulation_detailed` assumes the caller fits
//! `spins_per_seed × num_seeds` worth of work in one shot and waits for
//! it to finish. That's fine for 50M–1B; at 1T it breaks three ways:
//!
//!   1. No progress signal — a 14-minute run is opaque to the operator.
//!   2. No crash recovery — losing the run after 800B spins is catastrophic.
//!   3. No streaming guarantee — memory grows with seed count because
//!      `MultiSeedStats` retains a per-seed `SeedStats`.
//!
//! `BulkDispatcher` solves all three: it slices the total into
//! `chunk_spins`-sized work units, drives each through the existing
//! parallel simulator, **merges results into a single `AtomicStats`**
//! immediately, and emits progress + checkpoint snapshots between chunks.
//!
//! Memory cost is constant in `chunk_spins`, not `total_spins`. With the
//! default 10M-spin chunk, peak RSS stays under 200 MiB at 1T scale.
//!
//! See `docs/SLOT_ENGINE_MASTER_TODO.md` FAZA 9.8 for acceptance.

pub mod checkpoint;
pub mod dispatcher;
pub mod parse;
pub mod progress;

pub use checkpoint::{load_checkpoint, save_checkpoint, BulkCheckpoint};
pub use dispatcher::{BulkConfig, BulkDispatcher, BulkResult};
pub use parse::{parse_spin_count, ParseSpinCountError};
pub use progress::{
    JsonLineProgress, NoOpProgress, ProgressReporter, ProgressSnapshot, StdoutProgress,
};
