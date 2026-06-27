//! Faza 9.8b — Integration tests: SIMD f32x8, WGSL Phase-B, TCP transport.
//!
//! SIMD-01..10 : simd_accumulate_wins / simd_payline_hits correctness
//! GPU-11..15  : SPIN_EVAL_WGSL shader source checks + probe_gpu smoke
//! TCP-16..18  : TcpTransport connect, round-trip, FIFO ordering

use slot_sim::{
    gpu::{probe_gpu, SPIN_EVAL_WGSL},
    speed::{
        scalar_accumulate_wins, simd_accumulate_wins, simd_payline_hits,
        PackedGrid,
    },
};

use slot_sim::cluster::{
    protocol::ClusterEnvelope,
    transport::{ClusterTransport, TcpTransport},
};

use std::net::TcpListener;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Standard 5-payline set (rows: middle, top, bottom, V, inv-V).
fn five_paylines() -> Vec<[u8; 5]> {
    vec![
        [1, 1, 1, 1, 1],
        [0, 0, 0, 0, 0],
        [2, 2, 2, 2, 2],
        [0, 1, 2, 1, 0],
        [2, 1, 0, 1, 2],
    ]
}

/// Fill every cell of a 5×3 PackedGrid with `sym`.
fn fill_grid(sym: u8) -> PackedGrid {
    let mut g = PackedGrid::default();
    for r in 0..5 {
        for row in 0..3 {
            g.set(r, row, 3, sym);
        }
    }
    g
}

// ─── SIMD-01: simd_accumulate_wins agrees with scalar (tolerance 1e-4) ────────

#[test]
fn simd_01_accumulate_agrees_with_scalar() {
    let wins: Vec<f32> = (0..100).map(|i| i as f32 * 0.5).collect();
    let simd_total = simd_accumulate_wins(&wins);
    let scalar_total = scalar_accumulate_wins(&wins);
    assert!(
        (simd_total - scalar_total).abs() < 1e-4,
        "SIMD={simd_total} scalar={scalar_total}"
    );
}

// ─── SIMD-02: empty slice → 0 ─────────────────────────────────────────────────

#[test]
fn simd_02_empty_slice_returns_zero() {
    assert_eq!(simd_accumulate_wins(&[]), 0.0);
    assert_eq!(scalar_accumulate_wins(&[]), 0.0);
}

// ─── SIMD-03: exactly 8 elements ─────────────────────────────────────────────

