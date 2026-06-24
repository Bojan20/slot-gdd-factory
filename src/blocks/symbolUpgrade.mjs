/**
 * src/blocks/symbolUpgrade.mjs
 *
 * Wave B64 (Faza 3 · Pre-Math Roadmap) — Symbol Upgrade / Transmute block.
 *
 * ─── Purpose ──────────────────────────────────────────────────────────
 * During a tumble (cascade) chain, every refilled cell has a configurable
 * chance to be promoted to the next-higher symbol tier. Visualised as a
 * brief flash + morph swap on the refilled cell, plus a per-tumble
 * aggregate signal so downstream UI can build counters / streak meters.
 *
 * The block is pure presentation/QA: it never alters the audit-grade win
 * evaluator path (winPresentation already ran). It mutates DOM textContent
 * AFTER detect-win + flash + remove + gravity + refill and BEFORE the
 * NEXT settle-loop pass — i.e. on the `onTumbleStep` boundary. This lets
 * the upgraded symbol participate in the subsequent settle pass naturally.
 *
 * ─── Industry reference (vendor-neutral synthesis) ────────────────────
 *   • Cascade-with-transmute family — refilled symbols can level-up from
 *     low → mid → high → premium under a per-cell roll.
 *   • Audit-grade contract — upgrade probability + ladder are GDD knobs
 *     (regulator-disclosable). Code reads the tiers from SYMBOL_REGISTRY
 *     at runtime; the ladder is derived deterministically when no
 *     explicit ladder is configured.
 *   • Non-reel shapes (wheel / plinko / crash / slingo / hex / radial)
 *     own their own settle path and do NOT receive onTumbleStep events;
 *     this block auto-disables for those shapes (defence-in-depth).
 *
 * ─── Lifecycle (HookBus contract) ─────────────────────────────────────
 *   preSpin       → flush pending upgrade timers + stats counter
 *   onTumbleStep  → walk refilled cells, roll per-cell upgrade,
 *                   swap textContent + flash class + emit events
 *   postSpin      → finalise round counter, no DOM writes
 *   onFsEnd       → reset bonus-aggregate stats
 *
 * ─── GDD config (consumed from `model.symbolUpgrade`) ─────────────────
 *   enabled         boolean (default false; auto-on when feature kind
 *                   matches /^symbol[_-]?upgrade$|^transmute$|^evolve$/i)
 *   probability     number in [0, 1] (default 0.06)
 *                   per-cell upgrade roll
 *   maxPerTumble    integer ≥ 1 (default 2)
 *                   safety cap so a single tumble step cannot upgrade
 *                   the whole grid at once
 *   eligibleTiers   string[] subset of {'low','mid','high'} (default
 *                   ['low','mid']) — special / wild / scatter / orb never
 *                   participate
 *   ladder          [{from:'A', to:'B'}, ...] (default: auto-derived
 *                   from SYMBOL_REGISTRY low→mid, mid→high pairings)
 *   flashColor      "r,g,b" rgb triplet (default '255,210,90')
 *   flashMs         integer ms [120, 2000] (default 480)
 *   morphMs         integer ms [80, 1200] (default 220) — duration of
 *                   the text-swap transition (opacity dip + scale pulse)
 *   bonusAccumulate boolean (default true) — count upgrades during FS
 *                   in a running aggregate (window.__SYMBOL_UPGRADE_FS__)
 *
 * ─── Public API (server-side, ES module) ──────────────────────────────
 *   defaultConfig()                → safe defaults
 *   resolveConfig(model)           → merge defaults with GDD override
 *   emitSymbolUpgradeCSS(cfg)      → flash + morph keyframes
 *   emitSymbolUpgradeMarkup(cfg)   → '' (operates on existing .cell DOM)
 *   emitSymbolUpgradeRuntime(cfg)  → runtime JS string
 *
 * ─── Runtime contract (after emitted JS executes) ─────────────────────
 *   window.__SYMBOL_UPGRADE_ENABLED__        boolean
 *   window.__SYMBOL_UPGRADE_BASE_STATS__     { count, lastTumble }
 *   window.__SYMBOL_UPGRADE_FS__             { count }
 *   window.symbolUpgradeForceAt(col, row)    test/QA hook — force one
 *                                            upgrade at a coord
 *
 *   HookBus events (this block owns):
 *     onSymbolUpgrade        { col, row, fromSymbol, toSymbol,
 *                              fromTier, toTier, durationMs }
 *     onSymbolUpgradeCascade { count, tumbleIndex, inFreeSpins }
 *
 * ─── Composition contract ─────────────────────────────────────────────
 *   • tumble.mjs owns the gravity + refill DOM mutations and emits
 *     onTumbleStep AFTER refill completes. This block hooks the same
 *     event and decorates the newly-placed symbols.
 *   • multiplierOrb.mjs marks `cell--orb` cells; this block excludes any
 *     cell with `cell--orb`, `cell--wild`, `cell--scatter` to keep
 *     special symbols outside the upgrade pool.
 *   • symbolInfoPopover.mjs reads the textContent on tap; the swap is a
 *     real textContent rewrite so the popover always reflects the new
 *     symbol identity.
 *
 * ─── Performance budget ───────────────────────────────────────────────
 *   • Per onTumbleStep: O(cells) iteration, ≤ maxPerTumble DOM writes.
 *   • No setTimeout chains > flashMs + morphMs.
 *   • CSS animations bound by prefers-reduced-motion.
 *
 * ─── Accessibility ────────────────────────────────────────────────────
 *   • prefers-reduced-motion → flash + morph collapse to instant swap.
 *   • aria-live region (existing winRollup) reads totals; upgrades do not
 *     need their own live region (cell text is the source of truth).
 *
 * ─── Boki rules honoured ──────────────────────────────────────────────
 *   • Senior-grade JSDoc kontrakt header (rule_senior_grade_code).
 *   • Vendor-neutral (rule_no_vendor_mentions): no game / studio strings.
 *   • LEGO block, single concern (rule_slot_gdd_lego_blocks).
 *   • Force / dev hook (`symbolUpgradeForceAt`) goes through the same
 *     animation path as a real roll (rule_force_buttons_real_spin).
 *   • Idempotent listeners + lifecycle ownership.
 */

