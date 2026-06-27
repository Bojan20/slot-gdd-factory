//! WGSL compute shader source for the spin evaluator.
//!
//! Embedded as a `&str` so the runtime can pass it directly to
//! `wgpu::Device::create_shader_module` once the Faza 9.8b integration
//! lands. Kept here, not as a separate `.wgsl` file, so the source is
//! part of the binary and there's no runtime file-loading question.
//!
//! Shader contract:
//!
//!   - Thread layout: 1 thread = 1 spin. Workgroup size 64 (8×8) is the
//!     baseline; the runner can override via specialization constant.
//!   - Per-thread RNG: Philox4x32 keyed by (base_seed, slice_index,
//!     global_thread_id). Counter-based ⇒ no synchronization needed.
//!   - Output: each thread writes one win value (f32, bet multiples)
//!     into a storage buffer. The runner reduces them on the CPU side
//!     into an `AtomicStatsSnapshot` to avoid GPU atomic-add overhead.
//!   - Paytable + reel weights: uploaded once per dispatch in a
//!     read-only uniform buffer.
//!
//! The shader below is the Phase-A skeleton: it computes a placeholder
//! deterministic value per spin so the wgpu pipeline can be wired and
//! validated end-to-end before the full evaluator port lands. The
//! `// TODO(faza-9.8b)` markers are where the evaluator math lands.

pub const SPIN_EVAL_WGSL: &str = include_str!("spin_eval.wgsl");
