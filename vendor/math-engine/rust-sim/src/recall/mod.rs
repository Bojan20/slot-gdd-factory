//! Faza 8.5 — Spin Recall & Replay (Rust mirror of `src/recall/`).
//!
//! Byte-level contract with TS: a journal written by `MemoryJournal` /
//! `NdjsonFileJournal` on either side must replay cleanly under the
//! other. KAT in `tests/recall_kat.rs` pins the canonical sha256 of a
//! fixed entry so any drift in canonical-JSON serialization or hash
//! computation fails CI.
//!
//! See `docs/RECALL_SPEC.md` for the canonical specification.

pub mod integrity;
pub mod journal;
pub mod replay;
pub mod types;

#[allow(unused_imports)]
pub use integrity::{
    canonical_json, compute_entry_hash, compute_manifest_hash, seal_entry, seal_manifest,
    sha256_hex, verify_chain, ChainVerification,
};
#[allow(unused_imports)]
pub use journal::{
    read_manifest, write_manifest, Journal, MemoryJournal, NdjsonFileJournal, ENGINE_VERSION,
};
#[allow(unused_imports)]
pub use replay::{replay_spin, DriverOutput, ReplayDriver, ReplayOptions};
#[allow(unused_imports)]
pub use types::{
    BetMeta, ComplianceFlags, Hex64, JournalManifest, PreSpinState, ReplayFailure, ReplayResult,
    SchemaVersion, SpinJournalEntry, SpinResultSummary, RECALL_SCHEMA_VERSION, ZERO_HASH,
};
