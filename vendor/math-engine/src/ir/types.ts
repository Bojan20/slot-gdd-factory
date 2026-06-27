/**
 * Slot Game IR — TypeScript types.
 *
 * One canonical type tree the entire TS pipeline (preview engine, MC
 * simulator, analytical solver, PAR generator, parity comparator)
 * consumes. The Rust side keeps a mirror in `rust-sim/src/ir/types.rs`
 * — every field name here must match the Rust serde name exactly, or
 * the Faza 10.3 parity gate fails.
 *
 * No runtime logic in this file — runtime validation lives in
 * `schema.ts`, defaults / coercions live in `index.ts`. Keeping them
 * separate means a consumer can `import type { ... }` without pulling
 * Zod into the bundle.
 *
 * Spec: see `docs/IR_SPEC.md` for the formal definition.
 */

export type SchemaVersion = `${number}.${number}.${number}`;
export type SymbolKey = string; // stable kebab/snake key — never an enum
export type ReelIndex = number; // 0-based
export type RowIndex = number; // 0-based

// ─── meta ──────────────────────────────────────────────────────────────
export interface Meta {
  id: string;
  name: string;
  version: SchemaVersion;
  description?: string;
  theme_tags: string[];
  author?: string;
  created_at_utc?: string;
}

// ─── topology ──────────────────────────────────────────────────────────
export type Topology =
  | { kind: 'rectangular'; reels: number; rows: number }
  | {
      kind: 'variable_rows';
      reels: number;
      row_range_per_reel: Array<[number, number]>;
      ways_cap?: number;
    }
  | {
      kind: 'cluster_grid';
      columns: number;
      rows: number;
      adjacency: 'orthogonal' | 'diagonal' | 'hex';
    };

// ─── symbols ───────────────────────────────────────────────────────────
export type SymbolKind =
  | 'lp'
  | 'hp'
  | 'wild'
  | 'scatter'
  | 'bonus'
  | 'multiplier'
  | 'sticky'
  | 'expanding'
  | 'mystery'
  | 'transform'
  | 'chain_wild';

export interface Symbol {
  id: SymbolKey;
  name: string;
  kind: SymbolKind;
  /** List of symbol keys this symbol substitutes for, or "*" for all non-special. */
  substitutes?: SymbolKey[] | '*';
  /** Hint only — explicit `reels` strips override. */
  weight_hint?: number;
  /** Optional reel-eligibility list for positional symbol constraints. */
  appears_on?: ReelIndex[];
  /** W4.7 — advanced behavior (colossal, expanding rule, transforming, collecting). */
  behavior?: SymbolBehavior;
}

// ─── W4.7 symbol behavior ──────────────────────────────────────────────
export type BehaviorType =
  | 'expanding_full_reel'
  | 'walking'
  | 'transforming'
  | 'collecting'
  | 'mystery_reveal'
  | 'colossal'
  | 'sticky';

export interface SymbolBehavior {
  /** `[rows, cols]` for colossal blocks > 1×1. */
  colossal_size?: [number, number];
  behavior_type?: BehaviorType;
  /** For `transforming`: which symbol it becomes. */
  transform_target?: SymbolKey;
  /** For `collecting`: higher = resolved earlier when multiple land. */
  collection_priority?: number;
  /** `undefined` = 1 spin. Otherwise number of spins it persists. */
  sticky_duration_spins?: number;
}

// ─── reels ─────────────────────────────────────────────────────────────
export type ReelSet =
  | {
      mode: 'weighted';
      /** Per-reel symbol→weight map. */
      base: Array<Record<SymbolKey, number>>;
      free_spins?: Array<Record<SymbolKey, number>>;
    }
  | {
      mode: 'strips';
      /** Per-reel explicit symbol strip (full-cycle enumerable). */
      base: SymbolKey[][];
      free_spins?: SymbolKey[][];
    };

// ─── evaluation ────────────────────────────────────────────────────────
export type Direction = 'ltr' | 'rtl' | 'both';

