/**
 * Faza 8.5 — Spin Recall & Replay types.
 *
 * Mirrored 1:1 by `rust-sim/src/recall/types.rs`. Field order /
 * serialization MUST stay aligned — the journal is the byte-level
 * contract between the two engines (TS-written journal must replay
 * cleanly under Rust and vice versa, per Faza 10.3 parity).
 *
 * See `docs/RECALL_SPEC.md` for the canonical specification.
 */

export type Hex64 = string; // 64-hex-char lowercase, sha256 output
export type SchemaVersion = `${number}.${number}.${number}`;

/** Bet input — integer millicredits to dodge f64 drift across platforms. */
export interface BetInput {
  total_mc: number; // bet amount × 1000
  currency: string; // ISO 4217
  meta: BetMeta;
}

export interface BetMeta {
  ante: boolean;
  /** Buy-feature offer ID if used (`null` if not). */
  buy_feature: string | null;
}

/**
 * Snapshot of the engine state *before* the spin runs. Replay needs
 * this to reconstruct stateful features (FS counters, H&W respin
 * tally, jackpot pool balances).
 */
export interface PreSpinState {
  in_free_spins: boolean;
  fs_remaining: number;
  fs_global_multiplier: number;
  in_hold_and_win: boolean;
  hnw_respins_remaining: number;
  /** Jackpot pools in millicredits, keyed by tier id (MINI / GRAND / etc). */
  jackpot_pools_mc: Record<string, number>;
}

/**
 * Result summary — sufficient to audit without holding the full
 * structured feature trace. The optional `feature_trace` mirror is
 * provided for deep audits; the `feature_trace_hash` is mandatory and
 * lets a regulator verify a trace they receive separately.
 */
export interface SpinResultSummary {
  total_win_mc: number;
  line_wins_count: number;
  scatter_count: number;
  bonus_count: number;
  triggered_features: string[];
  feature_trace_hash: Hex64;
  /** Optional verbose trace — operators may strip this on rotation. */
  feature_trace?: unknown;
}

/** Compliance flags surfaced by the engine validator at write time. */
export interface ComplianceFlags {
  win_cap_applied: boolean;
  near_miss_flagged: boolean;
}

/**
 * One row in the journal. `entry_hash` is the sha256 of the canonical
 * JSON of THIS object with `entry_hash` removed. `prev_hash` is the
 * `entry_hash` of the previous row.
 */
export interface SpinJournalEntry {
  schema_version: SchemaVersion;
  seq: number;
  prev_hash: Hex64;
  entry_hash: Hex64;

  session_id: string;
  player_pseudonym: string;
  spin_index: number;

  timestamp_utc: string; // ISO 8601 with millisecond precision

  config_hash: Hex64;
  engine_version: string;
  engine_build: string;

  rng_kind: string; // 'pcg64' | 'xoshiro256pp' | 'philox4x32' | 'mulberry32' | ...
  rng_seed_hex: string;
  rng_step: number;

  bet_total_mc: number;
  bet_currency: string;
  bet_meta: BetMeta;

  pre_state: PreSpinState;
  result: SpinResultSummary;
  compliance: ComplianceFlags;
}

/**
 * Manifest pinning the head of the chain so regulators can verify the
 * journal hasn't been edited.
 */
export interface JournalManifest {
  schema_version: SchemaVersion;
  engine_version: string;
  journal_file: string;
  first_seq: number;
  last_seq: number;
  first_timestamp_utc: string;
  last_timestamp_utc: string;
  last_entry_hash: Hex64;
  /** sha256 of this manifest minus this field. */
  manifest_hash: Hex64;
}

/** Result returned by `replaySpin`. */
export type ReplayResult =
  | { ok: true; entry: SpinJournalEntry; verified_at_utc: string }
  | {
      ok: false;
      reason:
        | 'config_hash_mismatch'
        | 'version_mismatch'
        | 'result_mismatch'
        | 'chain_break'
        | 'invalid_entry'
        | 'engine_error';
      detail: string;
    };

export const RECALL_SCHEMA_VERSION: SchemaVersion = '1.0.0';
export const ZERO_HASH: Hex64 = '0'.repeat(64);
