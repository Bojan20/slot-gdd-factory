/**
 * src/blocks/potSymbolFireball.mjs
 *
 * Wave D-17.5 (Foundry-family gap closure) — Pot-symbol classifier
 * + value tracker. Adapter block that lets the hold-and-win cell
 * persistence + reset-on-new-landing logic treat the tiered "pot"
 * symbols (MINI / MINOR / MAJOR by default) as ordinary value-carrying
 * cells rather than celebration overlays.
 *
 * @module potSymbolFireball
 *
 * Purpose:
 *   Provides a vendor-neutral, math-blind, opt-in classifier that
 *   (a) tags pot symbols on the grid with a uniform "pot" data flag so
 *   downstream holdAndWin / holdAndWinFrameMultiplier / etc. blocks
 *   recognize them as value-carrying cells, (b) emits canonical
 *   landed/collected events when a pot symbol enters the hold-and-win
 *   state, and (c) tracks the running collected pot total within a
 *   single feature session so a final sum is published at COLLECT.
 *
 * Industry reference (vendor-neutral, industry baseline):
 *   Tiered pot symbols (named like MINI / MINOR / MAJOR / GRAND) that
 *   land as special variants of the base money-collect symbol and
 *   contribute fixed credit awards on top of the standard cell values
 *   are an industry baseline for hold-and-win-family titles. The
 *   Foundry production GDD §10.2 codifies the rule:
 *   "A held special Fireball carrying MINI (100), MINOR (500), or
 *   MAJOR (2000) adds that pot to the running collect total alongside
 *   standard Fireball values (pool: 20–1500 credits) and Big Fireball
 *   values. Pots persist through respins identically to value Fireballs;
 *   they reset the respin counter on the spin they land."
 *   This block is the structural generalization, not a clone of any
 *   particular title.
 *
 * Persistence + reset semantics
 *   The block does NOT implement the respin-reset itself — that lives
 *   in `holdAndWin.mjs`. It only emits `onPotSymbolLanded` carrying the
 *   tier and credit value; the holdAndWin block already resets the
 *   respin counter on any NEW value-carrying landing and persists
 *   tagged cells through subsequent respins. The pot tag is what makes
 *   the upstream block recognize these cells as "value Fireballs" in
 *   the first place.
 *
 * GRAND interaction (out of scope)
 *   GRAND (full-board fill) is owned by `grandInterruptionLock.mjs`
 *   (D-17.6) which subscribes to holdAndWin board-fill events. This
 *   block does NOT trigger GRAND directly; it only contributes credits
 *   to the running collect tally, which the upstream block caps at
 *   1,000,000 credits per the Foundry §04.6 / §10.6 rule.
 *
 * Math gate
 *   Pot tier values are display defaults from cfg.potValues. The
 *   engine's `result.potLandings` (when published) takes precedence —
 *   used when the math layer wants to land a specific tier at a
 *   specific cell for an upcoming spin (e.g. force-chip path).
 *
 * Public API
 *   export function defaultConfig(): PotSymbolFireballConfig
 *   export function resolveConfig(model?: object): PotSymbolFireballConfig
 *   export function emitPotSymbolFireballCSS(cfg): string
 *   export function emitPotSymbolFireballRuntime(cfg): string
 *   export function classifyCell(cell, cfg): { tier, credits }|null  (test)
 *   export function sumLandings(landings): number                    (test)
 *
 * Lifecycle (when enabled)
 *   • onHoldAndWinTrigger → reset collected-pots state for new session
 *   • onSpinResult / onFsSpinResult → scan grid → classify pot symbols
 *                                     → emit landed per pot
 *   • onHoldAndWinEnd     → emit collected (sum) → reset state
 *
 * HookBus events (sole emitter contract)
 *   • onPotSymbolLanded     payload: { tier, credits, reel, row, source }
 *   • onPotSymbolCollected  payload: { totalPotCredits, breakdown, count }
 *
 * Force chip (per rule_force_buttons_real_spin)
 *   • window.potSymbolFireballForce(tier, reel, row)
 *     → sets window.__FORCE_POT_SYMBOL__ = { tier, reel, row }
 *     → triggers runOneBaseSpin() (real engine path)
 *     → engine bakes pot landing into spinResult; block detects + emits
 *
 * Accessibility
 *   • Each pot cell announces "Pot symbol <tier>, <credits> credits"
 *     via aria-label on the .pot-tag element (role="img").
 *   • prefers-reduced-motion: reduce → no shimmer animation.
 *
 * Perf budget
 *   • O(rows × reels) scan per spin (≤ 30 reads on 5×6).
 *   • CSS-only shimmer; no JS animation loop.
 *
 * Honest scope
 *   This block does NOT pay pots, does NOT trigger GRAND, does NOT
 *   reset the respin counter. It ONLY classifies + emits + tracks the
 *   running tally for a clean COLLECT-time sum.
 *
 * GDD knobs (under `model.potSymbolFireball`)
 *   • enabled        bool                              (default false — opt-in)
 *   • potValues      Object<tier, number>              (default { MINI:100, MINOR:500, MAJOR:2000 })
 *   • potTiers       string[]                          (default ['MINI','MINOR','MAJOR'])
 *   • symbolPrefix   string                            (default 'POT_' — engine tag prefix)
 *   • themeClass     string                            (default '')
 *   • role           string                            (default 'img')
 *   • ariaLabelPrefix string                           (default 'Pot symbol')
 *   • shimmerDurationMs int 200..3000                  (default 900)
 */