export type Evaluation =
  | {
      kind: 'lines';
      /** payline[reel] = row index. */
      paylines: number[][];
      direction: Direction;
      min_match: number;
      pay_left_to_right_only: boolean;
    }
  | {
      kind: 'ways';
      direction: Direction;
      min_match: number;
      max_ways_per_spin: number;
    }
  | {
      kind: 'cluster';
      min_cluster_size: number;
      /** Cluster size (string key, "12+" allowed) → multiplier scalar. */
      cluster_pay_table: Record<string, number>;
    }
  | { kind: 'pay_anywhere'; min_count: number }
  | {
      kind: 'pattern';
      patterns: Array<{
        id: string;
        positions: Array<[RowIndex, ReelIndex]> | 'all';
        pay_multiplier: number;
      }>;
    };

// ─── paytable ──────────────────────────────────────────────────────────
/**
 * For lines/ways: outer key = symbol id, inner key = match count ("3"…"N"),
 * value = total-bet multiplier.
 *
 * For cluster: outer key = symbol id, inner key = cluster size, value =
 * total-bet multiplier. Validator distinguishes shape per evaluation kind.
 */
export type Paytable = Record<SymbolKey, Record<string, number>>;

// ─── features ──────────────────────────────────────────────────────────
export interface TriggerByCount {
  by: 'scatter_count' | 'bonus_count' | 'special_count';
  /** Map "3"→pay/free-spins-awarded, "4"→…, etc. */
  thresholds?: Record<string, number>;
  /** Inclusive minimum. */
  min?: number;
}

export type Feature =
  | {
      kind: 'free_spins';
      trigger: TriggerByCount;
      retrigger?: TriggerByCount & { max_total?: number };
      global_multiplier?: number;
      /** Modifier flags applied during FS reel set. */
      modifiers?: Array<'sticky_wilds' | 'expanding_wilds' | 'multiplier_ladder' | 'mystery_symbol'>;
    }
  | {
      kind: 'hold_and_win';
      trigger: TriggerByCount;
      respins_initial: number;
      respin_reset_on_new: boolean;
      cash_value_distribution: Array<{ value: number; weight: number }>;
      jackpot_tiers: Array<{ id: string; multiplier: number }>;
      grid_full_award?: string;
    }
  | {
      kind: 'cascade';
      replacement: 'drop' | 'refill_random' | 'fixed_strip';
      max_chain: number;
      multiplier_progression?: number[];
    }
  | { kind: 'respin'; cost_x: number; max_uses_per_spin: number }
  | { kind: 'pick'; prize_pool: Array<{ id: string; weight: number; pay_multiplier: number }> }
  | { kind: 'wheel'; segments: Array<{ id: string; weight: number; pay_multiplier: number }> }
  | {
      kind: 'buy_feature';
      offers: Array<{ id: string; cost_x: number; guaranteed: string }>;
    }
  | { kind: 'ante_bet'; extra_multiplier: number; enabled_by_default: boolean }
  | { kind: 'gamble'; type: 'red_black' | 'suit'; max_steps: number; tie_resolution: 'house' | 'push' }
  | { kind: 'mystery_symbol'; symbol_id: SymbolKey; reveal_distribution: Record<SymbolKey, number> }
  | { kind: 'symbol_upgrade'; from: SymbolKey; to: SymbolKey; probability: number }
  | {
      /** W4.7 — Linear / WAP progressive. Math handled at engine level; this
       * Feature variant is the IR-only declaration so codegen / validators see it. */
      kind: 'linear_progressive';
      pool_id: string;
      contribution_per_spin_x: number;
      seed_x: number;
      must_hit_by_x?: number;
      tier_ladder?: Array<{ id: string; multiplier: number }>;
      external_pool_ref?: string;
    };

// ─── rng ───────────────────────────────────────────────────────────────
export interface Rng {
  kind: 'mulberry32' | 'pcg64' | 'xoshiro256pp' | 'aes_ctr_drbg';
  default_seed: number;
  jump_function?: string;
}

