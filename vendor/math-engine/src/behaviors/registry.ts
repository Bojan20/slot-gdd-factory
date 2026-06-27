/**
 * Faza 3 — Symbol Behavior Plugin Layer: Registry
 *
 * Central registry that maps symbol-ids (IR `Symbol.id` values) to
 * `SymbolBehavior` instances. The registry is the single source of truth
 * for which behavior runs when a symbol appears.
 *
 * ## Design
 *
 * - Immutable after `build()` — prevents late registration surprises.
 * - Factory pattern: `BehaviorRegistry.builder()` returns a fluent builder.
 * - Built-in behaviors registered via `registerDefaults(ir)`.
 * - Custom behaviors registered via `register(symbolId, behavior)`.
 * - Lookup is O(1) (Map).
 *
 * ## Integration
 *
 * irEvaluator calls `BehaviorRegistry.forIR(ir)` to get a ready-made
 * registry. All symbol kinds present in the IR are auto-registered.
 */

import type { SlotGameIR, Symbol as IRSymbol } from '../ir/types.js';
import type { SymbolBehavior, SymbolBehaviorConfig } from './types.js';
import { WildBehavior } from './impls/WildBehavior.js';
import { ExpandingWildBehavior } from './impls/ExpandingWildBehavior.js';
import { StickyWildBehavior } from './impls/StickyWildBehavior.js';
import { WalkingWildBehavior } from './impls/WalkingWildBehavior.js';
import { MultiplierWildBehavior } from './impls/MultiplierWildBehavior.js';
import { ScatterBehavior } from './impls/ScatterBehavior.js';
import { MysteryBehavior } from './impls/MysteryBehavior.js';
import { CoinBehavior } from './impls/CoinBehavior.js';
import { MultiplierSymbolBehavior } from './impls/MultiplierSymbolBehavior.js';
import { TransformBehavior } from './impls/TransformBehavior.js';
import { JackpotBehavior } from './impls/JackpotBehavior.js';
import { WanderingWildBehavior } from './impls/WanderingWildBehavior.js';
import { WildReelBehavior } from './impls/WildReelBehavior.js';
import { CollectBehavior } from './impls/CollectBehavior.js';
import { UpgradeBehavior } from './impls/UpgradeBehavior.js';
import { SplitBehavior } from './impls/SplitBehavior.js';
import { MegaSymbolBehavior } from './impls/MegaSymbolBehavior.js';
import { PrizeBehavior } from './impls/PrizeBehavior.js';

// ─── Registry (immutable after build) ─────────────────────────────────────

/**
 * Frozen registry: symbol-id → SymbolBehavior.
 *
 * Use `BehaviorRegistryBuilder` to construct; do not instantiate directly.
 */
export class BehaviorRegistry {
  private readonly _map: ReadonlyMap<string, SymbolBehavior>;

  constructor(map: Map<string, SymbolBehavior>) {
    this._map = new Map(map); // defensive copy
  }

  /** Look up the behavior for `symbolId`. Returns undefined if not registered. */
  get(symbolId: string): SymbolBehavior | undefined {
    return this._map.get(symbolId);
  }

  /** Check whether a behavior is registered for `symbolId`. */
  has(symbolId: string): boolean {
    return this._map.has(symbolId);
  }

  /** All registered symbol ids. */
  get symbolIds(): IterableIterator<string> {
    return this._map.keys();
  }

  /** All registered behaviors. */
  get behaviors(): IterableIterator<SymbolBehavior> {
    return this._map.values();
  }

  /** Total number of registered behaviors. */
  get size(): number {
    return this._map.size;
  }

  /** Returns the underlying Map for BehaviorPipeline. */
  toMap(): Map<string, SymbolBehavior> {
    return new Map(this._map);
  }

  // ─── Builder factory ────────────────────────────────────────────────────

  /** Start building a registry. */
  static builder(): BehaviorRegistryBuilder {
    return new BehaviorRegistryBuilder();
  }

  /**
   * Build a registry auto-populated from a SlotGameIR.
   * Behavior config can be supplied per-symbol via `configOverrides`.
   *
   * Any symbol not matched by a known kind gets no behavior registered
   * (lp / hp — they only produce pay by being matched, no hooks needed).
   */
  static forIR(
    ir: SlotGameIR,
    configOverrides: Record<string, SymbolBehaviorConfig> = {}
  ): BehaviorRegistry {
    const builder = BehaviorRegistry.builder();

    for (const sym of ir.symbols) {
      const cfg = configOverrides[sym.id] ?? {};
      const behavior = _behaviorForSymbol(sym, ir, cfg);
      if (behavior) {
        builder.register(sym.id, behavior);
      }
    }

    return builder.build();
  }
}

// ─── Builder ───────────────────────────────────────────────────────────────

export class BehaviorRegistryBuilder {
  private _map = new Map<string, SymbolBehavior>();

  /**
   * Register a behavior for `symbolId`.
   * Throws if a behavior is already registered for this id.
   */
  register(symbolId: string, behavior: SymbolBehavior): this {
    if (this._map.has(symbolId)) {
      throw new Error(
        `BehaviorRegistry: duplicate registration for symbolId "${symbolId}". ` +
        `Use override() to replace existing behaviors.`
      );
    }
    this._map.set(symbolId, behavior);
    return this;
  }

  /**
   * Override (or add) a behavior for `symbolId`.
   * Silently replaces any existing registration.
   */
  override(symbolId: string, behavior: SymbolBehavior): this {
    this._map.set(symbolId, behavior);
    return this;
  }