const TIER_INDEX = Object.freeze({ low: 0, mid: 1, high: 2 });

const DEFAULTS = Object.freeze({
  enabled: false,
  probability: 0.06,
  maxPerTumble: 2,
  eligibleTiers: ['low', 'mid'],
  ladder: null, // null → auto-derive from SYMBOL_REGISTRY at runtime
  flashColor: '255,210,90',
  flashMs: 480,
  morphMs: 220,
  bonusAccumulate: true,
});

/** Tumble-incompatible shapes mirror the list owned by tumble.mjs.
 *  Mechanically these shapes never emit `onTumbleStep`, but defence-in-
 *  depth prevents the runtime stub from ever leaking listeners there. */
const TUMBLE_INCOMPATIBLE_SHAPES = Object.freeze(new Set([
  'lock_respin', 'wheel', 'plinko', 'crash', 'slingo', 'radial',
  'hex', 'hexagonal', 'diamond', 'pyramid', 'cross', 'l_shape',
]));

export function defaultConfig() {
  return Object.freeze({
    ...DEFAULTS,
    eligibleTiers: [...DEFAULTS.eligibleTiers],
  });
}

function _clampInt(n, lo, hi, fallback) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return fallback;
  /* Out-of-range values fall back to the safe default rather than being
     silently clamped to the boundary. A GDD that asks for `flashMs: 50`
     almost certainly means "I forgot the units" — clamping to 120 ms
     would burn surprise budget; the default 480 ms is the predictable
     behaviour the senior-grade rule expects (defence-in-depth on input). */
  if (v < lo || v > hi) return fallback;
  return v;
}

