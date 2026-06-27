/**
 * Slot Game IR — runtime validation via Zod.
 *
 * One source of truth — `types.ts` carries the static types, this file
 * mirrors them as runtime schemas so loading a JSON config from disk /
 * HTTP / config builder UI fails *loudly* on malformed input instead of
 * crashing the simulator deep inside the evaluator.
 *
 * The two files MUST stay in sync. The roundtrip test in
 * `tests/ir.test.ts` proves they do — a config that passes Zod also
 * type-checks against the TS interface (and vice versa for the curated
 * fixture set).
 *
 * Why Zod over `ajv`: Zod's `infer<>` gives us free reverse-mode parity
 * checks, and the codebase already pulls it (package.json line 17).
 */

import { z } from 'zod';

// ─── primitives ────────────────────────────────────────────────────────
const SchemaVersion = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'schema_version must be semver MAJOR.MINOR.PATCH');

const SymbolKey = z.string().min(1);

// ─── meta ──────────────────────────────────────────────────────────────
export const MetaZ = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: SchemaVersion,
    description: z.string().optional(),
    theme_tags: z.array(z.string()),
    author: z.string().optional(),
    created_at_utc: z.string().optional(),
  })
  .strict();

// ─── topology ──────────────────────────────────────────────────────────
export const TopologyZ = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('rectangular'),
      reels: z.number().int().min(1).max(20),
      rows: z.number().int().min(1).max(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal('variable_rows'),
      reels: z.number().int().min(1).max(20),
      row_range_per_reel: z.array(z.tuple([z.number().int().min(1), z.number().int().min(1)])),
      ways_cap: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cluster_grid'),
      columns: z.number().int().min(1).max(20),
      rows: z.number().int().min(1).max(20),
      adjacency: z.enum(['orthogonal', 'diagonal', 'hex']),
    })
    .strict(),
]);

// ─── symbols ───────────────────────────────────────────────────────────
export const SymbolKindZ = z.enum([
  'lp',
  'hp',
  'wild',
  'scatter',
  'bonus',
  'multiplier',
  'sticky',
  'expanding',
  'mystery',
  'transform',
  'chain_wild',
]);

// ─── W4.7 symbol behavior ─────────────────────────────────────────────
export const BehaviorTypeZ = z.enum([
  'expanding_full_reel',
  'walking',
  'transforming',
  'collecting',
  'mystery_reveal',
  'colossal',
  'sticky',
]);

export const SymbolBehaviorZ = z
  .object({
    colossal_size: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
    behavior_type: BehaviorTypeZ.optional(),
    transform_target: SymbolKey.optional(),
    collection_priority: z.number().int().optional(),
    sticky_duration_spins: z.number().int().positive().optional(),
  })
  .strict();

export const SymbolZ = z
  .object({
    id: SymbolKey,
    name: z.string().min(1),
    kind: SymbolKindZ,
    substitutes: z.union([z.array(SymbolKey), z.literal('*')]).optional(),
    weight_hint: z.number().nonnegative().optional(),
    appears_on: z.array(z.number().int().nonnegative()).optional(),
    behavior: SymbolBehaviorZ.optional(),
  })
  .strict();

// ─── reels ─────────────────────────────────────────────────────────────
const WeightedReelMap = z.record(SymbolKey, z.number().nonnegative());

export const ReelSetZ = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('weighted'),
      base: z.array(WeightedReelMap).min(1),
      free_spins: z.array(WeightedReelMap).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('strips'),
      base: z.array(z.array(SymbolKey).min(1)).min(1),
      free_spins: z.array(z.array(SymbolKey).min(1)).optional(),
    })
    .strict(),
]);

// ─── evaluation ────────────────────────────────────────────────────────
const DirectionZ = z.enum(['ltr', 'rtl', 'both']);

export const EvaluationZ = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('lines'),
      paylines: z.array(z.array(z.number().int().nonnegative()).min(2)).min(1),
      direction: DirectionZ,
      min_match: z.number().int().min(2).max(10),
      pay_left_to_right_only: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('ways'),
      direction: DirectionZ,
      min_match: z.number().int().min(2).max(10),
      max_ways_per_spin: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cluster'),
      min_cluster_size: z.number().int().min(3),
      cluster_pay_table: z.record(z.string(), z.number().nonnegative()),
    })
    .strict(),
  z
    .object({
      kind: z.literal('pay_anywhere'),
      min_count: z.number().int().min(2),
    })
    .strict(),
  z
    .object({
      kind: z.literal('pattern'),
      patterns: z
        .array(
          z
            .object({
              id: z.string().min(1),
              positions: z.union([
                z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])),
                z.literal('all'),
              ]),
              pay_multiplier: z.number().nonnegative(),
            })
            .strict()
        )
        .min(1),
    })
    .strict(),
]);

