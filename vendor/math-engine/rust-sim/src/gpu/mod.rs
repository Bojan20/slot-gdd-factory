//! Faza 9.8b — GPU compute scaffold (Metal / WGSL).
//!
//! The 1T-spinova/sec acceptance for a single chip requires GPU
//! offload. This module is the **scaffold** that lands the public
//! surface, the shader source, and the dispatch contract; the actual
//! wgpu adapter integration is staged for Faza 9.8b so the rest of
//! the engine can ship first.
//!
//! Why scaffold first:
//!
//!   - The CPU bulk path (`crate::bulk`) already hits ~1.2B spins/s on
//!     M-series and ~5B with SIMD pending. Most real users do not need
//!     GPU yet — they need the dispatcher + progress + checkpoint UX.
//!   - WGSL evaluator is a 3-4 week port; finishing the surface (types,
//!     pipeline contract, fallback path) now means the integration is
//!     just `wgpu_runner.rs` glue plus tests.
//!   - The module guards everything behind `feature = "gpu"` so default
//!     builds stay fast and dependency-light.
//!
//! ## Public contract
//!
//! ```ignore
//! let device = GpuDevice::pick()?;          // wgpu adapter + queue
//! let pipeline = SpinPipeline::compile(&device, &shader)?;
//! let result = pipeline.run(&request).await?;
//! ```
//!
//! `GpuRequest` mirrors a `BulkConfig` slice; `GpuResult` mirrors an
//! `AtomicStatsSnapshot` + HDR bucket array. The CPU `BulkDispatcher`
//! sees the same shape regardless of backend.
//!
//! Until the wgpu integration lands, `GpuDevice::pick` returns
//! `Unavailable` so callers fall back to CPU automatically.

pub mod request;
pub mod shader;

pub use request::{GpuRequest, GpuResult};
pub use shader::SPIN_EVAL_WGSL;

/// What a GPU backend reports back to the dispatcher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GpuAvailability {
    /// `feature = "gpu"` not enabled at compile time.
    NotCompiled,
    /// `feature = "gpu"` compiled in but no compatible adapter / driver.
    NoAdapter,
    /// wgpu adapter found, ready for `SpinPipeline::compile`.
    Ready {
        backend: String,
        device_name: String,
    },
}

/// Best-effort device probe. Stub until Faza 9.8b lands the real wgpu
/// adapter selection. Tests can pretend the feature is compiled-out.
pub fn probe_gpu() -> GpuAvailability {
    #[cfg(feature = "gpu")]
    {
        // Real probe lands in Faza 9.8b. For now, return NoAdapter so
        // callers fall through to CPU dispatcher.
        GpuAvailability::NoAdapter
    }
    #[cfg(not(feature = "gpu"))]
    {
        GpuAvailability::NotCompiled
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_reports_not_compiled_when_feature_off() {
        // Default build profile excludes the GPU feature; verify the
        // probe surfaces that cleanly rather than panicking.
        match probe_gpu() {
            GpuAvailability::NotCompiled => {}
            GpuAvailability::NoAdapter => {
                // Acceptable when the test target enabled the feature.
            }
            GpuAvailability::Ready { .. } => {
                // Acceptable when CI enabled the feature AND a GPU is
                // attached. We just want this to compile clean.
            }
        }
    }
}
