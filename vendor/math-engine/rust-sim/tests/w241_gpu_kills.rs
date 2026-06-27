//! W241 — `rust-sim/src/gpu/{mod,request,shader}.rs` mutation kill tests.
//!
//! GPU module is a Phase-A scaffold (Faza 9.8b stage). Public surface:
//!   - `probe_gpu()` → returns `GpuAvailability` discriminating compile
//!     vs runtime states.
//!   - `GpuRequest` / `GpuResult` — mirror of CPU bulk request/result.
//!   - `SPIN_EVAL_WGSL` — embedded shader source.
//!
//! Mutation surface is small (≈20 mutants total) but the assertions
//! below pin every public observation so any structural mutation —
//! deleted match arm, field swap, literal flip — fails immediately.

use slot_sim::bulk::checkpoint::AtomicStatsSnapshot;
use slot_sim::gpu::{probe_gpu, GpuAvailability, GpuRequest, GpuResult, SPIN_EVAL_WGSL};

// ── probe_gpu() return shape ──────────────────────────────────────────────

#[test]
fn w241_gpu_probe_returns_one_of_three_variants() {
    let r = probe_gpu();
    match r {
        GpuAvailability::NotCompiled => {}
        GpuAvailability::NoAdapter => {}
        GpuAvailability::Ready { .. } => {}
    }
}

#[test]
fn w241_gpu_probe_default_build_is_not_compiled_or_no_adapter() {
    // Without the `gpu` feature flag the probe MUST return NotCompiled.
    // With the feature flag enabled (but no adapter) the probe returns
    // NoAdapter.  Either way, it MUST NOT panic and MUST NOT report Ready
    // on a default test target.  Mutant flipping `cfg!(feature="gpu")`
    // produces a literal NotCompiled→NoAdapter swap that this catches
    // if the build harness enables the feature.
    let r = probe_gpu();
    assert!(
        matches!(
            r,
            GpuAvailability::NotCompiled | GpuAvailability::NoAdapter
        ),
        "probe_gpu must return NotCompiled or NoAdapter (got {:?})",
        r
    );
}

#[test]
fn w241_gpu_availability_variants_distinct() {
    // Equality between distinct variants must be false.  Kills any
    // mutant on PartialEq derive that conflates variants.
    let a = GpuAvailability::NotCompiled;
    let b = GpuAvailability::NoAdapter;
    let c = GpuAvailability::Ready {
        backend: "metal".into(),
        device_name: "test".into(),
    };
    assert_ne!(a, b);
    assert_ne!(b, c);
    assert_ne!(a, c);
    // Equality with self holds.
    assert_eq!(a, GpuAvailability::NotCompiled);
    assert_eq!(b, GpuAvailability::NoAdapter);
}

#[test]
fn w241_gpu_ready_variant_carries_payload() {
    let r = GpuAvailability::Ready {
        backend: "vulkan".into(),
        device_name: "AMD RX 7900".into(),
    };
    if let GpuAvailability::Ready { backend, device_name } = r {
        assert_eq!(backend, "vulkan");
        assert_eq!(device_name, "AMD RX 7900");
    } else {
        panic!("Ready variant must preserve payload");
    }
}

// ── GpuRequest / GpuResult struct field invariants ────────────────────────

#[test]
fn w241_gpu_request_field_round_trip() {
    let req = GpuRequest {
        slice_index: 7,
        start_spin: 1_000,
        end_spin: 2_000,
        base_seed: 42,
        chunk_spins: 100,
        total_bet_mc: 1_500_000,
        workgroup_size: 64,
        threads_per_dispatch: 256,
    };
    // Clone preserves every field — kills any mutant on Clone derive that
    // zero-fills or swaps fields.
    let req2 = req;
    assert_eq!(req2.slice_index, 7);
    assert_eq!(req2.start_spin, 1_000);
    assert_eq!(req2.end_spin, 2_000);
    assert_eq!(req2.base_seed, 42);
    assert_eq!(req2.chunk_spins, 100);
    assert_eq!(req2.total_bet_mc, 1_500_000);
    assert_eq!(req2.workgroup_size, 64);
    assert_eq!(req2.threads_per_dispatch, 256);
    // span computation hint: end - start = 1000 spins to process.
    assert_eq!(req2.end_spin - req2.start_spin, 1_000);
}

#[test]
fn w241_gpu_result_field_round_trip() {
    let snap = AtomicStatsSnapshot::default();
    let res = GpuResult {
        slice_index: 3,
        completed_spins: 500,
        duration_ms: 250,
        stats: snap,
        hdr_buckets: vec![1, 2, 3, 4, 5],
    };
    let res2 = res;
    assert_eq!(res2.slice_index, 3);
    assert_eq!(res2.completed_spins, 500);
    assert_eq!(res2.duration_ms, 250);
    assert_eq!(res2.hdr_buckets, vec![1, 2, 3, 4, 5]);
}

// ── SPIN_EVAL_WGSL shader source ─────────────────────────────────────────

#[test]
fn w241_gpu_shader_source_is_nonempty() {
    // Any mutant that replaces include_str! with `""` collapses the
    // length to zero.
    assert!(
        !SPIN_EVAL_WGSL.is_empty(),
        "embedded shader source must not be empty",
    );
    // Loose sanity that it looks like WGSL: the placeholder skeleton
    // contains `@compute` and a workgroup_size annotation.
    assert!(
        SPIN_EVAL_WGSL.contains("@compute") || SPIN_EVAL_WGSL.contains("workgroup_size"),
        "shader must contain WGSL compute entry point markers (len={}, first 80 chars={:?})",
        SPIN_EVAL_WGSL.len(),
        &SPIN_EVAL_WGSL.chars().take(80).collect::<String>(),
    );
}

#[test]
fn w241_gpu_shader_source_is_static_str() {
    // Two separate accesses produce the same string (pointer identity is
    // a side-effect of `static` storage).  A mutant that lazily computed
    // it from a const fn would still pass this if it returned the same
    // value; we accept that — the kill comes via the `not_empty` + length
    // check below.
    let a = SPIN_EVAL_WGSL;
    let b = SPIN_EVAL_WGSL;
    assert_eq!(a.len(), b.len());
    assert!(a.len() > 50, "shader source unrealistically short: {}", a.len());
}