// ─── paytable ──────────────────────────────────────────────────────────
export const PaytableZ = z.record(SymbolKey, z.record(z.string(), z.number().nonnegative()));

// ─── features ──────────────────────────────────────────────────────────
const TriggerByCountZ = z
  .object({
    by: z.enum(['scatter_count', 'bonus_count', 'special_count']),
    thresholds: z.record(z.string(), z.number()).optional(),
    min: z.number().int().nonnegative().optional(),
  })
  .strict();

const FsModifierZ = z.enum(['sticky_wilds', 'expanding_wilds', 'multiplier_ladder', 'mystery_symbol']);

export const FeatureZ = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('free_spins'),
      trigger: TriggerByCountZ,
      retrigger: TriggerByCountZ.extend({ max_total: z.number().int().positive().optional() })
        .strict()
        .optional(),
      global_multiplier: z.number().nonnegative().optional(),
      modifiers: z.array(FsModifierZ).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('hold_and_win'),
      trigger: TriggerByCountZ,
      respins_initial: z.number().int().positive(),
      respin_reset_on_new: z.boolean(),
      cash_value_distribution: z
        .array(z.object({ value: z.number(), weight: z.number().nonnegative() }).strict())
        .min(1),
      jackpot_tiers: z
        .array(z.object({ id: z.string().min(1), multiplier: z.number().nonnegative() }).strict())
        .min(1),
      grid_full_award: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cascade'),
      replacement: z.enum(['drop', 'refill_random', 'fixed_strip']),
      max_chain: z.number().int().positive(),
      multiplier_progression: z.array(z.number().nonnegative()).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('respin'),
      cost_x: z.number().nonnegative(),
      max_uses_per_spin: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('pick'),
      prize_pool: z
        .array(
          z
            .object({
              id: z.string().min(1),
              weight: z.number().nonnegative(),
              pay_multiplier: z.number().nonnegative(),
            })
            .strict()
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('wheel'),
      segments: z
        .array(
          z
            .object({
              id: z.string().min(1),
              weight: z.number().nonnegative(),
              pay_multiplier: z.number().nonnegative(),
            })
            .strict()
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('buy_feature'),
      offers: z
        .array(
          z.object({ id: z.string().min(1), cost_x: z.number().positive(), guaranteed: z.string() }).strict()
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('ante_bet'),
      extra_multiplier: z.number().nonnegative(),
      enabled_by_default: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('gamble'),
      type: z.enum(['red_black', 'suit']),
      max_steps: z.number().int().positive(),
      tie_resolution: z.enum(['house', 'push']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('mystery_symbol'),
      symbol_id: SymbolKey,
      reveal_distribution: z.record(SymbolKey, z.number().nonnegative()),
    })
    .strict(),
  z
    .object({
      kind: z.literal('symbol_upgrade'),
      from: SymbolKey,
      to: SymbolKey,
      probability: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('linear_progressive'),
      pool_id: z.string().min(1),
      contribution_per_spin_x: z.number().nonnegative(),
      seed_x: z.number().nonnegative(),
      must_hit_by_x: z.number().nonnegative().optional(),
      tier_ladder: z
        .array(z.object({ id: z.string().min(1), multiplier: z.number().nonnegative() }).strict())
        .optional(),
      external_pool_ref: z.string().optional(),
    })
    .strict(),
]);

// ─── rng / bet / limits / compliance / rtp_allocation ──────────────────
export const RngZ = z
  .object({
    kind: z.enum(['mulberry32', 'pcg64', 'xoshiro256pp', 'aes_ctr_drbg']),
    default_seed: z.number().int().nonnegative(),
    jump_function: z.string().optional(),
  })
  .strict();

export const BetZ = z
  .object({
    currency: z.string().length(3),
    base_bet: z.number().positive(),
    denominations: z.array(z.number().positive()).min(1),
    ante_bet: z.object({ enabled: z.boolean(), extra_multiplier: z.number().nonnegative() }).strict().optional(),
    buy_feature: z
      .array(z.object({ id: z.string(), cost_x: z.number().positive(), guaranteed: z.string() }).strict())
      .optional(),
  })
  .strict();

export const LimitsZ = z
  .object({
    target_rtp: z.number().min(0.5).max(1.0),
    rtp_tolerance: z.number().nonnegative(),
    max_win_x: z.number().positive(),
    win_cap_apply: z.enum(['per_spin', 'per_feature_session']),
    target_volatility: z.enum(['low', 'medium', 'high', 'ultra']),
    hit_freq_target: z.number().min(0).max(1),
  })
  .strict();

export const ComplianceZ = z
  .object({
    jurisdictions: z.array(z.string()),
    rtp_range_required: z.tuple([z.number(), z.number()]),
    max_win_cap_required: z.number().positive(),
    near_miss_rule: z.enum(['must_be_random', 'allowed_within_distribution']),
    ldw_disclosure: z.boolean(),
    session_time_display: z.boolean(),
  })
  .strict();

