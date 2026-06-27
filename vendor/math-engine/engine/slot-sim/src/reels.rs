// Reel strip sampler — promoted from CE-COPY-TEST engine. Generic over
// `Topology::Rectangular` (any rows × reels) and supports linked-block
// FS spin model (FS reels 2/3/4 share one stop).

use crate::ir::{Ir, ReelSet};
use crate::rng::Prng;

#[derive(Debug, Clone)]
pub struct Strip {
    pub symbols: Vec<String>,
    pub cum: Vec<i64>,
    pub total: i64,
}

impl Strip {
    pub fn new(entries: &[(String, i64)]) -> Self {
        let mut symbols = Vec::with_capacity(entries.len());
        let mut cum = Vec::with_capacity(entries.len());
        let mut running = 0i64;
        for (s, w) in entries {
            running += *w;
            symbols.push(s.clone());
            cum.push(running);
        }
        Strip { symbols, cum, total: running }
    }

    #[inline]
    pub fn sample_stop(&self, rng: &mut Prng) -> usize {
        let r = rng.gen_range_i64(self.total);
        self.cum.partition_point(|&c| c <= r)
    }

    /// Visible N-row window centred on `stop` (row 0 = above stop, row 1 = stop, …).
    /// `rows` parameter lets us serve 3×5 (CE) and 4×5 (Wolf Run) from the same code.
    pub fn visible(&self, stop: usize, rows: usize) -> Vec<String> {
        let n = self.symbols.len();
        let mut out = Vec::with_capacity(rows);
        // Center the visible window on `stop`: stop is the middle row for odd
        // count; for 4-row games, treat `stop` as second row from top.
        let offset_top: isize = -((rows as isize) / 2);
        for i in 0..rows {
            let idx = (stop as isize + offset_top + i as isize).rem_euclid(n as isize) as usize;
            out.push(self.symbols[idx].clone());
        }
        out
    }
}

#[derive(Debug, Clone)]
pub struct WeightedTable<T: Clone> {
    pub items: Vec<T>,
    pub cum: Vec<i64>,
    pub total: i64,
}

impl<T: Clone> WeightedTable<T> {
    pub fn new(pairs: Vec<(T, i64)>) -> Self {
        let mut items = Vec::with_capacity(pairs.len());
        let mut cum = Vec::with_capacity(pairs.len());
        let mut running = 0i64;
        for (it, w) in pairs {
            running += w;
            items.push(it);
            cum.push(running);
        }
        WeightedTable { items, cum, total: running }
    }

    #[inline]
    pub fn sample_with_index(&self, rng: &mut Prng) -> (&T, usize) {
        let r = rng.gen_range_i64(self.total);
        let idx = self.cum.partition_point(|&c| c <= r);
        (&self.items[idx], idx)
    }
}

#[derive(Debug, Clone)]
pub struct CompiledReelSet {
    pub set: i64,
    pub strips: Vec<Strip>, // one per reel
}

impl CompiledReelSet {
    pub fn from_ir(rs: &ReelSet) -> Self {
        let strips = rs
            .reels
            .iter()
            .map(|r| {
                let pairs: Vec<(String, i64)> =
                    r.iter().map(|s| (s.symbol.clone(), s.weight)).collect();
                Strip::new(&pairs)
            })
            .collect();
        CompiledReelSet { set: rs.set, strips }
    }
}

#[derive(Debug, Clone)]
pub struct ReelSetPicker {
    pub sets: Vec<CompiledReelSet>,
    pub picker: WeightedTable<usize>,
}

impl ReelSetPicker {
    pub fn from_base(ir: &Ir) -> Self {
        let by_idx: std::collections::HashMap<i64, &ReelSet> =
            ir.reels.base.iter().map(|s| (s.set, s)).collect();
        let mut sets = Vec::new();
        let mut pairs = Vec::new();
        for (i, w) in ir.reels.base_weights.weights.iter().enumerate() {
            let rs = by_idx
                .get(&w.set)
                .unwrap_or_else(|| panic!("base reel set {} missing", w.set));
            sets.push(CompiledReelSet::from_ir(rs));
            pairs.push((i, w.weight));
        }
        let picker = WeightedTable::new(pairs);
        ReelSetPicker { sets, picker }
    }

