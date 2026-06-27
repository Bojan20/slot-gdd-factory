/**
 * Faza 3 — Symbol Behavior Plugin Layer: Core Types
 *
 * ## Architecture
 *
 * Every symbol in a slot game can carry arbitrary behavior: wilds substitute,
 * expanding wilds fill reels, mystery symbols transform, coins collect, etc.
 * Instead of scattering that logic across multiple evaluator files, Faza 3
 * introduces a **discriminated-union Effect pipeline**.
 *
 * The pipeline is:
 *   grid spawn → behavior.onLand() → effects applied → win eval →
 *   behavior.onWin() → effects applied → cascade/spin-end hooks
 *
 * ### Effect
 * A sealed discriminated union — every variant has a unique `kind` literal.
 * Consumers do `switch(effect.kind)` with `never`-typed exhaustive default.
 * No inheritance, no runtime dispatch, no reflection.
 *
 * ### SpinState
 * Mutable accumulator carried through the pipeline. One instance per spin.
 * The pipeline owns it; behaviors receive a `Readonly<SpinState>` snapshot
 * so they cannot mutate it directly — they return Effects instead.
 *
 * ### BehaviorContext
 * Injected into every behavior hook. Immutable by design — behaviors are
 * pure functions from context → effects[].
 *
 * ### SymbolBehavior
 * Interface all behavior implementations must satisfy. Hooks are optional
 * except `onLand` and `onWin` which are always called (returning [] is fine).
 */

// ─── Effect scope ──────────────────────────────────────────────────────────

/**
 * Scope defines the lifetime / reach of a multiplier effect.
 *
 * - `line`    — applies only to the current payline being evaluated
 * - `ways`    — applies to the current ways combination
 * - `spin`    — applies to the entire spin (all lines/ways/clusters)
 * - `session` — persists across multiple spins (e.g. FS ladder)
 */
export type EffectScope = 'line' | 'ways' | 'spin' | 'session';

// ─── Effect discriminated union ────────────────────────────────────────────

/**
 * Sealed discriminated union of all possible behavior effects.
 *
 * Adding a new variant here requires updating:
 *   1. `pipeline.ts` — `applyEffect` switch
 *   2. The corresponding behavior `impl`
 *   3. `rust-sim/src/behavior/types.rs`
 *   4. `tests/faza3_behaviors.test.ts`
 */
export type Effect =
  /** No-op — returned by behaviors that conditionally do nothing. */
  | { kind: 'noop' }
  /**
   * Additively adjusts a multiplier accumulator.
   * e.g. a "×2 Multiplier Wild" on a line adds 1 → total becomes ×2.
   */
  | { kind: 'multiplier_add'; value: number; scope: EffectScope }
  /**
   * Multiplicatively adjusts a multiplier accumulator.
   * e.g. two "×2 Multiplier Wilds" each emit multiplier_mul(2) → ×4 total.
   */
  | { kind: 'multiplier_mul'; value: number; scope: EffectScope }
  /**
   * Transforms the symbol at [reel, row] into `toSymbol` before win eval.
   * Used by mystery/transform symbols.
   */
  | { kind: 'transform_symbol'; reel: number; row: number; toSymbol: string }
  /**
   * Expands a wild symbol to fill all rows on `reel`.
   * Emitted by ExpandingWildBehavior.
   */
  | { kind: 'expand_wild'; reel: number; symbol: string }
  /**
   * Locks the position [reel, row] for `remainingSpins` more spins.
   * Emitted by StickyWildBehavior.
   */
  | { kind: 'lock_position'; reel: number; row: number; remainingSpins: number }
  /**
   * Injects a wild symbol at [reel, row].
   * Emitted by WalkingWildBehavior (positions the wild on next spin).
   */
  | { kind: 'add_wild'; reel: number; row: number; symbol: string }
  /**
   * Records a coin collected at [reel, row] with a cash value.
   * Emitted by CoinBehavior during Hold & Win.
   */
  | { kind: 'collect_coin'; reel: number; row: number; amount: number }
  /**
   * Requests that a named feature be activated.
   * ScatterBehavior uses this to trigger free spins; CoinBehavior for HnW.
   */
  | { kind: 'trigger_feature'; featureId: string }
  /**
   * Awards a jackpot tier immediately.
   * Emitted by JackpotBehavior.
   */
  | { kind: 'award_jackpot'; tier: string; amount: number }
  /**
   * Upgrades all instances of `fromSymbol` on the grid to `toSymbol`.
   * Used by UpgradeSymbolBehavior and chain-wild cascades.
   */
  | { kind: 'upgrade_symbols'; fromSymbol: string; toSymbol: string }
  /**
   * Awards a scatter-style pay independent of paylines.
   * `multiplier` is applied to the base bet.
   */
  | { kind: 'scatter_pay'; count: number; multiplier: number }
  /**
   * Awards N additional respins.
   * Emitted by CoinBehavior when a new coin lands during HnW respin.
   */
  | { kind: 'respin'; count: number };

// ─── SpinState ─────────────────────────────────────────────────────────────

/** A locked grid position that will persist for `remainingSpins` more spins. */
export interface LockedPosition {
  reel: number;
  row: number;
  symbol: string;
  remainingSpins: number;
}

/** A collected coin during Hold & Win. */
export interface CollectedCoin {
  reel: number;
  row: number;
  amount: number;
}

