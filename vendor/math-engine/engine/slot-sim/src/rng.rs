// RNG wrapper — Pcg64 with deterministic seeding. Identical to CE-COPY-TEST
// engine; promoted to the universal crate so any game can reuse.

use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64;

#[derive(Debug, Clone)]
pub struct Prng(pub Pcg64);

impl Prng {
    pub fn from_seed(seed: u64) -> Self {
        Prng(Pcg64::seed_from_u64(seed))
    }

    #[inline]
    pub fn gen_range_i64(&mut self, n: i64) -> i64 {
        debug_assert!(n > 0, "weight total must be > 0, got {n}");
        self.0.gen_range(0..n)
    }

    #[inline]
    pub fn gen_u32(&mut self) -> u32 {
        self.0.gen()
    }

    #[inline]
    pub fn gen_f64(&mut self) -> f64 {
        self.0.gen()
    }
}