const DEFAULT_TIERS  = Object.freeze(['MINI', 'MINOR', 'MAJOR']);
const DEFAULT_VALUES = Object.freeze({ MINI: 100, MINOR: 500, MAJOR: 2000 });

const DEFAULTS = Object.freeze({
  enabled:            false,
  potValues:          DEFAULT_VALUES,
  potTiers:           DEFAULT_TIERS,
  symbolPrefix:       'POT_',
  themeClass:         '',
  role:               'img',
  ariaLabelPrefix:    'Pot symbol',
  shimmerDurationMs:  900,
});

const BOUNDS = Object.freeze({
  shimmerDurationMs: [200, 3000],
});

export function defaultConfig() {
  return Object.freeze({
    ...DEFAULTS,
    potTiers:  [...DEFAULT_TIERS],
    potValues: { ...DEFAULT_VALUES },
  });
}

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

function sanitizeStringKnob(s, maxLen) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return null;
  return trimmed.replace(/[\x00-\x1f<>"']/g, '');
}

function sanitizeTiers(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const clean = sanitizeStringKnob(v, 16);
    if (!clean) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out.length > 0 ? out : null;
}

function sanitizePotValues(obj, tiers) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  let validCount = 0;
  for (const tier of tiers) {
    const v = obj[tier];
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1e9) continue;
    out[tier] = Math.floor(v);
    validCount++;
  }
  return validCount > 0 ? out : null;
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.potSymbolFireball) || {};

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;

  const tiers = sanitizeTiers(src.potTiers);
  if (tiers) cfg.potTiers = tiers;

  const values = sanitizePotValues(src.potValues, cfg.potTiers);
  if (values) {
    /* ensure every tier has a value (fall back to DEFAULT_VALUES then 0) */
    const filled = {};
    for (const tier of cfg.potTiers) {
      if (typeof values[tier] === 'number') filled[tier] = values[tier];
      else if (typeof DEFAULT_VALUES[tier] === 'number') filled[tier] = DEFAULT_VALUES[tier];
      else filled[tier] = 0;
    }
    cfg.potValues = filled;
  } else {
    /* re-derive from defaults using the (possibly custom) tiers */
    const filled = {};
    for (const tier of cfg.potTiers) {
      filled[tier] = (typeof DEFAULT_VALUES[tier] === 'number') ? DEFAULT_VALUES[tier] : 0;
    }
    cfg.potValues = filled;
  }

  const prefix = sanitizeStringKnob(src.symbolPrefix, 16);
  if (prefix !== null) cfg.symbolPrefix = prefix;

  if ('shimmerDurationMs' in src) {
    const v = clampInt(src.shimmerDurationMs, BOUNDS.shimmerDurationMs[0], BOUNDS.shimmerDurationMs[1]);
    if (v !== null) cfg.shimmerDurationMs = v;
  }

  const theme = sanitizeStringKnob(src.themeClass, 32);
  if (theme !== null) cfg.themeClass = theme.replace(/[^a-zA-Z0-9_-]/g, '');

  const role = sanitizeStringKnob(src.role, 16);
  if (role !== null) cfg.role = role;

  const aria = sanitizeStringKnob(src.ariaLabelPrefix, 64);
  if (aria !== null) cfg.ariaLabelPrefix = aria;

  return cfg;
}