  /**
   * Remove a behavior registration.
   */
  unregister(symbolId: string): this {
    this._map.delete(symbolId);
    return this;
  }

  /** Freeze and return the registry. */
  build(): BehaviorRegistry {
    return new BehaviorRegistry(this._map);
  }
}

// ─── Auto-registration logic ───────────────────────────────────────────────

/**
 * Given an IR Symbol, construct the appropriate SymbolBehavior.
 * Returns `undefined` for symbol kinds that don't need behavior hooks
 * (plain lp / hp symbols).
 */
function _behaviorForSymbol(
  sym: IRSymbol,
  ir: SlotGameIR,
  cfg: SymbolBehaviorConfig
): SymbolBehavior | undefined {
  // Allow caller to force a specific behavior class via cfg.behaviorClass
  const forceClass = cfg.behaviorClass as string | undefined;

  switch (forceClass ?? sym.kind) {
    case 'wild':
      return new WildBehavior(sym.id, cfg);

    case 'expanding':
      return new ExpandingWildBehavior(sym.id, {
        rows: _reels(ir),  // expand fills all rows on the reel
        ...cfg,
      });

    case 'sticky':
      return new StickyWildBehavior(sym.id, {
        duration: 3,
        ...cfg,
      });

    case 'chain_wild':
      // chain_wild = walking wild by default; configurable via cfg.direction
      return new WalkingWildBehavior(sym.id, {
        direction: 'left',
        disappearsOnEdge: true,
        reels: _reelCount(ir),
        rows: _rowCount(ir),
        ...cfg,
      });

    case 'multiplier': {
      // If weight_hint encodes the multiplier, use it; otherwise default 2×.
      const value = (cfg.value as number) ?? sym.weight_hint ?? 2;
      return new MultiplierWildBehavior(sym.id, { value, scope: 'line', ...cfg });
    }

    case 'scatter': {
      // Look up free_spins feature trigger thresholds from the IR.
      const fsTriggerCount = _scatterTriggerMin(ir);
      return new ScatterBehavior(sym.id, {
        featureId: 'free_spins',
        triggerCount: fsTriggerCount,
        ...cfg,
      });
    }

    case 'bonus':
      return new CoinBehavior(sym.id, {
        featureId: 'hold_and_win',
        triggerCount: _bonusTriggerMin(ir),
        defaultAmount: 1,
        ...cfg,
      });

    case 'mystery': {
      // Build reveal distribution from IR feature definition if present.
      const revealDist = _mysteryRevealDist(ir, sym.id);
      return new MysteryBehavior(sym.id, {
        revealDistribution: revealDist,
        ...cfg,
      });
    }

    case 'transform':
      return new TransformBehavior(sym.id, cfg);

    // ─── Faza 3.2 — extra behaviors (P0 #9) ─────────────────────────────
    // These are not native IR `kind` values; they're reachable only via
    // `configOverrides[symId].behaviorClass = "..."`. That keeps the IR
    // schema small while still allowing operators to wire any plugin.
    case 'wandering_wild':
      return new WanderingWildBehavior(sym.id, {
        reels: _reelCount(ir),
        rows: _rowCount(ir),
        ...cfg,
      });

    case 'wild_reel':
      return new WildReelBehavior(sym.id, cfg);

    case 'collect':
      return new CollectBehavior(sym.id, cfg);

    case 'upgrade':
      return new UpgradeBehavior(sym.id, cfg);

    case 'split':
      return new SplitBehavior(sym.id, cfg);

    case 'mega':
      return new MegaSymbolBehavior(sym.id, cfg);

    case 'prize':
      return new PrizeBehavior(sym.id, cfg);

    case 'hp':
    case 'lp':
    default:
      // Plain pay symbols — no behavior hooks needed.
      return undefined;
  }
}

// ─── IR extraction helpers ─────────────────────────────────────────────────

function _reelCount(ir: SlotGameIR): number {
  const topo = ir.topology;
  if (topo.kind === 'rectangular') return topo.reels;
  if (topo.kind === 'variable_rows') return topo.reels;
  if (topo.kind === 'cluster_grid') return topo.columns;
  return 5;
}

function _rowCount(ir: SlotGameIR): number {
  const topo = ir.topology;
  if (topo.kind === 'rectangular') return topo.rows;
  if (topo.kind === 'cluster_grid') return topo.rows;
  return 3;
}

function _reels(ir: SlotGameIR): number {
  return _reelCount(ir);
}

function _scatterTriggerMin(ir: SlotGameIR): number {
  for (const f of ir.features) {
    if (f.kind === 'free_spins' && f.trigger.by === 'scatter_count') {
      return f.trigger.min ?? 3;
    }
  }
  return 3;
}

function _bonusTriggerMin(ir: SlotGameIR): number {
  for (const f of ir.features) {
    if (f.kind === 'hold_and_win' && f.trigger.by === 'bonus_count') {
      return f.trigger.min ?? 6;
    }
  }
  return 6;
}

function _mysteryRevealDist(ir: SlotGameIR, symId: string): Record<string, number> {
  for (const f of ir.features) {
    if (f.kind === 'mystery_symbol' && f.symbol_id === symId) {
      return f.reveal_distribution;
    }
  }
  // Default: uniform across hp symbols
  const hpSyms = ir.symbols.filter(s => s.kind === 'hp').map(s => s.id);
  const dist: Record<string, number> = {};
  for (const id of hpSyms) dist[id] = 1;
  return dist;
}