/**
 * Mutable state accumulator for one spin (or one feature session).
 *
 * Owned by the pipeline. Behaviors receive `Readonly<SpinState>` snapshots
 * via `BehaviorContext`. The pipeline applies effects and mutates this.
 */
export interface SpinState {
  /** Current symbol grid — mutable, effects can transform cells. */
  grid: string[][];
  reels: number;
  rows: number;

  /** Multiplicative accumulators, per scope. Start at 1.0. */
  lineMultiplier: number;
  spinMultiplier: number;
  sessionMultiplier: number;

  /** Positions locked by StickyWild / lock_position effects. */
  lockedPositions: LockedPosition[];

  /** Coins accumulated during Hold & Win. */
  collectedCoins: CollectedCoin[];

  /** Feature IDs queued for activation this spin. */
  triggeredFeatures: Set<string>;

  /** Jackpot awarded (only one per spin; subsequent awards are ignored). */
  jackpotAwarded?: { tier: string; amount: number };

  /** Extra scatter-pay payout accumulated (multiplier × bet). */
  scatterPayout: number;

  /** Extra respin count awarded by respin effects. */
  respinsAwarded: number;

  /** Symbols that were upgraded (for audit/display). */
  upgrades: Array<{ fromSymbol: string; toSymbol: string }>;
}

/**
 * Create a blank SpinState for `reels × rows` grid.
 */
export function createSpinState(grid: string[][]): SpinState {
  const reels = grid.length;
  const rows = grid[0]?.length ?? 0;
  return {
    grid: grid.map(col => [...col]),
    reels,
    rows,
    lineMultiplier: 1,
    spinMultiplier: 1,
    sessionMultiplier: 1,
    lockedPositions: [],
    collectedCoins: [],
    triggeredFeatures: new Set(),
    jackpotAwarded: undefined,
    scatterPayout: 0,
    respinsAwarded: 0,
    upgrades: [],
  };
}

// ─── BehaviorContext ────────────────────────────────────────────────────────

/**
 * Arbitrary key-value config bag passed to behaviors at construction time.
 * Each implementation declares the keys it expects.
 */
export type SymbolBehaviorConfig = Record<string, unknown>;

/**
 * Immutable context injected into every behavior hook.
 *
 * Behaviors are pure: (context) → Effect[].
 * They MUST NOT mutate `state` — return Effects instead.
 */
export interface BehaviorContext {
  /** The symbol id that triggered this hook. */
  readonly symbolId: string;
  /** Reel index (0-based, left to right). */
  readonly reel: number;
  /** Row index (0-based, top to bottom). */
  readonly row: number;
  /** Current spin state snapshot (read-only). */
  readonly state: Readonly<SpinState>;
  /** Config blob provided at behavior construction. */
  readonly config: SymbolBehaviorConfig;
  /** All symbols currently on the grid (convenience alias for state.grid). */
  readonly grid: readonly (readonly string[])[];
}

// ─── SymbolBehavior interface ──────────────────────────────────────────────

/**
 * Plugin interface every behavior implementation must satisfy.
 *
 * ## Lifecycle hooks
 *
 * | Hook             | When called                                                |
 * |------------------|------------------------------------------------------------|
 * | `onLand`         | After each reel spin, for every visible instance          |
 * | `onWin`          | After win evaluation, for every symbol part of a win      |
 * | `onCascadeRemove`| When symbol is removed during a cascade                   |
 * | `onFeatureStart` | At the start of a feature session (FS, HnW, etc.)         |
 * | `onSpinEnd`      | After all wins are evaluated and effects applied           |
 *
 * All hooks return `Effect[]`. An empty array means "no side effects".
 */
export interface SymbolBehavior {
  /** Unique identifier — matches the symbol `id` in the IR. */
  readonly id: string;
  /** Behavior class name — used for logging and serialization. */
  readonly kind: string;

  /**
   * Called every time this symbol appears on the grid (after spin).
   * Primary hook for scatter counters, mystery reveals, coin collection.
   */
  onLand(ctx: BehaviorContext): Effect[];

  /**
   * Called when this symbol is part of a winning combination.
   * Primary hook for multiplier wilds, jackpot symbols.
   */
  onWin(ctx: BehaviorContext): Effect[];

  /**
   * Called when symbol is removed during a cascade / avalanche.
   * Optional — defaults to returning [] if not implemented.
   */
  onCascadeRemove?(ctx: BehaviorContext): Effect[];

  /**
   * Called at the start of a feature session (FS, HnW, etc.).
   * Optional — allows behavior to initialize per-session state.
   */
  onFeatureStart?(ctx: BehaviorContext): Effect[];

  /**
   * Called after all wins are evaluated and effects applied for a spin.
   * Optional — used by walking wilds to advance position.
   */
  onSpinEnd?(ctx: BehaviorContext): Effect[];
}

// ─── Effect type guards ────────────────────────────────────────────────────

export function isMultiplierEffect(e: Effect): e is Extract<Effect, { kind: 'multiplier_add' | 'multiplier_mul' }> {
  return e.kind === 'multiplier_add' || e.kind === 'multiplier_mul';
}

export function isTransformEffect(e: Effect): e is Extract<Effect, { kind: 'transform_symbol' | 'upgrade_symbols' }> {
  return e.kind === 'transform_symbol' || e.kind === 'upgrade_symbols';
}

export function isFeatureTrigger(e: Effect): e is Extract<Effect, { kind: 'trigger_feature' }> {
  return e.kind === 'trigger_feature';
}
