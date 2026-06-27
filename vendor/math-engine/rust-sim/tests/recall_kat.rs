//! Faza 8.5 — Cross-language KAT for the recall hash chain.
//!
//! Pins the canonical sha256 hash of a fixed `SpinJournalEntry`. The
//! TS suite in `tests/recall.test.ts` computes the same hash from the
//! same fixture and asserts the same literal. If either side drifts
//! (canonical-JSON key ordering, escape rules, number rendering, sha256
//! implementation) both gates fail.
//!
//! Plus integration tests for the in-memory and file journals, and
//! replay-driver outcomes.

use std::collections::BTreeMap;

use slot_sim::recall::{
    canonical_json, compute_entry_hash, replay_spin, seal_entry, verify_chain, BetMeta,
    ChainVerification, ComplianceFlags, DriverOutput, Journal, MemoryJournal, NdjsonFileJournal,
    PreSpinState, ReplayDriver, ReplayFailure, ReplayOptions, ReplayResult, SpinJournalEntry,
    SpinResultSummary, RECALL_SCHEMA_VERSION, ZERO_HASH,
};

fn fixed_entry() -> SpinJournalEntry {
    SpinJournalEntry {
        schema_version: RECALL_SCHEMA_VERSION.into(),
        seq: 0,
        prev_hash: ZERO_HASH.into(),
        entry_hash: String::new(),
        session_id: "kat".into(),
        player_pseudonym: "p".into(),
        spin_index: 0,
        timestamp_utc: "2024-01-01T00:00:00.000Z".into(),
        config_hash: "a".repeat(64),
        engine_version: "0.5.0".into(),
        engine_build: "g0".into(),
        rng_kind: "pcg64".into(),
        rng_seed_hex: "0".into(),
        rng_step: 0,
        bet_total_mc: 1000,
        bet_currency: "EUR".into(),
        bet_meta: BetMeta {
            ante: false,
            buy_feature: None,
        },
        pre_state: PreSpinState {
            in_free_spins: false,
            fs_remaining: 0,
            fs_global_multiplier: 1,
            in_hold_and_win: false,
            hnw_respins_remaining: 0,
            jackpot_pools_mc: BTreeMap::new(),
        },
        result: SpinResultSummary {
            total_win_mc: 0,
            line_wins_count: 0,
            scatter_count: 0,
            bonus_count: 0,
            triggered_features: vec![],
            feature_trace_hash: "0".repeat(64),
            feature_trace: None,
        },
        compliance: ComplianceFlags {
            win_cap_applied: false,
            near_miss_flagged: false,
        },
    }
}

const KAT_HASH: &str = "d278123a93461184a3ecb95aaa3a43ba1e8a6e0fb4ae109c6b52073cf7a2a3ed";

#[test]
fn canonical_hash_matches_ts() {
    let entry = fixed_entry();
    let hash = compute_entry_hash(&entry);
    assert_eq!(
        hash, KAT_HASH,
        "canonical-JSON sha256 drifted from TS pin — recompute fixture or fix serializer"
    );
}

// ─── canonical_json shape checks ───────────────────────────────────────

