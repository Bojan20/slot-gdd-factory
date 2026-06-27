//! Mirror of `src/recall/types.ts`. Every field name + JSON shape must
//! match the TS side exactly so a journal written here replays cleanly
//! under TS (and vice versa).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type Hex64 = String; // 64-char lowercase hex sha256 output
pub type SchemaVersion = String;

pub const RECALL_SCHEMA_VERSION: &str = "1.0.0";
pub const ZERO_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BetMeta {
    pub ante: bool,
    pub buy_feature: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreSpinState {
    pub in_free_spins: bool,
    pub fs_remaining: u32,
    pub fs_global_multiplier: u32,
    pub in_hold_and_win: bool,
    pub hnw_respins_remaining: u32,
    /// Jackpot pools in millicredits, keyed by tier id.
    pub jackpot_pools_mc: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpinResultSummary {
    pub total_win_mc: u64,
    pub line_wins_count: u32,
    pub scatter_count: u32,
    pub bonus_count: u32,
    pub triggered_features: Vec<String>,
    pub feature_trace_hash: Hex64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature_trace: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComplianceFlags {
    pub win_cap_applied: bool,
    pub near_miss_flagged: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpinJournalEntry {
    pub schema_version: SchemaVersion,
    pub seq: u64,
    pub prev_hash: Hex64,
    pub entry_hash: Hex64,

    pub session_id: String,
    pub player_pseudonym: String,
    pub spin_index: u64,

    pub timestamp_utc: String,

    pub config_hash: Hex64,
    pub engine_version: String,
    pub engine_build: String,

    pub rng_kind: String,
    pub rng_seed_hex: String,
    pub rng_step: u64,

    pub bet_total_mc: u64,
    pub bet_currency: String,
    pub bet_meta: BetMeta,

    pub pre_state: PreSpinState,
    pub result: SpinResultSummary,
    pub compliance: ComplianceFlags,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JournalManifest {
    pub schema_version: SchemaVersion,
    pub engine_version: String,
    pub journal_file: String,
    pub first_seq: i64,
    pub last_seq: i64,
    pub first_timestamp_utc: String,
    pub last_timestamp_utc: String,
    pub last_entry_hash: Hex64,
    pub manifest_hash: Hex64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "reason", rename_all = "snake_case")]
pub enum ReplayFailure {
    ConfigHashMismatch { detail: String },
    VersionMismatch { detail: String },
    ResultMismatch { detail: String },
    ChainBreak { detail: String },
    InvalidEntry { detail: String },
    EngineError { detail: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ReplayResult {
    Ok {
        ok: bool,
        entry: SpinJournalEntry,
        verified_at_utc: String,
    },
    Err {
        ok: bool,
        #[serde(flatten)]
        failure: ReplayFailure,
    },
}