// ─── bet ───────────────────────────────────────────────────────────────
export interface Bet {
  currency: string;
  base_bet: number;
  denominations: number[];
  ante_bet?: { enabled: boolean; extra_multiplier: number };
  buy_feature?: Array<{ id: string; cost_x: number; guaranteed: string }>;
}

// ─── limits ────────────────────────────────────────────────────────────
export interface Limits {
  target_rtp: number;
  rtp_tolerance: number;
  max_win_x: number;
  win_cap_apply: 'per_spin' | 'per_feature_session';
  target_volatility: 'low' | 'medium' | 'high' | 'ultra';
  hit_freq_target: number;
}

// ─── compliance ────────────────────────────────────────────────────────
export interface Compliance {
  jurisdictions: string[];
  rtp_range_required: [number, number];
  max_win_cap_required: number;
  near_miss_rule: 'must_be_random' | 'allowed_within_distribution';
  ldw_disclosure: boolean;
  session_time_display: boolean;
}

// ─── rtp allocation ────────────────────────────────────────────────────
export interface RtpAllocation {
  base_game: number;
  free_spins: number;
  hold_and_win: number;
  jackpot: number;
  tolerance: number;
}

// ─── W4.7 progressive link (WAP / multi-tier) ──────────────────────────
export interface ProgressiveLink {
  /** External WAP pool. `undefined` ⇒ standalone linear progressive. */
  pool_id?: string;
  contribution_per_spin_x: number;
  seed_x: number;
  must_hit_by_x?: number;
  tier_ladder?: Array<{ id: string; multiplier: number }>;
  reset_rule?: string;
}

// ─── W4.7 jurisdiction overrides ───────────────────────────────────────
export interface JurisdictionOverride {
  target_rtp?: number;
  max_win_x?: number;
  min_spin_time_ms?: number;
  max_bet_x?: number;
  feature_toggles?: Record<string, boolean>;
  compensated_mode?: boolean;
  force_ldw_disclosure?: boolean;
  autoplay_forbidden?: boolean;
}

// ─── W4.7 persistent state ─────────────────────────────────────────────
export type PersistentFieldKind = 'counter' | 'accumulator' | 'multiplier' | 'boolean' | 'symbol';
export type PersistenceScope = 'spin' | 'session' | 'account';

export interface PersistentField {
  name: string;
  kind: PersistentFieldKind;
  default?: number;
  reset_rule: string;
  max_value?: number;
}

export interface StateTransition {
  from: string;
  to: string;
  condition: string;
}

export interface StateMachine {
  states: string[];
  initial_state: string;
  transitions: StateTransition[];
}

export interface PersistentState {
  fields: PersistentField[];
  state_machine?: StateMachine;
  scope: PersistenceScope;
}

// ─── W4.7 provenance ───────────────────────────────────────────────────
export interface Provenance {
  vendor: string;
  par_source: string;
  swid?: string;
  par_sha256: string;
  ir_sha256?: string;
  build_hash?: string;
  built_at_utc?: string;
  signed_by?: string;
  signature?: string;
}

// ─── root ──────────────────────────────────────────────────────────────
export interface SlotGameIR {
  schema_version: SchemaVersion;
  meta: Meta;
  topology: Topology;
  symbols: Symbol[];
  reels: ReelSet;
  evaluation: Evaluation;
  paytable: Paytable;
  features: Feature[];
  rng: Rng;
  bet: Bet;
  limits: Limits;
  compliance: Compliance;
  rtp_allocation: RtpAllocation;
  // ─── W4.7 expansion — all optional, additive only ─────────────────────
  /** WAP / linear progressive descriptor. */
  progressive_link?: ProgressiveLink;
  /** Per-jurisdiction overrides (UKGC, MGA, ADM, DGOJ, KSA, ...). */
  jurisdiction_overrides?: Record<string, JurisdictionOverride>;
  /** Cross-spin / cross-session persistent state. */
  persistent_state?: PersistentState;
  /** Reproducible-build provenance / cert audit trail. */
  provenance?: Provenance;
}
