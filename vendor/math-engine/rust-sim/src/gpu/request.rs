//! GPU dispatch request / result shape — mirror of the CPU
//! `BulkConfig` chunk so the dispatcher can swap backends.

use crate::bulk::checkpoint::AtomicStatsSnapshot;

#[derive(Debug, Clone)]
pub struct GpuRequest {
    pub slice_index: u64,
    pub start_spin: u64,
    pub end_spin: u64,
    pub base_seed: u64,
    pub chunk_spins: u64,
    pub total_bet_mc: i64,
    /// GPU workgroup size — multiple of 32 for warp efficiency.
    pub workgroup_size: u32,
    /// Threads per dispatch. 1 spin per thread is the simplest mapping.
    pub threads_per_dispatch: u32,
}

#[derive(Debug, Clone)]
pub struct GpuResult {
    pub slice_index: u64,
    pub completed_spins: u64,
    pub duration_ms: u64,
    pub stats: AtomicStatsSnapshot,
    pub hdr_buckets: Vec<u64>,
}