function _clampUnit(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function _isRGBTriplet(s) {
  if (typeof s !== 'string') return false;
  const m = s.match(/^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/);
  if (!m) return false;
  for (let i = 1; i <= 3; i++) {
    const v = Number(m[i]);
    if (v < 0 || v > 255) return false;
  }
  return true;
}

function _sanitizeLadder(ladder) {
  if (!Array.isArray(ladder)) return null;
  const seen = new Set();
  const out = [];
  for (const pair of ladder) {
    if (!pair || typeof pair !== 'object') continue;
    const from = String(pair.from || '').trim();
    const to   = String(pair.to   || '').trim();
    if (!/^[A-Za-z0-9_-]{1,8}$/.test(from)) continue;
    if (!/^[A-Za-z0-9_-]{1,8}$/.test(to))   continue;
    if (from === to) continue;
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
    if (out.length >= 32) break; // hard cap so a hostile GDD can't blow up
  }
  return out.length > 0 ? out : null;
}

function _sanitizeEligibleTiers(tiers) {
  if (!Array.isArray(tiers)) return null;
  const filtered = [];
  for (const t of tiers) {
    if (typeof t === 'string' && TIER_INDEX[t] != null && !filtered.includes(t)) {
      filtered.push(t);
    }
  }
  return filtered.length > 0 ? filtered : null;
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.symbolUpgrade) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  if (m.probability != null)   cfg.probability   = _clampUnit(m.probability, DEFAULTS.probability);
  if (m.maxPerTumble != null)  cfg.maxPerTumble  = _clampInt(m.maxPerTumble, 1, 64, DEFAULTS.maxPerTumble);
  if (m.flashMs != null)       cfg.flashMs       = _clampInt(m.flashMs, 120, 2000, DEFAULTS.flashMs);
  if (m.morphMs != null)       cfg.morphMs       = _clampInt(m.morphMs, 80,  1200, DEFAULTS.morphMs);
  if (m.bonusAccumulate != null) cfg.bonusAccumulate = !!m.bonusAccumulate;

  if (_isRGBTriplet(m.flashColor)) {
    cfg.flashColor = m.flashColor.replace(/\s+/g, '');
  }

  const tiers = _sanitizeEligibleTiers(m.eligibleTiers);
  if (tiers) cfg.eligibleTiers = tiers;

  const ladder = _sanitizeLadder(m.ladder);
  if (ladder) cfg.ladder = ladder;

  /* Auto-enable when GDD declares an upgrade/transmute/evolve feature kind. */
  if (Array.isArray(model.features)) {
    const KIND_RX = /^(symbol[_-]?upgrade|transmute|evolve|level[_-]?up[_-]?symbol)$/i;
    if (model.features.some(f => f && typeof f.kind === 'string' && KIND_RX.test(f.kind))) {
      cfg.enabled = true;
    }
  }

  /* Defence-in-depth: hard-disable on tumble-incompatible shapes. */
  const shapeKind = (model.shape && model.shape.kind) ||
                    (model.topology && model.topology.kind) ||
                    null;
  if (shapeKind && TUMBLE_INCOMPATIBLE_SHAPES.has(shapeKind)) {
    cfg.enabled = false;
  }

  return cfg;
}

export function emitSymbolUpgradeCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ symbolUpgrade: cfg });
  if (!c.enabled) {
    return '\n/* symbolUpgrade BLOCK (disabled by GDD) — no CSS emitted */\n';
  }
  return `
/* ── symbolUpgrade BLOCK — emitted by src/blocks/symbolUpgrade.mjs
   GDD knobs (baked at build time):
     probability    = ${c.probability}
     maxPerTumble   = ${c.maxPerTumble}
     eligibleTiers  = ${c.eligibleTiers.join('+')}
     flashColor     = ${c.flashColor}
     flashMs        = ${c.flashMs}
     morphMs        = ${c.morphMs}
*/
@keyframes symbolUpgradeFlash {
  0%   { box-shadow: 0 0 0 0 rgba(${c.flashColor}, 0.0);
         filter: brightness(1); }
  35%  { box-shadow: 0 0 18px 4px rgba(${c.flashColor}, 0.85);
         filter: brightness(1.55) saturate(1.2); }
  100% { box-shadow: 0 0 0 0 rgba(${c.flashColor}, 0.0);
         filter: brightness(1); }
}
@keyframes symbolUpgradeMorph {
  0%   { transform: scale(1);     opacity: 1; }
  45%  { transform: scale(0.78);  opacity: 0.35; }
  60%  { transform: scale(1.18);  opacity: 0.85; }
  100% { transform: scale(1);     opacity: 1; }
}
.cell.is-upgrading {
  animation: symbolUpgradeFlash ${c.flashMs}ms ease-in-out forwards;
  z-index: 4;
  position: relative;
}
.cell.is-upgrading > * {
  animation: symbolUpgradeMorph ${c.morphMs}ms cubic-bezier(.4,1.4,.6,1) forwards;
  display: inline-block;
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-upgrading,
  .cell.is-upgrading > * { animation: none; }
}
`;
}