    pub fn from_fs(ir: &Ir) -> Option<Self> {
        if ir.reels.fs.is_empty() {
            return None;
        }
        let weights = ir.reels.fs_weights.as_ref()?;
        let by_idx: std::collections::HashMap<i64, &ReelSet> =
            ir.reels.fs.iter().map(|s| (s.set, s)).collect();
        let mut sets = Vec::new();
        let mut pairs = Vec::new();
        for (i, w) in weights.weights.iter().enumerate() {
            let rs = by_idx
                .get(&w.set)
                .unwrap_or_else(|| panic!("fs reel set {} missing", w.set));
            sets.push(CompiledReelSet::from_ir(rs));
            pairs.push((i, w.weight));
        }
        Some(ReelSetPicker {
            sets,
            picker: WeightedTable::new(pairs),
        })
    }

    #[inline]
    pub fn pick(&self, rng: &mut Prng) -> &CompiledReelSet {
        let (idx, _) = self.picker.sample_with_index(rng);
        &self.sets[*idx]
    }
}

/// Visible grid (variable dimensions). `cells[reel][row]`.
#[derive(Debug, Clone)]
pub struct Grid {
    pub cells: Vec<Vec<String>>,
    pub stops: Vec<usize>,
}

impl Grid {
    pub fn new(reels: usize, rows: usize) -> Self {
        Grid {
            cells: vec![vec![String::new(); rows]; reels],
            stops: vec![0; reels],
        }
    }

    pub fn spin(rs: &CompiledReelSet, rows: usize, rng: &mut Prng) -> Self {
        let reels = rs.strips.len();
        let mut g = Grid::new(reels, rows);
        for r in 0..reels {
            let stop = rs.strips[r].sample_stop(rng);
            g.stops[r] = stop;
            let view = rs.strips[r].visible(stop, rows);
            for (row, sym) in view.into_iter().enumerate() {
                g.cells[r][row] = sym;
            }
        }
        g
    }

    /// W4.3d — IGT virtual-reel sampling.
    ///
    /// Per-cell independent sample from each reel's weighted strip. This
    /// matches how IGT publishes `Symbol Counts per Reel` (virtual reel of
    /// weight-total ~1000 per reel) rather than the L&W positional model
    /// where four adjacent rows of a physical strip share a window.
    ///
    /// Equivalent to drawing each (reel, row) cell independently from the
    /// reel's symbol distribution — no row-to-row correlation on the same
    /// reel. Stops are not meaningful in virtual mode and are zeroed.
    pub fn spin_virtual(rs: &CompiledReelSet, rows: usize, rng: &mut Prng) -> Self {
        let reels = rs.strips.len();
        let mut g = Grid::new(reels, rows);
        for r in 0..reels {
            for row in 0..rows {
                let stop = rs.strips[r].sample_stop(rng);
                g.cells[r][row] = rs.strips[r].symbols[stop].clone();
            }
            g.stops[r] = 0; // not meaningful in virtual mode
        }
        g
    }

    /// Linked-reels spin: a subset of reels share one stop (CE FS reels 2/3/4).
    pub fn spin_linked(
        rs: &CompiledReelSet,
        rows: usize,
        linked: &[u32],
        rng: &mut Prng,
    ) -> Self {
        let reels = rs.strips.len();
        let mut g = Grid::new(reels, rows);
        // The linked block reads its stop from the first reel in the linked
        // list and replays the same window across the rest.
        let linked_set: std::collections::HashSet<u32> = linked.iter().copied().collect();
        let leader_reel = linked.first().copied().unwrap_or(0) as usize;
        let linked_stop = rs.strips[leader_reel].sample_stop(rng);
        let linked_view = rs.strips[leader_reel].visible(linked_stop, rows);
        for r in 0..reels {
            if linked_set.contains(&(r as u32)) {
                g.stops[r] = linked_stop;
                for (row, sym) in linked_view.iter().enumerate() {
                    g.cells[r][row] = sym.clone();
                }
            } else {
                let stop = rs.strips[r].sample_stop(rng);
                g.stops[r] = stop;
                let view = rs.strips[r].visible(stop, rows);
                for (row, sym) in view.into_iter().enumerate() {
                    g.cells[r][row] = sym;
                }
            }
        }
        g
    }

    #[inline]
    pub fn cell(&self, reel: usize, row: usize) -> &str {
        self.cells[reel][row].as_str()
    }

    #[inline]
    pub fn rows(&self) -> usize {
        self.cells.first().map(|c| c.len()).unwrap_or(0)
    }

    #[inline]
    pub fn reels(&self) -> usize {
        self.cells.len()
    }
}