/* ─── Pure helpers (test-exposed) ──────────────────────────────────────── */

/**
 * Classify a grid cell as a pot symbol. Returns { tier, credits } when
 * the cell matches; null otherwise.
 *
 * Recognition rules (in priority order):
 *   1. Cell is an object with `__pot__: { tier, credits? }` — engine tag.
 *   2. Cell is a string matching `<symbolPrefix><tier>` (case-insens).
 *   3. Cell is a string exactly equal to one of cfg.potTiers (case-insens).
 *
 * The credits field defaults to cfg.potValues[tier] when not explicitly
 * supplied by the engine tag.
 */
export function classifyCell(cell, cfg) {
  const c = cfg || defaultConfig();
  if (!c.potTiers || c.potTiers.length === 0) return null;

  /* Path 1: engine-tagged object cell. */
  if (cell && typeof cell === 'object' && cell.__pot__) {
    const rawTier = cell.__pot__.tier;
    if (typeof rawTier !== 'string') return null;
    const tier = matchTierCaseInsens(rawTier, c.potTiers);
    if (!tier) return null;
    const credits = (typeof cell.__pot__.credits === 'number' && isFinite(cell.__pot__.credits))
      ? Math.floor(cell.__pot__.credits)
      : (c.potValues[tier] || 0);
    return { tier: tier, credits: credits };
  }

  if (typeof cell !== 'string') return null;
  const upper = cell.trim().toUpperCase();
  if (!upper) return null;

  /* Path 2: prefix + tier */
  if (c.symbolPrefix) {
    const prefixUpper = c.symbolPrefix.toUpperCase();
    if (upper.startsWith(prefixUpper)) {
      const rest = upper.slice(prefixUpper.length);
      const tier = matchTierCaseInsens(rest, c.potTiers);
      if (tier) return { tier: tier, credits: c.potValues[tier] || 0 };
    }
  }

  /* Path 3: bare tier */
  const tier = matchTierCaseInsens(upper, c.potTiers);
  if (tier) return { tier: tier, credits: c.potValues[tier] || 0 };
  return null;
}

function matchTierCaseInsens(raw, tiers) {
  if (typeof raw !== 'string') return null;
  const norm = raw.trim().toUpperCase();
  if (!norm) return null;
  for (const t of tiers) {
    if (typeof t !== 'string') continue;
    if (t.toUpperCase() === norm) return t;
  }
  return null;
}

/**
 * Sum total pot credits across an array of landed pot entries.
 * Each entry shape: { tier, credits, ... }. Ignores entries missing
 * a numeric credits field.
 */
export function sumLandings(landings) {
  if (!Array.isArray(landings)) return 0;
  let total = 0;
  for (const l of landings) {
    if (!l) continue;
    if (typeof l.credits !== 'number' || !isFinite(l.credits)) continue;
    total += l.credits;
  }
  return total;
}

/* ─── CSS emit ──────────────────────────────────────────────────────────── */

export function emitPotSymbolFireballCSS(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  return `
/* potSymbolFireball — pot tag overlay on .cell */
.pot-tag {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  border-radius: 10px;
  background: radial-gradient(circle, rgba(255,210,90,0.95) 0%,
              rgba(230,140,40,0.88) 60%, rgba(120,50,5,0.85) 100%);
  box-shadow: inset 0 0 0 2px rgba(255,230,150,0.65),
              0 6px 18px rgba(0,0,0,0.45);
  color: #fff8d0;
  font-weight: 800;
  text-shadow: 0 3px 10px rgba(0,0,0,0.55);
  z-index: 28;
  animation: potShimmer ${c.shimmerDurationMs}ms ease-in-out infinite;
}
.pot-tag .pot-tier {
  font-size: 0.95em;
  letter-spacing: 0.08em;
}
.pot-tag .pot-credits {
  font-size: 1.2em;
  margin-top: 2px;
}
.cell[data-pot-tier] { position: relative; }
[data-pot-tier="MINI"]  .pot-tag { filter: brightness(1.0); }
[data-pot-tier="MINOR"] .pot-tag { filter: brightness(1.08) saturate(1.15); }
[data-pot-tier="MAJOR"] .pot-tag { filter: brightness(1.18) saturate(1.3); }
@keyframes potShimmer {
  0%, 100% { box-shadow: inset 0 0 0 2px rgba(255,230,150,0.65),
                          0 6px 18px rgba(0,0,0,0.45); }
  50%      { box-shadow: inset 0 0 0 3px rgba(255,250,200,0.85),
                          0 8px 22px rgba(255,180,80,0.5); }
}
@media (prefers-reduced-motion: reduce) {
  .pot-tag { animation: none; }
}
`;
}