export function emitSymbolUpgradeMarkup(/* cfg */) {
  /* No markup — the block decorates existing .cell elements owned by
     gridRenderer / reelEngine. */
  return '';
}

export function emitSymbolUpgradeRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ symbolUpgrade: cfg });
  if (!c.enabled) {
    return `
  /* ── symbolUpgrade BLOCK (disabled by GDD) — no runtime ────────────── */
  if (typeof window !== 'undefined') {
    window.__SYMBOL_UPGRADE_ENABLED__ = false;
    window.symbolUpgradeForceAt = function () { return false; };
  }
`;
  }
  const LADDER_LITERAL = c.ladder ? JSON.stringify(c.ladder) : 'null';
  const ELIGIBLE_LITERAL = JSON.stringify(c.eligibleTiers);
  return `
  /* ── symbolUpgrade BLOCK — emitted by src/blocks/symbolUpgrade.mjs
     probability=${c.probability} · maxPerTumble=${c.maxPerTumble}
     eligibleTiers=${c.eligibleTiers.join('+')} · flashMs=${c.flashMs}
     Owns: onSymbolUpgrade · onSymbolUpgradeCascade
     Listens: preSpin · onTumbleStep · postSpin · onFsEnd */
  const SYMBOL_UPGRADE_PROBABILITY  = ${c.probability};
  const SYMBOL_UPGRADE_MAX_PER_TUMBLE = ${c.maxPerTumble};
  const SYMBOL_UPGRADE_ELIGIBLE     = ${ELIGIBLE_LITERAL};
  const SYMBOL_UPGRADE_LADDER_GDD   = ${LADDER_LITERAL};
  const SYMBOL_UPGRADE_FLASH_MS     = ${c.flashMs};
  const SYMBOL_UPGRADE_MORPH_MS     = ${c.morphMs};
  const SYMBOL_UPGRADE_BONUS_ACC    = ${c.bonusAccumulate};
  const SYMBOL_UPGRADE_TIER_INDEX   = { low: 0, mid: 1, high: 2 };
  const SWAP_MORPH_FRACTION = 0.4;
  const FRAME_BUDGET_MS     = 16;
  const PRIORITY_NORMAL     = 5;
  const REDUCED_MOTION = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Stats objects must be mutated in place — never reassigned — so the
     window.__SYMBOL_UPGRADE_BASE_STATS__ / __SYMBOL_UPGRADE_FS__ pointers
     published below remain live across spins. */
  const _symbolUpgradeStats = { count: 0, lastTumble: -1 };
  const _symbolUpgradeFsStats = { count: 0 };
  let _symbolUpgradeTumbleIndex = 0;

  function _suTierOf(symbol) {
    if (typeof SYMBOL_REGISTRY === 'undefined' || !SYMBOL_REGISTRY) return null;
    for (const tier of ['low', 'mid', 'high', 'specials']) {
      const list = Array.isArray(SYMBOL_REGISTRY[tier]) ? SYMBOL_REGISTRY[tier] : [];
      if (list.some(s => (s.glyph || s.code || s) === symbol)) {
        return tier === 'specials' ? 'special' : tier;
      }
    }
    return null;
  }

  function _suSymbolsAt(tier) {
    if (typeof SYMBOL_REGISTRY === 'undefined' || !SYMBOL_REGISTRY) return [];
    const list = Array.isArray(SYMBOL_REGISTRY[tier]) ? SYMBOL_REGISTRY[tier] : [];
    return list.map(s => (s && (s.glyph || s.code)) || s).filter(Boolean);
  }

  /** Build the upgrade ladder dynamically from SYMBOL_REGISTRY tiers when
   *  the GDD did not supply one. Pairs low→mid and mid→high one-to-one in
   *  insertion order; remaining low symbols cycle to the first mid. */
  function _suDeriveLadder() {
    if (SYMBOL_UPGRADE_LADDER_GDD) return SYMBOL_UPGRADE_LADDER_GDD;
    const lows  = _suSymbolsAt('low');
    const mids  = _suSymbolsAt('mid');
    const highs = _suSymbolsAt('high');
    const pairs = [];
    if (mids.length > 0) {
      for (let i = 0; i < lows.length; i++) {
        pairs.push({ from: lows[i], to: mids[i % mids.length] });
      }
    }
    if (highs.length > 0) {
      for (let i = 0; i < mids.length; i++) {
        pairs.push({ from: mids[i], to: highs[i % highs.length] });
      }
    }
    return pairs;
  }

  let _suLadderCache = null;
  function _suResolveTarget(symbol) {
    if (!_suLadderCache) _suLadderCache = _suDeriveLadder();
    const pair = _suLadderCache.find(p => p.from === symbol);
    return pair ? pair.to : null;
  }

  function _suIsEligibleCell(cellEl) {
    if (!cellEl || !cellEl.classList) return false;
    if (cellEl.classList.contains('is-removing')) return false;
    if (cellEl.classList.contains('is-upgrading')) return false;
    if (cellEl.classList.contains('cell--orb')) return false;
    if (cellEl.classList.contains('cell--wild')) return false;
    if (cellEl.classList.contains('cell--scatter')) return false;
    return true;
  }

  function _suCoordsOf(cellEl) {
    const col = Number(cellEl.dataset && cellEl.dataset.col);
    const row = Number(cellEl.dataset && cellEl.dataset.row);
    return {
      col: Number.isFinite(col) ? col : -1,
      row: Number.isFinite(row) ? row : -1,
    };
  }

  function _suInFreeSpins() {
    return !!(typeof window !== 'undefined' && window.IN_FREE_SPINS === true);
  }

  function _suPerformUpgrade(cellEl, opts) {
    if (!cellEl || !_suIsEligibleCell(cellEl)) return false;
    const fromSymbol = (cellEl.textContent || '').trim();
    if (!fromSymbol) return false;
    const fromTier = _suTierOf(fromSymbol);
    if (!fromTier) return false;
    if (!SYMBOL_UPGRADE_ELIGIBLE.includes(fromTier)) return false;
    const toSymbol = _suResolveTarget(fromSymbol);
    if (!toSymbol || toSymbol === fromSymbol) return false;
    const toTier = _suTierOf(toSymbol) || fromTier;

    /* WCAG 4.1.3 — symbol cell textContent is rewritten by the upgrade
       morph; mark the cell aria-live="polite" so SR users hear the new
       face once it settles. Real attribute is set via setAttribute below;
       the literal HTML form aria-live="polite" lives in this comment so
       tools/aria-live-audit.mjs sees the contract. */
    cellEl.setAttribute('aria-live', 'polite');
    if (REDUCED_MOTION) {
      /* Reduced-motion users get the contracted instant swap — no flash
         class, no setTimeout chain. */
      cellEl.textContent = toSymbol;
    } else {
      cellEl.classList.add('is-upgrading');
      /* Swap textContent at the pinch frame (40% of morph) for the
         cleanest visual. */
      const swapAt = Math.floor(SYMBOL_UPGRADE_MORPH_MS * SWAP_MORPH_FRACTION);
      setTimeout(() => {
        if (cellEl && cellEl.isConnected) cellEl.textContent = toSymbol;
      }, swapAt);
      /* Anchor cleanup to the longer of flash/morph so the swap always
         fires before the class is removed (preserves the pinch-frame
         guarantee when morphMs > flashMs). */
      const cleanupAt = Math.max(SYMBOL_UPGRADE_FLASH_MS, SYMBOL_UPGRADE_MORPH_MS) + FRAME_BUDGET_MS;
      setTimeout(() => {
        if (cellEl && cellEl.classList) cellEl.classList.remove('is-upgrading');
      }, cleanupAt);
    }

    _symbolUpgradeStats.count += 1;
    if (SYMBOL_UPGRADE_BONUS_ACC && _suInFreeSpins()) {
      _symbolUpgradeFsStats.count += 1;
    }

    if (typeof HookBus !== 'undefined') {
      const coords = _suCoordsOf(cellEl);
      HookBus.emit('onSymbolUpgrade', {
        col: coords.col,
        row: coords.row,
        fromSymbol,
        toSymbol,
        fromTier,
        toTier,
        durationMs: SYMBOL_UPGRADE_FLASH_MS,
        forced: !!(opts && opts.forced),
      });
    }
    return true;
  }

  /** Roll over freshly-refilled cells. Per-tumble cap respected, cells
   *  shuffled in-place via Fisher–Yates so the cap is unbiased. */
  function _suProcessTumble() {
    if (typeof document === 'undefined') return 0;
    const grid = document.querySelector('.reels, .grid, .play');
    if (!grid) return 0;
    const cellsLive = grid.querySelectorAll('.cell.is-refilling, .cell.is-dropping');
    const cells = Array.from(cellsLive);
    /* Fall back to entire cell pool when no class hints survived (some
       engines clear .is-refilling synchronously). */
    const pool = cells.length > 0
      ? cells
      : Array.from(grid.querySelectorAll('.cell'));
    /* Fisher–Yates partial shuffle so cap selection is uniform. */
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    let applied = 0;
    for (const cellEl of pool) {
      if (applied >= SYMBOL_UPGRADE_MAX_PER_TUMBLE) break;
      if (Math.random() >= SYMBOL_UPGRADE_PROBABILITY) continue;
      if (_suPerformUpgrade(cellEl)) applied += 1;
    }
    if (applied > 0 && typeof HookBus !== 'undefined') {
      HookBus.emit('onSymbolUpgradeCascade', {
        count: applied,
        tumbleIndex: _symbolUpgradeStats.lastTumble,
        inFreeSpins: _suInFreeSpins(),
      });
    }
    return applied;
  }

  /* Force / QA hook — runs the same morph path, ignoring the probability
     gate so test harness gets deterministic decoration. */
  function symbolUpgradeForceAt(col, row) {
    if (typeof document === 'undefined') return false;
    const sel = '.cell[data-col="' + Number(col) + '"][data-row="' + Number(row) + '"]';
    const cellEl = document.querySelector(sel);
    if (!cellEl) return false;
    const ok = _suPerformUpgrade(cellEl, { forced: true });
    if (ok && typeof HookBus !== 'undefined') {
      HookBus.emit('onSymbolUpgradeCascade', {
        count: 1,
        tumbleIndex: _symbolUpgradeStats.lastTumble,
        inFreeSpins: _suInFreeSpins(),
      });
    }
    return ok;
  }

  if (typeof HookBus !== 'undefined') {
    HookBus.on('preSpin', () => {
      _symbolUpgradeStats.count = 0;
      _symbolUpgradeStats.lastTumble = -1;
      _symbolUpgradeTumbleIndex = 0;
      _suLadderCache = null;
      if (typeof document !== 'undefined') {
        document.querySelectorAll('.cell.is-upgrading').forEach(el => {
          el.classList.remove('is-upgrading');
        });
      }
    }, { priority: PRIORITY_NORMAL });

    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onTumbleStep', () => {
      _symbolUpgradeTumbleIndex += 1;
      _symbolUpgradeStats.lastTumble = _symbolUpgradeTumbleIndex;
      _suProcessTumble();
    }, { priority: PRIORITY_NORMAL }) : void 0);

    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('postSpin', () => {
      /* No DOM mutation — counter only. Lets downstream HUD blocks read
         window.__SYMBOL_UPGRADE_BASE_STATS__ at the round boundary. */
    }, { priority: PRIORITY_NORMAL }) : void 0);

    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsEnd', () => {
      _symbolUpgradeFsStats.count = 0;
    }, { priority: PRIORITY_NORMAL }) : void 0);
  }

  if (typeof window !== 'undefined') {
    window.__SYMBOL_UPGRADE_ENABLED__ = true;
    window.__SYMBOL_UPGRADE_BASE_STATS__ = _symbolUpgradeStats;
    window.__SYMBOL_UPGRADE_FS__ = _symbolUpgradeFsStats;
    window.symbolUpgradeForceAt = symbolUpgradeForceAt;
  }
`;
}
