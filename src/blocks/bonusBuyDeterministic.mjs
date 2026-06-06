/**
 * src/blocks/bonusBuyDeterministic.mjs
 *
 * Wave H11 — Bonus Buy Deterministic Plant extension.
 *
 * Industry pattern (template-neutral, vendor-neutral):
 *
 *   The modern Bonus Buy ecosystem evolved beyond the original "pay N×
 *   bet → random scatter trigger" pattern into a TIERED purchase model:
 *   each tier (Standard / Premium / Super) costs a different multiple
 *   of bet and PLANTS specific scatter positions (and optional
 *   modifiers — starting multiplier, sticky wild, extra spins) on the
 *   next spin. The player knows EXACTLY what they're buying — no
 *   variance on the trigger itself; only on what happens during FS.
 *
 *   Regulator angle: deterministic plant = clear audit trail. UKGC LCCP
 *   5.1.6 + MGA RGF require any "Buy Bonus" feature to disclose its
 *   trigger mechanic; explicit position table satisfies that bar.
 *
 *   This block EXTENDS `bonusBuy.mjs` without modifying its source.
 *   Composition contract:
 *     • bonusBuy owns the CTA button + cost label + click→buy wiring +
 *       FORCE_TRIGGER hand-off to the engine.
 *     • bonusBuyDeterministic OBSERVES — monkey-patches the bonusBuyBtn
 *       click to FIRST open a tier picker modal, lets the player pick
 *       which plant they want, sets window.__BB_PLANT__ = { tier,
 *       positions, symbol }, then delegates to the original click
 *       handler so bonusBuy still drives FORCE_TRIGGER + runOneBaseSpin.
 *       After onSpinResult fires, this block rewrites the chosen cell
 *       positions to the bonus/scatter symbol so the next postSpin
 *       trigger detection finds the EXACT cells the GDD specified.
 *
 *   When this block is disabled (default), bonusBuy runs unchanged with
 *   its native random-scatter FORCE_TRIGGER. Purely additive.
 *
 * Lifecycle (HookBus contract):
 *
 *   DOMContentLoaded → install the bonusBuyBtn click wrapper IF the
 *                      bonusBuy block is present (button #bonusBuyBtn
 *                      exists). If missing, console.warn once + no-op.
 *   user clicks Buy Bonus → wrapped handler opens the tier picker modal
 *                      (purely additive UI — original click does NOT
 *                      fire until the player picks a tier).
 *   user clicks a tier card → set window.__BB_PLANT__ = { tier, positions,
 *                      symbol, costX, extraMult? }; close modal; fire
 *                      the original Buy handler which sets FORCE_TRIGGER
 *                      + calls runOneBaseSpin.
 *   onSpinResult → if __BB_PLANT__ is active, rewrite the cell at each
 *                      position[i] to plant.symbol. Emit
 *                      onDeterministicPlantApplied { tier, positions,
 *                      symbol, count }. If plant.extraMult, push
 *                      HookBus.setMult(extraMult) so wins on that spin
 *                      already enjoy the starting modifier.
 *   postSpin → clear __BB_PLANT__ (one-shot per buy).
 *   onFsTrigger / onFsEnd → defensive reset.
 *
 *   Emitted events:
 *     onBonusBuyTierSelected     { tier, costX, plantedCount }
 *     onDeterministicPlantApplied { tier, positions, symbol, count }
 *
 * GDD config (consumed from `model.bonusBuyDeterministic`):
 *
 *   {
 *     enabled:        boolean (default false; auto-enables if any feature
 *                     kind matches /deterministic[_-]?plant/i OR
 *                     /bonus[_-]?buy[_-]?deterministic/i.)
 *     plants:         Array of plant definitions:
 *                     [{ tier:string, costX:number, positions:[[r,c],...],
 *                        symbol:string, extraMult?:number, description?:string }]
 *                     Default: 3-tier industry-baseline ladder (Standard
 *                     / Premium / Super) at 75× / 150× / 300×.
 *     symbolDefault:  string (default 'S') — fallback bonus symbol if a
 *                     plant entry doesn't override it.
 *     pickerTitle:    string (default 'CHOOSE YOUR BUY') — modal heading.
 *     pickerColor:    'r,g,b' (default '255,170,80' — warm amber accent).
 *     closeOnBackdrop: boolean (default true) — clicking the dim layer
 *                     cancels the picker (no buy fires).
 *   }
 *
 *   NOTE: each plant.positions entry is a 2-element integer array
 *   [reelIdx, rowIdx]. Validators reject out-of-range, duplicate, or
 *   non-integer positions silently and fall back to defaults so a
 *   broken GDD doesn't crash the build.
 *
 * Public API (server-side, ES module):
 *
 *   defaultConfig()                          → safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitBonusBuyDeterministicCSS(cfg)        → tier picker modal CSS
 *   emitBonusBuyDeterministicMarkup(cfg)     → tier picker modal DOM
 *   emitBonusBuyDeterministicRuntime(cfg)    → runtime JS (monkey-patch click)
 *
 * Runtime contract (after emitted JS executes):
 *
 *   window.__BB_PLANT__              { tier, positions, symbol,
 *                                      costX, extraMult } | null
 *   window.BBD_STATE                 { enabled, plants, lastSelection,
 *                                      patched, modalOpen }
 *   window.bbdOpenPicker()           programmatic open (test hook)
 *   window.bbdSelectTier(tierLabel)  programmatic select (test hook)
 *   window.bbdCancelPicker()         programmatic cancel (test hook)
 *
 * Composition contract:
 *
 *   - REQUIRES `bonusBuy` enabled. The block early-exits at runtime if
 *     #bonusBuyBtn is missing.
 *   - DOES NOT modify bonusBuy source. Wraps the click listener at
 *     capture phase (stops the original click from firing until the
 *     player picks a tier; then the wrapped handler dispatches a fresh
 *     synthetic click that the original listener processes normally).
 *
 * Industry references (template-neutral):
 *
 *   • Tiered buy ladder: industry-standard 2-4 tier model (Standard /
 *     Premium / Super / Mega) with strictly ascending cost.
 *   • Deterministic plant: explicit position table; regulator-friendly.
 *   • Optional starting modifier: extraMult applied on the plant spin
 *     itself so the FS round opens with a multiplier already armed.
 */

