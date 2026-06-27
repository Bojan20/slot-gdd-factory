//! FAZA 9.9 — Portable NUMA abstraction.
//!
//! Provides worker-to-node affinity assignment and work partitioning across
//! NUMA nodes. On Linux, node count is probed via `/sys/devices/system/node/`.
//! On all other platforms (macOS, Windows) a single-node topology is returned.
//!
//! A `simulated` constructor allows testing multi-node behaviour on any
//! platform by constructing an arbitrary topology in memory.

pub mod mmap_strips;

// ─── Core types ──────────────────────────────────────────────────────────────

/// A single NUMA node with an associated worker count.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumaNode {
    /// Zero-based NUMA node identifier.
    pub id: usize,
    /// Number of worker threads assigned to this node.
    pub worker_count: usize,
}

/// A topology descriptor containing one or more [`NumaNode`]s.
#[derive(Debug, Clone)]
pub struct NumaTopology {
    nodes: Vec<NumaNode>,
}

/// A unit of work assigned to a specific NUMA node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkChunk {
    /// The NUMA node this chunk is affine to.
    pub node_id: usize,
    /// Inclusive start spin index.
    pub spin_start: u64,
    /// Exclusive end spin index.
    pub spin_end: u64,
}

// ─── NumaTopology impl ───────────────────────────────────────────────────────

impl NumaTopology {
    // ── Constructors ─────────────────────────────────────────────────────

    /// Detect the real NUMA topology of the current machine.
    ///
    /// - **Linux**: counts `node<N>` directories under
    ///   `/sys/devices/system/node/`.  Worker count per node defaults to 1.
    /// - **All other platforms**: returns a single-node topology.
    pub fn detect() -> Self {
        #[cfg(target_os = "linux")]
        {
            if let Some(topo) = Self::detect_linux() {
                return topo;
            }
        }
        // macOS, Windows, or sysfs unavailable → single node
        Self {
            nodes: vec![NumaNode { id: 0, worker_count: 1 }],
        }
    }

    /// Probe Linux sysfs for NUMA nodes.  Returns `None` when sysfs is
    /// absent or yields no node directories (e.g. inside a container).
    #[cfg(target_os = "linux")]
    fn detect_linux() -> Option<Self> {
        use std::fs;
        let entries = fs::read_dir("/sys/devices/system/node/").ok()?;
        let mut node_ids: Vec<usize> = entries
            .flatten()
            .filter_map(|e| {
                let name = e.file_name();
                let s = name.to_string_lossy();
                if s.starts_with("node") {
                    s[4..].parse::<usize>().ok()
                } else {
                    None
                }
            })
            .collect();
        if node_ids.is_empty() {
            return None;
        }
        node_ids.sort_unstable();
        let nodes = node_ids
            .into_iter()
            .map(|id| NumaNode { id, worker_count: 1 })
            .collect();
        Some(Self { nodes })
    }

    /// Build a synthetic topology useful for tests.
    ///
    /// # Panics
    ///
    /// Panics if `nodes == 0`.
    pub fn simulated(nodes: usize, workers_per_node: usize) -> Self {
        assert!(nodes > 0, "must have at least one NUMA node");
        Self {
            nodes: (0..nodes)
                .map(|id| NumaNode { id, worker_count: workers_per_node })
                .collect(),
        }
    }

    // ── Queries ───────────────────────────────────────────────────────────

    /// Returns the number of NUMA nodes in this topology.
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// Returns a reference to all nodes.
    pub fn nodes(&self) -> &[NumaNode] {
        &self.nodes
    }

    // ── Worker assignment ─────────────────────────────────────────────────

    /// Round-robin assignment of a worker to a NUMA node.
    ///
    /// Worker 0 → node 0, worker 1 → node 1, …, worker N → node (N % node_count).
    ///
    /// Returns a *clone* of the corresponding [`NumaNode`].
    pub fn assign_worker(&self, worker_id: usize) -> NumaNode {
        let idx = worker_id % self.nodes.len();
        self.nodes[idx].clone()
    }

    // ── Work partitioning ─────────────────────────────────────────────────

    /// Divide `total_spins` evenly across all nodes.
    ///
    /// Any remainder spins are distributed one-per-node starting from node 0,
    /// so the sum of all chunk sizes always equals `total_spins`.
    ///
    /// Returns one [`WorkChunk`] per node.  If `total_spins == 0` every chunk
    /// has `spin_start == spin_end == 0`.
    pub fn partition_work(&self, total_spins: u64) -> Vec<WorkChunk> {
        let n = self.nodes.len() as u64;
        let base = total_spins / n;
        let remainder = total_spins % n;

        let mut chunks = Vec::with_capacity(self.nodes.len());
        let mut cursor: u64 = 0;

        for (i, node) in self.nodes.iter().enumerate() {
            let extra = if (i as u64) < remainder { 1 } else { 0 };
            let size = base + extra;
            chunks.push(WorkChunk {
                node_id: node.id,
                spin_start: cursor,
                spin_end: cursor + size,
            });
            cursor += size;
        }
        chunks
    }
}

// ─── Tests (unit) ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_returns_at_least_one_node() {
        let topo = NumaTopology::detect();
        assert!(topo.node_count() >= 1);
    }

    #[test]
    fn simulated_layout() {
        let topo = NumaTopology::simulated(4, 8);
        assert_eq!(topo.node_count(), 4);
        for node in topo.nodes() {
            assert_eq!(node.worker_count, 8);
        }
    }

    #[test]
    fn assign_worker_round_robin() {
        let topo = NumaTopology::simulated(3, 1);
        assert_eq!(topo.assign_worker(0).id, 0);
        assert_eq!(topo.assign_worker(1).id, 1);
        assert_eq!(topo.assign_worker(2).id, 2);
        assert_eq!(topo.assign_worker(3).id, 0);
    }

    #[test]
    fn partition_sums_to_total() {
        let topo = NumaTopology::simulated(4, 2);
        let chunks = topo.partition_work(1000);
        let total: u64 = chunks.iter().map(|c| c.spin_end - c.spin_start).sum();
        assert_eq!(total, 1000);
    }
}
