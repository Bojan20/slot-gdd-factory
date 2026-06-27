//! Faza 9.9 acceptance — portable NUMA topology + mmap reel strips.
//!
//! 20 tests covering:
//!   - NumaTopology::detect()
//!   - NumaTopology::simulated()
//!   - assign_worker round-robin
//!   - partition_work correctness
//!   - MmapReelStrips heap and mmap paths
//!   - edge cases

use slot_sim::numa::{mmap_strips::MmapReelStrips, NumaTopology};

// ─── Helper ───────────────────────────────────────────────────────────────────

fn sample() -> Vec<Vec<u32>> {
    vec![
        vec![1, 2, 3, 4, 5],
        vec![10, 20, 30],
        vec![7, 8, 9, 11, 13, 17],
    ]
}

// ─── NumaTopology::detect() ───────────────────────────────────────────────────

/// T01 — detect() always returns >= 1 node.
#[test]
fn t01_detect_at_least_one_node() {
    let topo = NumaTopology::detect();
    assert!(topo.node_count() >= 1, "expected >= 1 node, got {}", topo.node_count());
}

/// T02 — detect() nodes have sequential ids starting at 0.
#[test]
fn t02_detect_node_ids_sequential() {
    let topo = NumaTopology::detect();
    for (i, node) in topo.nodes().iter().enumerate() {
        assert_eq!(node.id, i, "node id mismatch at index {i}");
    }
}

// ─── NumaTopology::simulated() ────────────────────────────────────────────────

/// T03 — simulated(4, 8) → node_count == 4.
#[test]
fn t03_simulated_node_count() {
    let topo = NumaTopology::simulated(4, 8);
    assert_eq!(topo.node_count(), 4);
}

/// T04 — simulated(4, 8) → each node has worker_count == 8.
#[test]
fn t04_simulated_worker_count() {
    let topo = NumaTopology::simulated(4, 8);
    for node in topo.nodes() {
        assert_eq!(node.worker_count, 8);
    }
}

/// T05 — simulated(1, 16) → single node.
#[test]
fn t05_simulated_single_node() {
    let topo = NumaTopology::simulated(1, 16);
    assert_eq!(topo.node_count(), 1);
    assert_eq!(topo.nodes()[0].id, 0);
    assert_eq!(topo.nodes()[0].worker_count, 16);
}

/// T06 — simulated node ids are 0-based sequential.
#[test]
fn t06_simulated_node_ids() {
    let topo = NumaTopology::simulated(6, 4);
    for (i, node) in topo.nodes().iter().enumerate() {
        assert_eq!(node.id, i);
    }
}

// ─── assign_worker ────────────────────────────────────────────────────────────

/// T07 — worker 0 → node 0, worker 1 → node 1, worker 2 → node 2.
#[test]
fn t07_assign_worker_basic() {
    let topo = NumaTopology::simulated(3, 1);
    assert_eq!(topo.assign_worker(0).id, 0);
    assert_eq!(topo.assign_worker(1).id, 1);
    assert_eq!(topo.assign_worker(2).id, 2);
}

/// T08 — workers wrap around after node_count.
#[test]
fn t08_assign_worker_wraps() {
    let topo = NumaTopology::simulated(3, 1);
    assert_eq!(topo.assign_worker(3).id, 0);
    assert_eq!(topo.assign_worker(4).id, 1);
    assert_eq!(topo.assign_worker(5).id, 2);
    assert_eq!(topo.assign_worker(6).id, 0);
}

/// T09 — single node: any worker_id → node 0.
#[test]
fn t09_assign_worker_single_node() {
    let topo = NumaTopology::simulated(1, 4);
    for w in 0..20 {
        assert_eq!(topo.assign_worker(w).id, 0, "worker {w} should map to node 0");
    }
}

/// T10 — returned NumaNode has correct worker_count.
#[test]
fn t10_assign_worker_node_fields() {
    let topo = NumaTopology::simulated(2, 5);
    let node = topo.assign_worker(1);
    assert_eq!(node.id, 1);
    assert_eq!(node.worker_count, 5);
}