export const RtpAllocationZ = z
  .object({
    base_game: z.number().min(0).max(1),
    free_spins: z.number().min(0).max(1),
    hold_and_win: z.number().min(0).max(1),
    jackpot: z.number().min(0).max(1),
    tolerance: z.number().nonnegative(),
  })
  .strict();

// ─── W4.7 progressive link ─────────────────────────────────────────────
export const ProgressiveLinkZ = z
  .object({
    pool_id: z.string().min(1).optional(),
    contribution_per_spin_x: z.number().nonnegative(),
    seed_x: z.number().nonnegative(),
    must_hit_by_x: z.number().nonnegative().optional(),
    tier_ladder: z
      .array(z.object({ id: z.string().min(1), multiplier: z.number().nonnegative() }).strict())
      .optional(),
    reset_rule: z.string().optional(),
  })
  .strict();

// ─── W4.7 jurisdiction overrides ───────────────────────────────────────
export const JurisdictionOverrideZ = z
  .object({
    target_rtp: z.number().min(0.5).max(1.0).optional(),
    max_win_x: z.number().positive().optional(),
    min_spin_time_ms: z.number().int().nonnegative().optional(),
    max_bet_x: z.number().positive().optional(),
    feature_toggles: z.record(z.string(), z.boolean()).optional(),
    compensated_mode: z.boolean().optional(),
    force_ldw_disclosure: z.boolean().optional(),
    autoplay_forbidden: z.boolean().optional(),
  })
  .strict();

// ─── W4.7 persistent state ─────────────────────────────────────────────
export const PersistentFieldKindZ = z.enum([
  'counter',
  'accumulator',
  'multiplier',
  'boolean',
  'symbol',
]);

export const PersistenceScopeZ = z.enum(['spin', 'session', 'account']);

export const PersistentFieldZ = z
  .object({
    name: z.string().min(1),
    kind: PersistentFieldKindZ,
    default: z.number().optional(),
    reset_rule: z.string().min(1),
    max_value: z.number().optional(),
  })
  .strict();

export const StateTransitionZ = z
  .object({ from: z.string().min(1), to: z.string().min(1), condition: z.string().min(1) })
  .strict();

export const StateMachineZ = z
  .object({
    states: z.array(z.string().min(1)).min(1),
    initial_state: z.string().min(1),
    transitions: z.array(StateTransitionZ),
  })
  .strict();

export const PersistentStateZ = z
  .object({
    fields: z.array(PersistentFieldZ).min(1),
    state_machine: StateMachineZ.optional(),
    scope: PersistenceScopeZ,
  })
  .strict();

// ─── W4.7 provenance ───────────────────────────────────────────────────
export const ProvenanceZ = z
  .object({
    vendor: z.string().min(1),
    par_source: z.string().min(1),
    swid: z.string().optional(),
    par_sha256: z.string().regex(/^[0-9a-f]{64}$/i, 'par_sha256 must be 64-hex SHA-256'),
    ir_sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'ir_sha256 must be 64-hex SHA-256')
      .optional(),
    build_hash: z.string().optional(),
    built_at_utc: z.string().optional(),
    signed_by: z.string().optional(),
    signature: z.string().optional(),
  })
  .strict();

// ─── root ──────────────────────────────────────────────────────────────
// PHASE 50 note: Zod 4 (`z.number()`) already rejects NaN/Infinity at
// the type level — verified in `tests/ir.test.ts` "non-finite number
// rejection" describe block. No extra root refinement needed; the
// regression tests pin the contract so an accidental Zod downgrade
// (back to 3.x where `z.number()` accepted NaN) fails the suite.
export const SlotGameIRZ = z
  .object({
    schema_version: SchemaVersion,
    meta: MetaZ,
    topology: TopologyZ,
    symbols: z.array(SymbolZ).min(2),
    reels: ReelSetZ,
    evaluation: EvaluationZ,
    paytable: PaytableZ,
    features: z.array(FeatureZ),
    rng: RngZ,
    bet: BetZ,
    limits: LimitsZ,
    compliance: ComplianceZ,
    rtp_allocation: RtpAllocationZ,
    // W4.7 expansion — additive optionals
    progressive_link: ProgressiveLinkZ.optional(),
    jurisdiction_overrides: z.record(z.string(), JurisdictionOverrideZ).optional(),
    persistent_state: PersistentStateZ.optional(),
    provenance: ProvenanceZ.optional(),
  })
  // unknown top-level keys are allowed and surfaced separately (see
  // index.ts::parseGameIR) — operators frequently add ops metadata.
  .passthrough();

// Pull the inferred Zod types so consumers can `import { SlotGameIRZType }
// from './schema.js'` without re-importing `types.ts`. The roundtrip
// test asserts these match the hand-written `SlotGameIR` interface.
export type SlotGameIRZType = z.infer<typeof SlotGameIRZ>;