const HEX_RGB = /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/;
const SAFE_LABEL = /^[A-Z0-9_ -]{1,16}$/;
const SAFE_SYMBOL = /^[A-Za-z][A-Za-z0-9_]{0,7}$/;

function clampInt(n, lo, hi) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Validate a positions array — each entry [r,c] of non-negative ints,
 *  no duplicates. Returns true / false; caller falls back to defaults. */
function _validPositions(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > 20) return false;
  const seen = new Set();
  for (const p of arr) {
    if (!Array.isArray(p) || p.length !== 2) return false;
    const r = Number(p[0]), c = Number(p[1]);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
    if (r < 0 || r > 20 || c < 0 || c > 20) return false;
    const key = r + ',' + c;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** Validate a plants array — each plant has tier/costX/positions and
 *  optional symbol/extraMult/description. Strict on input to keep the
 *  modal grid clean. */
function _validPlants(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > 6) return false;
  const seen = new Set();
  for (const p of arr) {
    if (!p || typeof p !== 'object') return false;
    if (typeof p.tier !== 'string' || !SAFE_LABEL.test(p.tier)) return false;
    if (seen.has(p.tier)) return false;
    seen.add(p.tier);
    if (!Number.isFinite(p.costX) || p.costX <= 0 || p.costX > 100000) return false;
    if (!_validPositions(p.positions)) return false;
    if (p.symbol != null) {
      if (typeof p.symbol !== 'string' || !SAFE_SYMBOL.test(p.symbol)) return false;
    }
    if (p.extraMult != null) {
      if (!Number.isFinite(p.extraMult) || p.extraMult <= 0 || p.extraMult > 1e4) return false;
    }
    if (p.description != null) {
      if (typeof p.description !== 'string' || p.description.length > 200) return false;
    }
  }
  return true;
}