#[test]
fn canonical_json_sorts_keys() {
    let v: serde_json::Value = serde_json::json!({ "b": 1, "a": { "d": 2, "c": 3 }});
    assert_eq!(canonical_json(&v), r#"{"a":{"c":3,"d":2},"b":1}"#);
}

#[test]
fn canonical_json_strings_escape_like_js() {
    let v = serde_json::json!("a\"b");
    assert_eq!(canonical_json(&v), r#""a\"b""#);
}

// ─── MemoryJournal ─────────────────────────────────────────────────────

fn drafts() -> Vec<SpinJournalEntry> {
    let mut a = fixed_entry();
    a.seq = 0;
    a.session_id = "s".into();
    a.spin_index = 0;
    let mut b = fixed_entry();
    b.seq = 1;
    b.session_id = "s".into();
    b.spin_index = 1;
    b.result.total_win_mc = 500;
    vec![a, b]
}

#[test]
fn memory_journal_appends_and_chains() {
    let mut j = MemoryJournal::new();
    let drafts = drafts();
    let a = j.append(drafts[0].clone()).unwrap();
    let b = j.append(drafts[1].clone()).unwrap();
    assert_eq!(a.seq, 0);
    assert_eq!(b.prev_hash, a.entry_hash);
    assert_eq!(j.size(), 2);
    let v = verify_chain(&j.read_all());
    assert!(matches!(v, ChainVerification::Ok { .. }));
}

#[test]
fn memory_journal_rejects_out_of_order_seq() {
    let mut j = MemoryJournal::new();
    let drafts = drafts();
    j.append(drafts[0].clone()).unwrap();
    let mut bad = drafts[1].clone();
    bad.seq = 5;
    let r = j.append(bad);
    assert!(r.is_err(), "expected error, got {:?}", r);
}

// ─── Chain tampering detection ─────────────────────────────────────────

#[test]
fn verify_chain_detects_prev_hash_tampering() {
    let mut j = MemoryJournal::new();
    let drafts = drafts();
    j.append(drafts[0].clone()).unwrap();
    j.append(drafts[1].clone()).unwrap();
    let mut all = j.read_all();
    all[1].prev_hash = "f".repeat(64);
    let v = verify_chain(&all);
    assert!(
        matches!(v, ChainVerification::PrevHashMismatch { .. }),
        "got {v:?}"
    );
}

#[test]
fn verify_chain_detects_payload_tampering() {
    let mut j = MemoryJournal::new();
    let drafts = drafts();
    j.append(drafts[0].clone()).unwrap();
    j.append(drafts[1].clone()).unwrap();
    let mut all = j.read_all();
    all[1].result.total_win_mc = 999_999; // payload edit, hash unchanged
    let v = verify_chain(&all);
    assert!(
        matches!(v, ChainVerification::EntryHashMismatch { .. }),
        "got {v:?}"
    );
}

#[test]
fn verify_chain_detects_seq_non_monotonic() {
    let mut j = MemoryJournal::new();
    let drafts = drafts();
    let a = j.append(drafts[0].clone()).unwrap();
    // Forge a second entry with seq=0 again, chained against a's hash.
    let mut forged_draft = drafts[0].clone();
    forged_draft.seq = 0;
    forged_draft.spin_index = 99;
    let forged = seal_entry(forged_draft, Some(&a.entry_hash));
    let v = verify_chain(&[a, forged]);
    assert!(
        matches!(v, ChainVerification::SeqNotMonotonic { .. }),
        "got {v:?}"
    );
}

#[test]
fn verify_chain_rejects_empty() {
    let v = verify_chain(&[]);
    assert!(matches!(v, ChainVerification::Empty));
}

// ─── NdjsonFileJournal ─────────────────────────────────────────────────

/// Hold the TempDir alongside the path so it isn't dropped before the
/// journal writes to it. Returning just a `PathBuf` from a helper was a
/// trap — TempDir's Drop wipes the directory the moment scope ends.
struct TmpJournal {
    _dir: tempfile::TempDir,
    path: String,
}
fn temp_journal() -> TmpJournal {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("journal.ndjson");
    let path = p.to_str().unwrap().to_string();
    TmpJournal { _dir: dir, path }
}

#[test]
fn file_journal_persists_and_recovers() {
    let t = temp_journal();
    {
        let mut j = NdjsonFileJournal::new(t.path.clone()).unwrap();
        let ds = drafts();
        j.append(ds[0].clone()).unwrap();
        j.append(ds[1].clone()).unwrap();
        // drop closes file
    }
    let j2 = NdjsonFileJournal::new(t.path).unwrap();
    assert_eq!(j2.size(), 2);
    let all = j2.read_all();
    let v = verify_chain(&all);
    assert!(matches!(v, ChainVerification::Ok { count: 2, .. }));
}

#[test]
fn file_journal_refuses_corrupt_tail() {
    let t = temp_journal();
    {
        let mut j = NdjsonFileJournal::new(t.path.clone()).unwrap();
        let ds = drafts();
        j.append(ds[0].clone()).unwrap();
        j.append(ds[1].clone()).unwrap();
    }
    // Corrupt the last line.
    let raw = std::fs::read_to_string(&t.path).unwrap();
    let mut lines: Vec<String> = raw
        .split('\n')
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect();
    let last: SpinJournalEntry = serde_json::from_str(&lines[1]).unwrap();
    let mut tampered = last;
    tampered.prev_hash = "f".repeat(64);
    lines[1] = serde_json::to_string(&tampered).unwrap();
    std::fs::write(&t.path, lines.join("\n") + "\n").unwrap();

    let res = NdjsonFileJournal::new(t.path);
    assert!(res.is_err(), "expected chain-break error, got Ok");
    assert!(res.err().unwrap().contains("chain break"));
}

// ─── Replay ────────────────────────────────────────────────────────────

fn entry_with_trace(trace: serde_json::Value) -> SpinJournalEntry {
    let trace_hash = slot_sim::recall::sha256_hex(&canonical_json(&trace));
    let mut e = fixed_entry();
    e.result.total_win_mc = 12_500;
    e.result.line_wins_count = 3;
    e.result.feature_trace_hash = trace_hash;
    seal_entry(e, None)
}

#[test]
fn replay_ok_when_summary_and_trace_match() {
    let trace = serde_json::json!({ "wins": [{"line": 1, "count": 3}], "events": [] });
    let entry = entry_with_trace(trace.clone());
    let driver: Box<ReplayDriver> = Box::new(move |e: &SpinJournalEntry| {
        Ok(DriverOutput {
            summary: e.result.clone(),
            feature_trace: trace.clone(),
        })
    });
    let opts = ReplayOptions {
        engine_version: "0.5.0",
        expected_config_hash: &"a".repeat(64),
        allow_minor_drift: false,
    };
    let r = replay_spin(&entry, &*driver, &opts);
    assert!(matches!(r, ReplayResult::Ok { .. }), "got {r:?}");
}

#[test]
fn replay_detects_config_hash_mismatch() {
    let entry = entry_with_trace(serde_json::json!({}));
    let driver: Box<ReplayDriver> = Box::new(|e: &SpinJournalEntry| {
        Ok(DriverOutput {
            summary: e.result.clone(),
            feature_trace: serde_json::json!({}),
        })
    });
    let bad_hash = "b".repeat(64);
    let opts = ReplayOptions {
        engine_version: "0.5.0",
        expected_config_hash: &bad_hash,
        allow_minor_drift: false,
    };
    let r = replay_spin(&entry, &*driver, &opts);
    assert!(matches!(
        r,
        ReplayResult::Err {
            failure: ReplayFailure::ConfigHashMismatch { .. },
            ..
        }
    ));
}

#[test]
fn replay_detects_version_mismatch_major() {
    let entry = entry_with_trace(serde_json::json!({}));
    let driver: Box<ReplayDriver> = Box::new(|e: &SpinJournalEntry| {
        Ok(DriverOutput {
            summary: e.result.clone(),
            feature_trace: serde_json::json!({}),
        })
    });
    let opts = ReplayOptions {
        engine_version: "1.0.0",
        expected_config_hash: &"a".repeat(64),
        allow_minor_drift: false,
    };
    let r = replay_spin(&entry, &*driver, &opts);
    assert!(matches!(
        r,
        ReplayResult::Err {
            failure: ReplayFailure::VersionMismatch { .. },
            ..
        }
    ));
}

#[test]
fn replay_detects_trace_hash_mismatch() {
    let trace = serde_json::json!({ "v": 1 });
    let entry = entry_with_trace(trace);
    // Driver emits a *different* trace → trace hash mismatch.
    let driver: Box<ReplayDriver> = Box::new(|e: &SpinJournalEntry| {
        Ok(DriverOutput {
            summary: e.result.clone(),
            feature_trace: serde_json::json!({ "v": 2 }),
        })
    });
    let opts = ReplayOptions {
        engine_version: "0.5.0",
        expected_config_hash: &"a".repeat(64),
        allow_minor_drift: false,
    };
    let r = replay_spin(&entry, &*driver, &opts);
    assert!(matches!(
        r,
        ReplayResult::Err {
            failure: ReplayFailure::ResultMismatch { .. },
            ..
        }
    ));
}

#[test]
fn replay_surfaces_engine_error() {
    let entry = entry_with_trace(serde_json::json!({}));
    let driver: Box<ReplayDriver> = Box::new(|_: &SpinJournalEntry| Err("rng oom".into()));
    let opts = ReplayOptions {
        engine_version: "0.5.0",
        expected_config_hash: &"a".repeat(64),
        allow_minor_drift: false,
    };
    let r = replay_spin(&entry, &*driver, &opts);
    match r {
        ReplayResult::Err {
            failure: ReplayFailure::EngineError { detail },
            ..
        } => assert_eq!(detail, "rng oom"),
        other => panic!("expected EngineError, got {other:?}"),
    }
}
