//! PAR-013 — Cluster Pays evaluator.
//!
//! Cluster Pays (NetEnt, Push Gaming, Big Time Gaming) replace paylines with
//! connected components of identical symbols on the grid. A cluster pays when
//! it reaches `min_cluster_size` cells; payout typically scales with cluster
//! size via a step function `S × pay_per_size[size]`.
//!
//! ## Adjacency rules (Doc §6 / Industry standard)
//! * `Orthogonal` (default) — 4-neighbor (up/down/left/right).
//! * `Diagonal` — 8-neighbor.
//! * `Hex` — hex-grid offset coordinates (not yet implemented here).
//!
//! This module is grid-agnostic: it takes a `Vec<Vec<String>>` where `grid[r][c]`
//! is the symbol id at row r, column c. Wild substitution is handled by the
//! caller (replace wilds with the target symbol before invocation).

use serde::{Deserialize, Serialize};

/// Adjacency model for cluster connectivity.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClusterAdjacency {
    /// 4-neighbor (NetEnt, Push Gaming default).
    Orthogonal,
    /// 8-neighbor (rare — Big Time Gaming "Spin to Win").
    Diagonal,
}

/// One connected cluster: symbol + cell list + size + payout multiplier.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Cluster {
    pub symbol: String,
    pub size: u32,
    pub cells: Vec<(u32, u32)>,
    pub multiplier: f64,
}

/// Find all clusters of size ≥ `min_size` in `grid` (grid[row][col]).
///
/// Algorithm: BFS over each unvisited cell. Returns clusters in deterministic
/// row-major scan order.
pub fn find_clusters(
    grid: &[Vec<String>],
    min_size: u32,
    adjacency: ClusterAdjacency,
) -> Vec<Cluster> {
    let rows = grid.len();
    if rows == 0 {
        return Vec::new();
    }
    let cols = grid[0].len();
    let mut visited = vec![vec![false; cols]; rows];
    let mut clusters: Vec<Cluster> = Vec::new();

    let neighbors = move |r: usize, c: usize| -> Vec<(usize, usize)> {
        let mut nbrs = Vec::with_capacity(8);
        let r_i = r as isize;
        let c_i = c as isize;
        let deltas: &[(isize, isize)] = match adjacency {
            ClusterAdjacency::Orthogonal => &[(-1, 0), (1, 0), (0, -1), (0, 1)],
            ClusterAdjacency::Diagonal => &[
                (-1, 0),
                (1, 0),
                (0, -1),
                (0, 1),
                (-1, -1),
                (-1, 1),
                (1, -1),
                (1, 1),
            ],
        };
        for &(dr, dc) in deltas {
            let nr = r_i + dr;
            let nc = c_i + dc;
            if nr >= 0 && nc >= 0 && (nr as usize) < rows && (nc as usize) < cols {
                nbrs.push((nr as usize, nc as usize));
            }
        }
        nbrs
    };

    for r in 0..rows {
        for c in 0..cols {
            if visited[r][c] {
                continue;
            }
            let sym = &grid[r][c];
            if sym.is_empty() {
                visited[r][c] = true;
                continue;
            }
            // BFS expansion.
            let mut queue = vec![(r, c)];
            let mut cluster_cells: Vec<(u32, u32)> = Vec::new();
            while let Some((rr, cc)) = queue.pop() {
                if visited[rr][cc] {
                    continue;
                }
                if &grid[rr][cc] != sym {
                    continue;
                }
                visited[rr][cc] = true;
                cluster_cells.push((rr as u32, cc as u32));
                for n in neighbors(rr, cc) {
                    if !visited[n.0][n.1] && grid[n.0][n.1] == *sym {
                        queue.push(n);
                    }
                }
            }
            let size = cluster_cells.len() as u32;
            if size >= min_size {
                cluster_cells.sort();
                clusters.push(Cluster {
                    symbol: sym.clone(),
                    size,
                    cells: cluster_cells,
                    multiplier: 0.0, // filled by `score_clusters`
                });
            }
        }
    }
    clusters
}

/// Score every cluster using `cluster_pay_table[size]` (or the highest tabled
/// size if cluster exceeds it). Returns total payout multiplier (× bet).
pub fn score_clusters(
    clusters: &mut [Cluster],
    cluster_pay_table: &std::collections::BTreeMap<u32, f64>,
) -> f64 {
    let max_tabled = cluster_pay_table.keys().max().copied().unwrap_or(0);
    let mut total = 0.0_f64;
    for c in clusters.iter_mut() {
        let key = c.size.min(max_tabled);
        c.multiplier = cluster_pay_table.get(&key).copied().unwrap_or(0.0);
        total += c.multiplier;
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn grid(rows: &[&str]) -> Vec<Vec<String>> {
        rows.iter()
            .map(|r| r.chars().map(|c| c.to_string()).collect())
            .collect()
    }

    #[test]
    fn single_4cell_cluster_orthogonal() {
        let g = grid(&[
            "AABB", //
            "AABB", //
            "CCBB", //
        ]);
        let mut cs = find_clusters(&g, 5, ClusterAdjacency::Orthogonal);
        // B cluster size = 6, A cluster size = 4 (< min), C cluster = 2.
        assert_eq!(cs.len(), 1);
        let b = &cs[0];
        assert_eq!(b.symbol, "B");
        assert_eq!(b.size, 6);

        let mut pay = BTreeMap::new();
        pay.insert(5, 5.0);
        pay.insert(6, 10.0);
        pay.insert(7, 20.0);
        let total = score_clusters(&mut cs, &pay);
        assert!((total - 10.0).abs() < 1e-9);
        assert!((cs[0].multiplier - 10.0).abs() < 1e-9);
    }

    #[test]
    fn diagonal_adjacency_finds_x_shape() {
        let g = grid(&[
            "AB", //
            "BA", //
        ]);
        // Orthogonal: 2× A isolated, 2× B isolated → 0 clusters of size ≥ 2.
        let cs_ortho = find_clusters(&g, 2, ClusterAdjacency::Orthogonal);
        assert_eq!(cs_ortho.len(), 0);
        // Diagonal: A's connect via (0,0)-(1,1), B's via (0,1)-(1,0).
        let cs_diag = find_clusters(&g, 2, ClusterAdjacency::Diagonal);
        assert_eq!(cs_diag.len(), 2);
    }

    #[test]
    fn cluster_size_above_tabled_max_uses_max() {
        let g = grid(&[
            "AAAA", //
            "AAAA", //
        ]); // single cluster size 8
        let mut cs = find_clusters(&g, 5, ClusterAdjacency::Orthogonal);
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].size, 8);
        let mut pay = BTreeMap::new();
        pay.insert(5, 5.0);
        pay.insert(6, 10.0);
        let total = score_clusters(&mut cs, &pay);
        // Size 8 > max tabled 6 → uses 10.0.
        assert!((total - 10.0).abs() < 1e-9);
    }

    #[test]
    fn empty_grid_returns_no_clusters() {
        let g: Vec<Vec<String>> = vec![];
        let cs = find_clusters(&g, 5, ClusterAdjacency::Orthogonal);
        assert!(cs.is_empty());
    }
}