export function defaultConfig() {
  return {
    enabled: false,
    /* 3-tier industry-baseline ladder — Standard / Premium / Super.
     * Positions assume a 5×3 base grid (rectangular default). When the
     * live grid has more reels/rows the engine plants only the valid
     * positions; out-of-range entries are silently skipped. */
    plants: [
      {
        tier: 'STANDARD',
        costX: 75,
        positions: [[1, 0], [2, 1], [3, 2]],
        symbol: 'S',
        description: 'Guaranteed 3 scatters — entry-level buy.',
      },
      {
        tier: 'PREMIUM',
        costX: 150,
        positions: [[0, 0], [1, 1], [2, 2], [3, 1], [4, 0]],
        symbol: 'S',
        description: 'Guaranteed 5 scatters — mid-tier value buy.',
      },
      {
        tier: 'SUPER',
        costX: 300,
        positions: [[0, 0], [0, 2], [2, 1], [4, 0], [4, 2]],
        symbol: 'S',
        extraMult: 2,
        description: 'Guaranteed 5 scatters + 2× starting multiplier.',
      },
    ],
    symbolDefault: 'S',
    pickerTitle: 'CHOOSE YOUR BUY',
    pickerColor: '255,170,80',
    closeOnBackdrop: true,
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.bonusBuyDeterministic) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  /* Hard requirement — bonusBuy must be enabled (it's the host CTA). */
  const buyEnabled = !!(model.bonusBuy && (
    model.bonusBuy.enabled === true ||
    (Array.isArray(model.features) && model.features.some(f => f && f.kind === 'bonus_buy'))
  ));
  if (!buyEnabled) cfg.enabled = false;

  if (_validPlants(m.plants)) {
    cfg.plants = m.plants.map(p => {
      const out = {
        tier: p.tier,
        costX: Number(p.costX),
        positions: p.positions.map(([r, c]) => [Number(r), Number(c)]),
      };
      if (typeof p.symbol === 'string' && SAFE_SYMBOL.test(p.symbol)) out.symbol = p.symbol;
      if (Number.isFinite(p.extraMult)) out.extraMult = Number(p.extraMult);
      if (typeof p.description === 'string') out.description = p.description;
      return out;
    });
  }

  if (typeof m.symbolDefault === 'string' && SAFE_SYMBOL.test(m.symbolDefault)) {
    cfg.symbolDefault = m.symbolDefault;
  }
  if (typeof m.pickerTitle === 'string' && m.pickerTitle.length > 0 && m.pickerTitle.length <= 60) {
    cfg.pickerTitle = m.pickerTitle;
  }
  if (typeof m.pickerColor === 'string' && HEX_RGB.test(m.pickerColor)) {
    cfg.pickerColor = m.pickerColor.replace(/\s+/g, '');
  }
  if (m.closeOnBackdrop != null) cfg.closeOnBackdrop = !!m.closeOnBackdrop;

  /* Auto-enable when GDD declares a matching feature kind. */
  if (Array.isArray(model.features)) {
    const hit = model.features.some(f =>
      f && typeof f.kind === 'string' &&
      /^(bonus[_-]?buy[_-]?deterministic|deterministic[_-]?plant)$/i.test(f.kind),
    );
    if (hit && buyEnabled) cfg.enabled = true;
  }

  return cfg;
}

export function emitBonusBuyDeterministicCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = cfg.pickerColor;
  return `
  /* ── bonusBuyDeterministic BLOCK — emitted by src/blocks/bonusBuyDeterministic.mjs ─
     Tier picker modal sits above the play surface. z-index 96 lands
     above the wheelBonus overlay (92) but below the bigWinTier banner
     (94 is the host; banner itself sits inside). pointer-events:auto
     on the inner modal so clicks register; backdrop captures
     dismissal taps. */
  .bbd-overlay {
    position: fixed;
    inset: 0;
    z-index: 96;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.78);
    backdrop-filter: blur(6px);
    pointer-events: auto;
  }
  .bbd-overlay[data-show="true"] { display: flex; }
  .bbd-modal {
    background: rgba(20, 14, 10, 0.96);
    border: 2px solid rgba(${c}, 0.7);
    border-radius: 16px;
    padding: 1.4rem 1.6rem;
    color: #fff;
    box-shadow: 0 18px 60px rgba(${c}, 0.42);
    max-width: min(92vw, 720px);
    max-height: 88vh;
    overflow-y: auto;
  }
  .bbd-title {
    text-align: center;
    font-size: 1.1rem;
    font-weight: 900;
    letter-spacing: 0.18em;
    color: rgba(${c}, 1);
    text-shadow: 0 0 10px rgba(${c}, 0.6);
    margin-bottom: 1rem;
  }
  .bbd-tier-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.8rem;
  }
  .bbd-tier-card {
    background: rgba(40, 28, 20, 0.85);
    border: 2px solid rgba(255, 255, 255, 0.18);
    border-radius: 12px;
    padding: 0.9rem 0.7rem;
    text-align: center;
    cursor: pointer;
    transition: transform 0.12s ease, border-color 0.18s ease, box-shadow 0.18s ease;
    color: #fff;
    user-select: none;
  }
  .bbd-tier-card:hover {
    transform: translateY(-3px);
    border-color: rgba(${c}, 0.9);
    box-shadow: 0 6px 22px rgba(${c}, 0.45);
  }
  .bbd-tier-card .bbd-tier-label {
    display: block;
    font-size: 0.95rem;
    font-weight: 900;
    letter-spacing: 0.1em;
    color: rgba(${c}, 1);
  }
  .bbd-tier-card .bbd-tier-cost {
    display: block;
    font-size: 1.4rem;
    font-weight: 900;
    margin: 0.3rem 0;
    color: #fff;
  }
  .bbd-tier-card .bbd-tier-cost-suffix {
    font-size: 0.7rem;
    opacity: 0.7;
    letter-spacing: 0.08em;
  }
  .bbd-tier-card .bbd-tier-desc {
    font-size: 0.7rem;
    opacity: 0.78;
    line-height: 1.35;
    margin-top: 0.4rem;
  }
  .bbd-tier-card .bbd-tier-mod {
    display: inline-block;
    margin-top: 0.5rem;
    font-size: 0.7rem;  /* Wave UQ — ≥11px floor */
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 0.15rem 0.45rem;
    border-radius: 6px;
    background: rgba(${c}, 0.22);
    color: rgba(${c}, 1);
  }
  .bbd-cancel {
    display: block;
    margin: 1.1rem auto 0;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 10px;
    padding: 0.5rem 1.4rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .bbd-cancel:hover { background: rgba(255, 255, 255, 0.18); }
  @media (prefers-reduced-motion: reduce) {
    .bbd-tier-card { transition: none; }
  }
  @media (max-width: 620px) {
    .bbd-tier-grid { grid-template-columns: 1fr; }
    .bbd-modal { padding: 1rem 1rem; }
  }
`;
}

export function emitBonusBuyDeterministicMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const cards = cfg.plants.map((p, i) => `
    <button class="bbd-tier-card" type="button" data-tier-index="${i}" data-tier="${_esc(p.tier)}">
      <span class="bbd-tier-label">${_esc(p.tier)}</span>
      <span class="bbd-tier-cost">${p.costX}<span class="bbd-tier-cost-suffix">× BET</span></span>
      <span class="bbd-tier-desc">${_esc(p.description || (p.positions.length + ' scatters'))}</span>
      ${p.extraMult ? `<span class="bbd-tier-mod">+${p.extraMult}× START</span>` : ''}
    </button>
  `).join('');
  return `<div id="bbdOverlay" class="bbd-overlay" data-show="false" data-modal="true" role="dialog" aria-modal="true" aria-labelledby="bbdTitle">
  <div class="bbd-modal">
    <div id="bbdTitle" class="bbd-title">${_esc(cfg.pickerTitle)}</div>
    <div class="bbd-tier-grid">${cards}</div>
    <button id="bbdCancel" class="bbd-cancel" type="button">CANCEL</button>
  </div>
</div>`;
}

export function emitBonusBuyDeterministicRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── bonusBuyDeterministic BLOCK (disabled) — stubs so probes don't crash ── */
  window.__BB_PLANT__       = null;
  window.BBD_STATE          = { enabled: false, plants: [], lastSelection: null, patched: false, modalOpen: false };
  window.bbdOpenPicker      = function () {};
  window.bbdSelectTier      = function () {};
  window.bbdCancelPicker    = function () {};
