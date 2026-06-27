//! Faza 10.2 — Fuzz target: AliasTable construction and sampling.
//!
//! Invariants verified for every fuzzer-generated input:
//!
//! 1. `AliasTable::build` must **never panic** for any valid input
//!    (1-255 entries, non-zero weights, symbol indices in 0-30).
//! 2. `AliasTable::sample` must **always** return an index from the input set.
//! 3. The returned value must fit in 5 bits (≤ 30) — the PackedGrid constraint.
//!
//! ## Running locally
//!
//! ```bash
//! cargo fuzz run fuzz_alias -- -max_total_time=60
//! ```

#![no_main]

use libfuzzer_sys::fuzz_target;
use slot_sim::{rng::SlotRng, speed::AliasTable};

fuzz_target!(|data: &[u8]| {
    if data.len() < 2 {
        return; // need at least 1 entry: (symbol=1byte, weight=1byte)
    }

    // Interpret the fuzz input as a sequence of (symbol, weight) pairs.
    // symbol: 1 byte, clamped to 0-30 (5-bit).
    // weight: 2 bytes (u16 le), clamped to 1-65535 (filter zeros).
    let mut entries: Vec<(u8, u32)> = Vec::new();
    let mut i = 0;

    while i + 2 < data.len() && entries.len() < 255 {
        let sym    = data[i] % 31;      // clamp to 0-30
        let weight = ((data[i + 1] as u32) << 8 | data[i + 2] as u32) + 1;  // ≥ 1
        // De-duplicate: each symbol must appear at most once.
        if !entries.iter().any(|(s, _)| *s == sym) {
            entries.push((sym, weight));
        }
        i += 3;
    }

    if entries.is_empty() {
        return;
    }

    // Build — must not panic.
    let t = AliasTable::build(&entries);

    // Derive a seed from the first 8 bytes of data (or 0 if short).
    let seed = {
        let mut s = 0u64;
        for (j, &b) in data.iter().take(8).enumerate() {
            s |= (b as u64) << (j * 8);
        }
        s
    };

    let valid_syms: std::collections::HashSet<u8> = entries.iter().map(|(s, _)| *s).collect();
    let mut rng = SlotRng::new(seed);

    // Sample 64 times — every result must be in the input set and ≤ 30.
    for _ in 0..64 {
        let s = t.sample(&mut rng);
        assert!(valid_syms.contains(&s), "AliasTable returned {s} not in input");
        assert!(s <= 30,               "AliasTable returned {s} > 30 (5-bit overflow)");
    }
});