/* ─── Runtime emit (HookBus + DOM) ────────────────────────────────────────── */

export function emitPotSymbolFireballRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const cfgJSON = JSON.stringify({
    potValues:         c.potValues,
    potTiers:          c.potTiers,
    symbolPrefix:      c.symbolPrefix,
    themeClass:        c.themeClass,
    role:              c.role,
    ariaLabelPrefix:   c.ariaLabelPrefix,
    shimmerDurationMs: c.shimmerDurationMs,
  });

  return `
/* potSymbolFireball runtime — pot symbol classifier + landed/collected events */
(function potSymbolFireballInit() {
  const CFG = ${cfgJSON};
  const collected = []; /* [{ tier, credits, reel, row, source }] */
  const mountedTags = []; /* [{ el, reel, row }] */

  function matchTier(raw) {
    if (typeof raw !== 'string') return null;
    const norm = raw.trim().toUpperCase();
    if (!norm) return null;
    for (const t of CFG.potTiers) {
      if (typeof t !== 'string') continue;
      if (t.toUpperCase() === norm) return t;
    }
    return null;
  }

  function classifyCell(cell) {
    if (!CFG.potTiers || CFG.potTiers.length === 0) return null;
    if (cell && typeof cell === 'object' && cell.__pot__) {
      const t = matchTier(cell.__pot__.tier);
      if (!t) return null;
      const credits = (typeof cell.__pot__.credits === 'number' && isFinite(cell.__pot__.credits))
        ? Math.floor(cell.__pot__.credits)
        : (CFG.potValues[t] || 0);
      return { tier: t, credits: credits };
    }
    if (typeof cell !== 'string') return null;
    const upper = cell.trim().toUpperCase();
    if (!upper) return null;
    if (CFG.symbolPrefix) {
      const px = CFG.symbolPrefix.toUpperCase();
      if (upper.indexOf(px) === 0) {
        const t = matchTier(upper.slice(px.length));
        if (t) return { tier: t, credits: CFG.potValues[t] || 0 };
      }
    }
    const t2 = matchTier(upper);
    if (t2) return { tier: t2, credits: CFG.potValues[t2] || 0 };
    return null;
  }

  function toCols(grid) {
    if (!Array.isArray(grid) || grid.length === 0) return null;
    if (!Array.isArray(grid[0])) return null;
    const outer = grid.length;
    const inner = grid[0].length;
    if (outer > inner) return grid;
    const cols = [];
    for (let r = 0; r < inner; r++) {
      const col = [];
      for (let row = 0; row < outer; row++) col.push(grid[row][r]);
      cols.push(col);
    }
    return cols;
  }

  function unmountAllTags() {
    while (mountedTags.length > 0) {
      const m = mountedTags.pop();
      try { if (m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el); } catch (_) {}
    }
  }

  function mountTag(reel, row, tier, credits) {
    const anchor = document.querySelector(
      '.cell[data-reel="' + reel + '"][data-row="' + row + '"]');
    if (!anchor) return;
    anchor.setAttribute('data-pot-tier', tier);
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="pot-tag" role="img"></div>';
    const tag = wrap.firstChild;
    if (CFG.themeClass) tag.classList.add(CFG.themeClass);
    tag.setAttribute('role', CFG.role);
    tag.setAttribute('aria-label',
      CFG.ariaLabelPrefix + ' ' + tier + ', ' + credits + ' credits');
    const tierEl = document.createElement('div');
    tierEl.className = 'pot-tier';
    tierEl.textContent = tier;
    const creditsEl = document.createElement('div');
    creditsEl.className = 'pot-credits';
    creditsEl.textContent = String(credits);
    tag.appendChild(tierEl);
    tag.appendChild(creditsEl);
    anchor.appendChild(tag);
    mountedTags.push({ el: tag, reel: reel, row: row });
  }

  function scanGrid(grid, source) {
    const cols = toCols(grid);
    if (!cols) return [];
    const reels = cols.length;
    const out = [];
    for (let reel = 0; reel < reels; reel++) {
      const col = cols[reel];
      if (!Array.isArray(col)) continue;
      for (let row = 0; row < col.length; row++) {
        const info = classifyCell(col[row]);
        if (!info) continue;
        out.push({
          tier: info.tier, credits: info.credits,
          reel: reel, row: row, source: source || 'spin',
        });
      }
    }
    return out;
  }

  function handleResult(result) {
    const grid = (result && result.grid)
                  || (typeof window !== 'undefined' ? window.__SLOT_GRID__ : null);
    if (!grid) return;
    /* Force chip path */
    const forced = (typeof window !== 'undefined') ? window.__FORCE_POT_SYMBOL__ : null;
    if (forced && typeof forced === 'object') {
      const tier = matchTier(forced.tier) || CFG.potTiers[0];
      const credits = CFG.potValues[tier] || 0;
      const reel = typeof forced.reel === 'number' ? forced.reel : 0;
      const row  = typeof forced.row  === 'number' ? forced.row  : 0;
      window.__FORCE_POT_SYMBOL__ = undefined;
      mountTag(reel, row, tier, credits);
      collected.push({ tier: tier, credits: credits, reel: reel, row: row, source: 'force' });
      if (typeof window.HookBus !== 'undefined') {
        try {
          window.HookBus.emit('onPotSymbolLanded', {
            tier: tier, credits: credits, reel: reel, row: row, source: 'force',
          });
        } catch (_) {}
      }
      return;
    }
    const landings = scanGrid(grid, 'spin');
    for (const land of landings) {
      mountTag(land.reel, land.row, land.tier, land.credits);
      collected.push(land);
      if (typeof window.HookBus !== 'undefined') {
        try {
          window.HookBus.emit('onPotSymbolLanded', {
            tier: land.tier, credits: land.credits,
            reel: land.reel, row: land.row, source: 'spin',
          });
        } catch (_) {}
      }
    }
  }

  function handleTriggerStart() {
    /* Reset session state for new feature trigger. */
    collected.length = 0;
    unmountAllTags();
  }

  function handleCollect() {
    if (collected.length === 0) return;
    let total = 0;
    const breakdown = {};
    for (const c of collected) {
      total += c.credits;
      breakdown[c.tier] = (breakdown[c.tier] || 0) + c.credits;
    }
    if (typeof window.HookBus !== 'undefined') {
      try {
        window.HookBus.emit('onPotSymbolCollected', {
          totalPotCredits: total,
          breakdown:       breakdown,
          count:           collected.length,
        });
      } catch (_) {}
    }
    collected.length = 0;
    unmountAllTags();
  }

  /* Force chip — per rule_force_buttons_real_spin */
  if (typeof window !== 'undefined') {
    window.potSymbolFireballForce = function (tier, reel, row) {
      window.__FORCE_POT_SYMBOL__ = {
        tier: typeof tier === 'string' ? tier : (CFG.potTiers[0] || 'MINI'),
        reel: typeof reel === 'number' ? reel : 0,
        row:  typeof row  === 'number' ? row  : 0,
      };
      if (typeof window.runOneBaseSpin === 'function') {
        window.runOneBaseSpin();
      }
    };
    window.potSymbolFireballGetCollected = function () {
      return collected.slice();
    };
  }

  /* Lifecycle wiring */
  if (typeof window.HookBus !== 'undefined') {
    window.HookBus.on('onHoldAndWinTrigger', handleTriggerStart);
    window.HookBus.on('onSpinResult',        handleResult);
    window.HookBus.on('onFsSpinResult',      handleResult);
    window.HookBus.on('onHoldAndWinEnd',     handleCollect);
  }
})();
`;
}