// ─── partition_work ───────────────────────────────────────────────────────────

/// T11 — partition_work(1000) over 4 nodes → 4 chunks.
#[test]
fn t11_partition_work_chunk_count() {
    let topo = NumaTopology::simulated(4, 2);
    let chunks = topo.partition_work(1000);
    assert_eq!(chunks.len(), 4);
}

/// T12 — chunk spin ranges don't overlap (end of chunk N == start of chunk N+1).
#[test]
fn t12_partition_work_no_overlap() {
    let topo = NumaTopology::simulated(4, 2);
    let chunks = topo.partition_work(1000);
    for w in chunks.windows(2) {
        assert_eq!(w[0].spin_end, w[1].spin_start, "gap/overlap between chunks");
    }
}

/// T13 — total spins from all chunks sums to original total.
#[test]
fn t13_partition_work_sum() {
    let topo = NumaTopology::simulated(4, 2);
    let chunks = topo.partition_work(1000);
    let total: u64 = chunks.iter().map(|c| c.spin_end - c.spin_start).sum();
    assert_eq!(total, 1000);
}

/// T14 — first chunk starts at 0.
#[test]
fn t14_partition_work_starts_at_zero() {
    let topo = NumaTopology::simulated(4, 2);
    let chunks = topo.partition_work(1000);
    assert_eq!(chunks[0].spin_start, 0);
}

/// T15 — last chunk ends at total_spins.
#[test]
fn t15_partition_work_ends_at_total() {
    let topo = NumaTopology::simulated(4, 2);
    let chunks = topo.partition_work(1001);
    assert_eq!(chunks.last().unwrap().spin_end, 1001);
}

/// T16 — 0 total_spins → all chunks are empty (start == end == 0).
#[test]
fn t16_partition_work_zero_spins() {
    let topo = NumaTopology::simulated(4, 2);
    let chunks = topo.partition_work(0);
    assert_eq!(chunks.len(), 4);
    for c in &chunks {
        assert_eq!(c.spin_start, c.spin_end, "chunk should be empty");
    }
}

/// T17 — chunk node_ids match node order.
#[test]
fn t17_partition_work_node_ids() {
    let topo = NumaTopology::simulated(3, 1);
    let chunks = topo.partition_work(300);
    assert_eq!(chunks[0].node_id, 0);
    assert_eq!(chunks[1].node_id, 1);
    assert_eq!(chunks[2].node_id, 2);
}

// ─── MmapReelStrips ───────────────────────────────────────────────────────────

/// T18 — from_strips round-trips all data correctly.
#[test]
fn t18_from_strips_round_trip() {
    let orig = sample();
    let s = MmapReelStrips::from_strips(&orig);
    assert_eq!(s.reel_count(), 3);
    assert_eq!(s.get_strip(0), &[1u32, 2, 3, 4, 5]);
    assert_eq!(s.get_strip(1), &[10u32, 20, 30]);
    assert_eq!(s.get_strip(2), &[7u32, 8, 9, 11, 13, 17]);
}

/// T19 — from_mmap round-trips all data correctly.
#[test]
fn t19_from_mmap_round_trip() {
    let orig = sample();
    let s = MmapReelStrips::from_mmap(&orig).expect("mmap failed");
    assert_eq!(s.reel_count(), 3);
    assert_eq!(s.get_strip(0), &[1u32, 2, 3, 4, 5]);
    assert_eq!(s.get_strip(1), &[10u32, 20, 30]);
    assert_eq!(s.get_strip(2), &[7u32, 8, 9, 11, 13, 17]);
}

/// T20 — get_strip with out-of-bounds index returns empty slice (no panic).
#[test]
fn t20_get_strip_oob_returns_empty() {
    let orig = sample();
    let s = MmapReelStrips::from_strips(&orig);
    let empty: &[u32] = &[];
    assert_eq!(s.get_strip(3), empty, "index 3 is OOB, expected empty slice");
    assert_eq!(s.get_strip(999), empty, "index 999 is OOB, expected empty slice");
}