#[test]
fn simd_03_exactly_8_elements() {
    let wins = [1.0f32, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
    let s = simd_accumulate_wins(&wins);
    let r = scalar_accumulate_wins(&wins);
    assert!((s - r).abs() < 1e-4, "simd={s} scalar={r}");
}

// ─── SIMD-04: 13 elements (tail path) ────────────────────────────────────────

#[test]
fn simd_04_thirteen_elements_tail() {
    let wins: Vec<f32> = (1..=13).map(|i| i as f32).collect();
    let s = simd_accumulate_wins(&wins);
    let r = scalar_accumulate_wins(&wins);
    assert!((s - r).abs() < 1e-4, "simd={s} scalar={r}");
}

// ─── SIMD-05: exact sum [1..8] = 36 ──────────────────────────────────────────

#[test]
fn simd_05_exact_sum_1_to_8_is_36() {
    let wins = [1.0f32, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
    let total = simd_accumulate_wins(&wins);
    assert!((total - 36.0).abs() < 1e-4, "expected 36.0 got {total}");
}

// ─── SIMD-06: payline hits = 0 when no 3-match ───────────────────────────────

#[test]
fn simd_06_no_hit_when_no_three_match() {
    // Build a grid where col0=sym1, col1=sym2, col2=sym3, col3=sym1, col4=sym2
    // No consecutive 3-run for any symbol
    let mut g = PackedGrid::default();
    let syms = [1u8, 2, 3, 1, 2];
    for r in 0..5 {
        for row in 0..3 {
            g.set(r, row, 3, syms[r]);
        }
    }
    let pls = five_paylines();
    let hits = simd_payline_hits(g, &pls, 5, 3, 0);
    assert_eq!(hits, 0, "expected no hits, got {hits:#06b}");
}

// ─── SIMD-07: detects hit on middle payline ───────────────────────────────────

#[test]
fn simd_07_detects_hit_on_middle_payline() {
    // All reels show sym=2 → 5-reel run → bit 0,1,2 set for lines 0,1,2
    let g = fill_grid(2);
    let pls = five_paylines();
    let hits = simd_payline_hits(g, &pls, 5, 3, 0);
    // All 5 paylines hit (same sym in every cell)
    assert!(hits != 0, "expected at least one payline hit");
    // Specifically bit 0 (middle line) must be set
    assert!(hits & 1 != 0, "middle payline must hit");
}

// ─── SIMD-08: wild substitution works ────────────────────────────────────────

#[test]
fn simd_08_wild_substitution() {
    // Reel 0 = wild(0), reels 1-4 = sym=3  → effective sym=3, run=5 → hit
    let mut g = PackedGrid::default();
    for row in 0..3 {
        g.set(0, row, 3, 0); // wild
    }
    for r in 1..5 {
        for row in 0..3 {
            g.set(r, row, 3, 3);
        }
    }
    let pls = five_paylines();
    let hits = simd_payline_hits(g, &pls, 5, 3, 0);
    assert!(hits & 1 != 0, "middle line should hit via wild substitution");
}

// ─── SIMD-09: all-wild grid → no hit (no effective symbol) ───────────────────

#[test]
fn simd_09_all_wild_grid_no_hit() {
    let g = fill_grid(0); // 0 = wild
    let pls = five_paylines();
    let hits = simd_payline_hits(g, &pls, 5, 3, 0);
    assert_eq!(hits, 0, "all-wild grid should produce no payline hit");
}

// ─── SIMD-10: 1M wins of 1.0 ≈ 1_000_000 ────────────────────────────────────

#[test]
fn simd_10_one_million_wins() {
    let wins = vec![1.0f32; 1_000_000];
    let total = simd_accumulate_wins(&wins);
    assert!(
        (total - 1_000_000.0).abs() < 1.0,
        "expected ~1_000_000 got {total}"
    );
}

// ─── GPU-11: SPIN_EVAL_WGSL is non-empty ─────────────────────────────────────

#[test]
fn gpu_11_wgsl_non_empty() {
    assert!(!SPIN_EVAL_WGSL.is_empty(), "shader source should not be empty");
}

// ─── GPU-12: SPIN_EVAL_WGSL contains '@compute' ──────────────────────────────

#[test]
fn gpu_12_wgsl_contains_compute_attribute() {
    assert!(
        SPIN_EVAL_WGSL.contains("@compute"),
        "shader must declare a @compute entry point"
    );
}

// ─── GPU-13: SPIN_EVAL_WGSL contains 'philox' ────────────────────────────────

#[test]
fn gpu_13_wgsl_contains_philox() {
    assert!(
        SPIN_EVAL_WGSL.to_lowercase().contains("philox"),
        "shader must contain Philox RNG"
    );
}

// ─── GPU-14: SPIN_EVAL_WGSL contains 'wins[gid]' ─────────────────────────────

#[test]
fn gpu_14_wgsl_writes_wins_gid() {
    assert!(
        SPIN_EVAL_WGSL.contains("wins[g]"),
        "shader must write wins[g] (wins[gid])"
    );
}

// ─── GPU-15: SPIN_EVAL_WGSL does NOT contain the Phase-A TODO marker ─────────

#[test]
fn gpu_15_no_phase_a_todo_marker() {
    assert!(
        !SPIN_EVAL_WGSL.contains("TODO(faza-9.8b)"),
        "Phase-A placeholder TODO must be removed in Phase-B shader"
    );
}

// ─── GPU-16 (probe): probe_gpu doesn't panic ─────────────────────────────────

#[test]
fn gpu_16_probe_does_not_panic() {
    let _ = probe_gpu();
}

// ─── TCP-16: connect to closed port → Err (not panic) ────────────────────────

#[test]
fn tcp_16_connect_closed_port_returns_err() {
    // Port 1 is almost certainly not open and requires elevated privileges
    let result = TcpTransport::connect("127.0.0.1:1");
    assert!(result.is_err(), "expected Err connecting to closed port");
}

// ─── TCP-17: server-client round-trip ────────────────────────────────────────

#[test]
fn tcp_17_server_client_round_trip() {
    // Bind to OS-assigned port
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind listener");
    let addr = listener.local_addr().expect("local_addr").to_string();

    let server_handle = std::thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept");
        let server = TcpTransport::from_stream(stream);
        // Echo back what we receive
        let env = server.recv().expect("server recv").expect("expected Some");
        server.send(&env).expect("server send");
    });

    let client = TcpTransport::connect(&addr).expect("client connect");
    let abort = ClusterEnvelope::Abort {
        reason: "round-trip-test".into(),
    };
    client.send(&abort).expect("client send");
    let received = client.recv().expect("client recv").expect("expected Some");
    assert_eq!(received, abort);

    server_handle.join().expect("server thread panicked");
}

// ─── TCP-18: FIFO — send 3, recv 3 in order ──────────────────────────────────

#[test]
fn tcp_18_fifo_order_preserved() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind listener");
    let addr = listener.local_addr().expect("local_addr").to_string();

    let server_handle = std::thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept");
        let server = TcpTransport::from_stream(stream);
        // Send 3 messages
        for i in 0u32..3 {
            server
                .send(&ClusterEnvelope::Abort {
                    reason: format!("msg-{i}"),
                })
                .expect("server send");
        }
    });

    let client = TcpTransport::connect(&addr).expect("client connect");

    server_handle.join().expect("server thread panicked");

    for i in 0u32..3 {
        match client.recv().expect("recv ok").expect("expected Some") {
            ClusterEnvelope::Abort { reason } => {
                assert_eq!(reason, format!("msg-{i}"), "FIFO order mismatch at {i}");
            }
            other => panic!("unexpected envelope: {other:?}"),
        }
    }
}