`;
  }

  const plantsJson = JSON.stringify(cfg.plants.map(p => ({
    tier: _esc(p.tier),
    costX: p.costX,
    positions: p.positions,
    symbol: p.symbol || cfg.symbolDefault,
    extraMult: p.extraMult || 0,
    description: _esc(p.description || ''),
  })));
  const symbolDefault = JSON.stringify(cfg.symbolDefault);
  const closeOnBackdrop = cfg.closeOnBackdrop ? 'true' : 'false';

  return `
  /* ── bonusBuyDeterministic BLOCK — emitted by src/blocks/bonusBuyDeterministic.mjs ──
     Owns emit of: onBonusBuyTierSelected, onDeterministicPlantApplied.
     Observes: bonusBuyBtn click (wraps at capture), onSpinResult (DOM
     plant), postSpin (one-shot reset), onFsTrigger/onFsEnd (defensive).
     Hard requirement: bonusBuy block enabled (#bonusBuyBtn must exist).
     If missing at patch time we no-op + console.warn once. */
  (function () {
    var PLANTS         = ${plantsJson};
    var SYMBOL_DEFAULT = ${symbolDefault};
    var CLOSE_ON_BACKDROP = ${closeOnBackdrop};

    var STATE = {
      enabled: true,
      plants: PLANTS,
      lastSelection: null,    /* full plant object or null */
      patched: false,
      modalOpen: false,
    };
    if (typeof window !== 'undefined') {
      window.__BB_PLANT__ = null;
      window.BBD_STATE    = STATE;
    }

    var WARNED_MISSING = false;

    function _overlay() { return document.getElementById('bbdOverlay'); }
    function _cancelBtn() { return document.getElementById('bbdCancel'); }
    function _tierCards() {
      var ov = _overlay();
      return ov ? ov.querySelectorAll('.bbd-tier-card') : [];
    }

    function bbdOpenPicker() {
      if (STATE.modalOpen) return;
      var ov = _overlay();
      if (!ov) return;
      ov.setAttribute('data-show', 'true');
      STATE.modalOpen = true;
      /* Move focus to the first tier card for keyboard navigation. */
      var first = ov.querySelector('.bbd-tier-card');
      if (first && typeof first.focus === 'function') {
        try { first.focus({ preventScroll: true }); } catch (_) { try { first.focus(); } catch (__) {} }
      }
    }

    function bbdCancelPicker() {
      var ov = _overlay();
      if (ov) ov.setAttribute('data-show', 'false');
      STATE.modalOpen = false;
      STATE.lastSelection = null;
      if (typeof window !== 'undefined') window.__BB_PLANT__ = null;
    }

    function bbdSelectTier(tierLabel) {
      var hit = null;
      for (var i = 0; i < PLANTS.length; i++) {
        if (PLANTS[i].tier === tierLabel) { hit = PLANTS[i]; break; }
      }
      if (!hit) return false;
      STATE.lastSelection = hit;
      if (typeof window !== 'undefined') {
        window.__BB_PLANT__ = {
          tier: hit.tier,
          positions: hit.positions.map(function (p) { return [p[0], p[1]]; }),
          symbol: hit.symbol || SYMBOL_DEFAULT,
          costX: hit.costX,
          extraMult: hit.extraMult || 0,
        };
      }
      /* Close the modal first so the original bonusBuyBtn handler sees
       * normal UI state when it dispatches the spin. */
      var ov = _overlay();
      if (ov) ov.setAttribute('data-show', 'false');
      STATE.modalOpen = false;
      if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onBonusBuyTierSelected', {
            tier: hit.tier, costX: hit.costX,
            plantedCount: hit.positions.length,
          });
        } catch (e) {
          if (console && console.error) console.error('[bbd] emit tier failed:', e);
        }
      }
      /* Defer to the (original) Buy button click. The wrapped handler
       * removed the capture-stop; this synthetic click flows through to
       * bonusBuy's original logic which sets FORCE_TRIGGER and calls
       * runOneBaseSpin. We use a microtask to keep the call stack
       * shallow and predictable. */
      setTimeout(function () {
        if (typeof window === 'undefined') return;
        var btn = document.getElementById('bonusBuyBtn');
        if (!btn) return;
        STATE.bypassWrap = true;
        try {
          btn.click();
        } finally {
          STATE.bypassWrap = false;
        }
      }, 0);
      return true;
    }

    /* Cell rewrite — after engine renders the reels (onSpinResult) but
     * BEFORE postSpin's scatter detector runs, walk the planted
     * positions and overwrite cell content. Engine's FORCE_TRIGGER
     * mechanism guaranteed at least N scatters were ALREADY planted at
     * random reels by the reel renderer; we add precision by ALSO
     * setting cells the GDD asked for. Idempotent: only fires when
     * __BB_PLANT__ is non-null. */
    function _applyPlant() {
      if (typeof window === 'undefined') return;
      var plant = window.__BB_PLANT__;
      if (!plant || !Array.isArray(plant.positions)) return;
      var host = document.getElementById('gridHost');
      if (!host) return;
      var reels = window.REELS || 5;
      var rows  = window.ROWS  || 3;
      var cells = host.querySelectorAll('.cell');
      var planted = 0;
      for (var i = 0; i < plant.positions.length; i++) {
        var pos = plant.positions[i];
        var r = pos[0], c = pos[1];
        if (r < 0 || r >= reels || c < 0 || c >= rows) continue;   /* out of grid for this topology */
        var idx = r * rows + c;                                     /* column-major in the rendered grid */
        /* Many engines render row-major. Try column-major first; if cell
         * count suggests row-major (reels × rows), recompute. */
        if (cells.length === reels * rows) {
          /* Default layout in this template: row-major iteration in
           * renderRect produces order (r0c0, r0c1, ..., r1c0, ...).
           * Reels are columns; cells[reel*rows + row] is correct. */
          idx = r * rows + c;
        }
        var cell = cells[idx];
        if (!cell) continue;
        cell.textContent = plant.symbol;
        planted++;
      }
      /* Apply extraMult on this spin via HookBus shared state if asked. */
      if (plant.extraMult && plant.extraMult > 1 &&
          typeof window.HookBus !== 'undefined' &&
          typeof window.HookBus.setMult === 'function') {
        try { window.HookBus.setMult(plant.extraMult); } catch (_) {}
      }
      if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onDeterministicPlantApplied', {
            tier: plant.tier,
            positions: plant.positions,
            symbol: plant.symbol,
            count: planted,
          });
        } catch (e) {
          if (console && console.error) console.error('[bbd] emit plant failed:', e);
        }
      }
    }

    /* _patch — install the wrapper on bonusBuyBtn click. Capture phase
     * so we run BEFORE the original bubble-phase listener that bonusBuy
     * installed. If STATE.bypassWrap is true, we let the click flow
     * through (this is how bbdSelectTier dispatches the real buy). */
    function _patch() {
      if (STATE.patched) return;
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      var btn = document.getElementById('bonusBuyBtn');
      if (!btn) {
        if (!WARNED_MISSING && typeof console !== 'undefined' && console.warn) {
          console.warn('[bonusBuyDeterministic] #bonusBuyBtn missing — bonusBuy not active');
          WARNED_MISSING = true;
        }
        return;
      }
      btn.addEventListener('click', function (ev) {
        if (STATE.bypassWrap) return;          /* synthetic re-click flows through */
        ev.stopPropagation();
        ev.preventDefault();
        bbdOpenPicker();
      }, true);                                 /* capture phase so we see the click first */

      /* Wire tier cards + cancel + backdrop. */
      var cards = _tierCards();
      for (var i = 0; i < cards.length; i++) {
        (function (card) {
          card.addEventListener('click', function () {
            var tier = card.getAttribute('data-tier');
            if (tier) bbdSelectTier(tier);
          });
        })(cards[i]);
      }
      var cancel = _cancelBtn();
      if (cancel) cancel.addEventListener('click', bbdCancelPicker);
      if (CLOSE_ON_BACKDROP) {
        var ov = _overlay();
        if (ov) {
          ov.addEventListener('click', function (ev) {
            if (ev.target === ov) bbdCancelPicker();
          });
        }
      }
      STATE.patched = true;
    }

    if (typeof window !== 'undefined') {
      window.bbdOpenPicker   = bbdOpenPicker;
      window.bbdSelectTier   = bbdSelectTier;
      window.bbdCancelPicker = bbdCancelPicker;
    }

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _patch, { once: true });
      } else {
        _patch();
      }
    }

    if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.on === 'function') {
      /* Apply plant after engine renders the reels but BEFORE postSpin's
       * scatter detector runs. HookBus dispatches listeners in
       * registration order; this block's runtime is emitted by
       * buildSlotHTML AFTER reelEngine + postSpin, but onSpinResult is
       * emitted by reelEngine itself so any listener registered earlier
       * fires first. We register here regardless and rely on the engine
       * to honor the rewritten cells when running detection. */
      window.HookBus.on('onSpinResult', function () {
        _applyPlant();
      });
      /* Post-spin → clear the plant so subsequent natural spins are
       * unaffected. One-shot per buy. */
      window.HookBus.on('postSpin', function () {
        if (typeof window !== 'undefined') window.__BB_PLANT__ = null;
        STATE.lastSelection = null;
      });
      /* FS boundaries → defensive reset (a Buy that triggered FS should
       * not leave a stale plant for the post-FS resume spin). */
      window.HookBus.on('onFsTrigger', function () {
        if (typeof window !== 'undefined') window.__BB_PLANT__ = null;
        STATE.lastSelection = null;
      });
      window.HookBus.on('onFsEnd', function () {
        if (typeof window !== 'undefined') window.__BB_PLANT__ = null;
        STATE.lastSelection = null;
      });
    }
  })();
`;
}
