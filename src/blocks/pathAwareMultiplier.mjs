/**
 * src/blocks/pathAwareMultiplier.mjs
 *
 * Wave H13 — Path-Aware Multiplier extension (extends `waysEval`).
 *
 * Industry pattern (template-neutral, vendor-neutral):
 *
 *   In a Ways-to-Win evaluator each anchored symbol can spawn multiple
 *   evaluation "paths" (one per consecutive reel run + matching symbol).
 *   Modern Ways games dress these paths with an **additive bonus
 *   multiplier** drawn from a weighted prize ladder — every emitted path
 *   carries its own ×N tag, the per-spin total multiplier is the SUM of
 *   path tags (additive model — regulator-friendly: every chip is
 *   independently auditable), and on `postSpin` the bonus award is
 *   computed as `Σ (path.ways × path.multiplier × bet/denom)` and pushed
 *   into the same `__WIN_AWARD__` channel any other win-presentation
 *   consumer reads.
 *
 *   This block EXTENDS the existing `waysEval.mjs` LEGO atom without
 *   modifying its source. Composition contract:
 *     • waysEval owns `window.detectWaysWins()` — emits an array of
 *       `{ symbol, ways, runLength, cells }` event objects.
 *     • pathAwareMultiplier OBSERVES — monkey-patches
 *       `window.detectWaysWins` so every event returned is decorated
 *       with `{ pathMultiplier, pathMultiplierLabel }` from a weighted
 *       draw, paints a small chip into each event's win cells, computes
 *       the per-spin additive bonus, pushes it onto `__WIN_AWARD__`, and
 *       emits the dedicated HookBus events.
 *
 *   When this block is disabled (default), waysEval runs unchanged —
 *   purely additive.
 *
 * Lifecycle (HookBus contract):
 *
 *   DOMContentLoaded → install the detectWaysWins monkey-patch IF
 *                      waysEval runtime is present (window.detectWaysWins
 *                      defined). Missing → console.warn once + no-op.
 *   preSpin           → reset per-spin state (multipliers map cleared,
 *                       prevEvents = []), wipe stale chips off the DOM.
 *   postSpin          → if STATE.lastEvents has any pathMultiplier>0,
 *                       compute `sum(ev.ways × ev.pathMultiplier)`,
 *                       multiply by (bet / Math.max(WAYS_COUNT,1)) so the
 *                       award scales sanely with declared ways tier,
 *                       push onto __WIN_AWARD__ (additively — preserves
 *                       any existing line/cluster award), emit
 *                       `onPathMultiplierAggregate { events, totalMult,
 *                       awardBonus }`.
 *   onFsTrigger / onFsEnd → full reset (state cleared, chips wiped) so
 *                       a stale path mult can't bleed across a round
 *                       boundary.
 *
 *   Emitted events:
 *     onPathMultiplierAssigned { eventIdx, symbol, ways, multiplier, label }
 *                              (1 emission per path on every detectWaysWins call)
 *     onPathMultiplierAggregate { events, totalMult, awardBonus, bet }
 *                              (1 emission per postSpin when at least
 *                               one path had multiplier >= 2)
 *
 * GDD config (consumed from `model.pathAwareMultiplier`):
 *
 *   {
 *     enabled:        boolean (default false; auto-enables if any feature
 *                     kind matches /path[_-]?aware[_-]?multiplier|path[_-]?multiplier/i,
 *                     OR if `model.waysEval.enabled` is true AND the
 *                     GDD declares `pathAwareMultiplier.multiplierMap`.)
 *     multiplierMap:  Array<{ x: number, weight: number, label?: string }>
 *                     Multiplier ladder. Default: industry-baseline 6-tier
 *                     additive ladder centered on 2× with rare 100× cap.
 *     baseMultiplier: number (default 1) — every path starts with at
 *                     least this many ×. Drawing from multiplierMap REPLACES
 *                     this baseline (not added). So a default-1 base + a
 *                     drawn 2× = 2×, not 3×.
 *     aggregation:    'additive' | 'multiplicative' (default 'additive')
 *                     Additive (industry-default) → total = Σ paths.
 *                     Multiplicative → total = Π paths (used by some
 *                     premium "every land × every other" Ways variants).
 *     chipColor:      'r,g,b' (default '120,180,255' cool blue) — per-cell
 *                     chip background tint.
 *     showAggregateChip: boolean (default true) — append a 'TOTAL ×N'
 *                     chip to the global #pawHud counter so the player
 *                     can read the round's path multiplier sum live.
 *     awardScaleDenom: number (default 0 means auto = WAYS_COUNT) —
 *                     bonus award = Σ(ways × mult) × bet / awardScaleDenom.
 *                     Setting >0 lets the GDD override the dummy scale.
 *   }
 *
 * Public API (server-side, ES module):
 *
 *   defaultConfig()                          → safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitPathAwareMultiplierCSS(cfg)          → chip + HUD CSS
 *   emitPathAwareMultiplierMarkup(cfg)       → HUD container DOM
 *   emitPathAwareMultiplierRuntime(cfg)      → runtime JS (monkey-patch)
 *
 * Runtime contract (after emitted JS executes):
 *
 *   window.PAW_STATE   { enabled, patched, multiplierMap, aggregation,
 *                        lastEvents: Array<event with pathMultiplier>,
 *                        totalMult: number, awardBonus: number }
 *   window.pawDraw()   pure weighted-draw helper (test hook)
 *   window.pawReset()  clears per-spin state (used by FS boundary guards)
 *
 * Composition contract:
 *
 *   - REQUIRES `waysEval` block to be enabled in the same model. The
 *     block early-exits at runtime if `window.detectWaysWins` is missing.
 *   - DOES NOT modify waysEval source. Wraps `window.detectWaysWins`
 *     once (idempotent). Original preserved as `window.__origDetectWaysWins`.
 *   - DOES NOT modify the event shape downstream — only adds two fields
 *     (`pathMultiplier`, `pathMultiplierLabel`) which existing consumers
 *     safely ignore.
 *   - DOES NOT replace any award the engine already computed — pushes
 *     ADDITIVELY onto `__WIN_AWARD__` (so a line/cluster/ways base award
 *     and a path-mult bonus can coexist).
 *
 * Industry references (template-neutral):
 *
 *   • Ways-to-Win path tagging: standard pattern across the 243/1024/3125
 *     ways family. Per-path multiplier chips have been industry-standard
 *     since the mid-2010s lightning-strike / cash-collect Ways variants.
 *   • Additive vs multiplicative aggregation: both are regulator-approved
 *     when the table is single-source-of-truth in GDD. Additive is the
 *     vendor-neutral default (every chip independently audited).
 *   • Bonus chips rendered on win cells: WCAG 2.1 AA — chip color is
 *     configurable per GDD so colorblind palettes can override.
 */

const HEX_RGB = /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/;
const SAFE_LABEL = /^[A-Z0-9_×x*\/ -]{1,12}$/;

const DEFAULT_MULTIPLIER_MAP = Object.freeze([
  { x: 2,   weight: 40 },
  { x: 3,   weight: 24 },
  { x: 5,   weight: 16 },
  { x: 10,  weight: 10 },
  { x: 25,  weight: 6  },
  { x: 50,  weight: 3  },
  { x: 100, weight: 1  },
]);

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

/** Validate multiplierMap entries — array of { x:number>=2, weight>0, label?:safe } */
function _validMultiplierMap(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > 16) return false;
  return arr.every(e =>
    e && typeof e === 'object'
    && Number.isFinite(e.x) && e.x >= 2 && e.x <= 1e6
    && Number.isFinite(e.weight) && e.weight > 0 && e.weight <= 1e6
    && (e.label == null || (typeof e.label === 'string' && SAFE_LABEL.test(e.label)))
  );
}

export function defaultConfig() {
  return {
    enabled: false,
    multiplierMap: DEFAULT_MULTIPLIER_MAP.map(e => ({ ...e })),
    baseMultiplier: 1,
    aggregation: 'additive',
    chipColor: '120,180,255',
    showAggregateChip: true,
    awardScaleDenom: 0,         /* 0 = auto (= WAYS_COUNT) */
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.pathAwareMultiplier) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  /* Auto-enable when GDD declares a matching feature kind. */
  if (Array.isArray(model.features)) {
    const hit = model.features.some(f =>
      f && typeof f.kind === 'string' &&
      /^(path[_-]?aware[_-]?multiplier|path[_-]?multiplier)$/i.test(f.kind),
    );
    if (hit) cfg.enabled = true;
  }

  /* Hard requirement — waysEval must be enabled too. If not, force
   * disabled so this extension can't pollute a dist without its base.
   * Mirrors H15 wheelBonus precondition. */
  const waysEnabled = !!(
    (model.waysEval && model.waysEval.enabled === true) ||
    (Array.isArray(model.features) && model.features.some(f => f && f.kind === 'ways')) ||
    (model.topology && (
      model.topology.evaluation === 'ways' ||
      Number.isFinite(model.topology.ways_count)
    ))
  );
  if (!waysEnabled) cfg.enabled = false;

  if (_validMultiplierMap(m.multiplierMap)) {
    cfg.multiplierMap = m.multiplierMap.map(e => ({
      x: Number(e.x),
      weight: Number(e.weight),
      label: e.label || ('×' + Number(e.x)),
    }));
  } else {
    /* Always bake a label into the resolved map so runtime never needs
     * to compute one. */
    cfg.multiplierMap = cfg.multiplierMap.map(e => ({
      x: e.x, weight: e.weight, label: e.label || ('×' + e.x),
    }));
  }

  if (Number.isFinite(m.baseMultiplier) && m.baseMultiplier >= 1 && m.baseMultiplier <= 1e6) {
    cfg.baseMultiplier = Math.floor(m.baseMultiplier);
  }
  if (m.aggregation === 'multiplicative') cfg.aggregation = 'multiplicative';
  if (m.aggregation === 'additive')       cfg.aggregation = 'additive';

  if (typeof m.chipColor === 'string' && HEX_RGB.test(m.chipColor)) {
    cfg.chipColor = m.chipColor.replace(/\s+/g, '');
  }
  if (m.showAggregateChip != null) cfg.showAggregateChip = !!m.showAggregateChip;
  if (Number.isFinite(m.awardScaleDenom) && m.awardScaleDenom > 0 && m.awardScaleDenom <= 1e6) {
    cfg.awardScaleDenom = Math.floor(m.awardScaleDenom);
  }

  return cfg;
}

export function emitPathAwareMultiplierCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = cfg.chipColor;
  return `
  /* ── pathAwareMultiplier BLOCK — emitted by src/blocks/pathAwareMultiplier.mjs ──
     Renders a small numeric chip per win-event cell (.paw-path-chip)
     plus an optional aggregate HUD chip (#pawHud). Pure additive DOM,
     positioned absolutely inside .cell. */
  .cell .paw-path-chip {
    position: absolute;
    top: 6px;
    right: 6px;
    padding: 2px 6px;
    border-radius: 8px;
    background: rgba(${c}, 0.92);
    color: rgba(20, 30, 40, 0.95);
    font-size: 0.7rem;  /* Wave UQ — ≥11px floor */
    font-weight: 900;
    letter-spacing: 0.04em;
    line-height: 1;
    box-shadow: 0 1px 4px rgba(0,0,0,0.45), 0 0 8px rgba(${c}, 0.55);
    pointer-events: none;
    transform-origin: center;
    animation: pawChipPop 320ms ease-out 1;
    z-index: 6;
  }
  .cell .paw-path-chip[data-tier="high"] {
    background: rgba(255, 200, 80, 0.95);
    color: rgba(40, 30, 0, 0.95);
    box-shadow: 0 1px 4px rgba(0,0,0,0.5), 0 0 12px rgba(255, 200, 80, 0.75);
  }
  @keyframes pawChipPop {
    0%   { transform: scale(0.3); opacity: 0; }
    60%  { transform: scale(1.15); opacity: 1; }
    100% { transform: scale(1.0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .cell .paw-path-chip { animation: none; }
  }
  #pawHud {
    position: absolute;
    top: 10px;
    right: 10px;
    padding: 6px 10px;
    border-radius: 10px;
    background: linear-gradient(180deg, rgba(${c}, 0.95), rgba(${c}, 0.65));
    color: rgba(15, 25, 35, 0.95);
    font-size: 0.78rem;
    font-weight: 900;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    box-shadow: 0 2px 8px rgba(0,0,0,0.45);
    z-index: 12;
    display: none;
    pointer-events: none;
  }
  #pawHud[data-show="true"] { display: block; }
  #pawHud .paw-hud-label { opacity: 0.85; font-size: 0.7rem; display: block; } /* Wave UQ — ≥11px floor */
  #pawHud .paw-hud-total { font-size: 1.1rem; line-height: 1; }
`;
}

export function emitPathAwareMultiplierMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  if (!cfg.showAggregateChip) return '';
  return `
  <div id="pawHud" aria-live="polite" aria-atomic="true">
    <span class="paw-hud-label">PATH MULT</span>
    <span class="paw-hud-total" id="pawHudTotal">×0</span>
  </div>`;
}

export function emitPathAwareMultiplierRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── pathAwareMultiplier BLOCK (disabled) — stubs so probes don't crash ── */
  window.PAW_STATE = { enabled: false, patched: false, multiplierMap: [],
                       aggregation: 'additive', lastEvents: [],
                       totalMult: 0, awardBonus: 0 };
  window.pawDraw  = function () { return { x: 1, label: '×1' }; };
  window.pawReset = function () {};
`;
  }

  const mapJson      = JSON.stringify(cfg.multiplierMap.map(e => ({
    x: e.x, weight: e.weight, label: _esc(e.label),
  })));
  const baseMult     = JSON.stringify(cfg.baseMultiplier);
  const aggregation  = JSON.stringify(cfg.aggregation);
  const showHud      = cfg.showAggregateChip ? 'true' : 'false';
  const denomOverride = JSON.stringify(cfg.awardScaleDenom);

  return `
  /* ── pathAwareMultiplier BLOCK — emitted by src/blocks/pathAwareMultiplier.mjs ──
     Owns emit of: onPathMultiplierAssigned, onPathMultiplierAggregate.
     Observes: window.detectWaysWins (monkey-patches once on DOMContentLoaded).
     Hard requirement: waysEval block must be enabled (window.detectWaysWins
     present). If missing at patch time we no-op + console.warn once. */
  (function () {
    var MULT_MAP        = ${mapJson};
    var BASE_MULTIPLIER = ${baseMult};
    var AGGREGATION     = ${aggregation};
    var SHOW_HUD        = ${showHud};
    var DENOM_OVERRIDE  = ${denomOverride};

    var STATE = {
      enabled: true,
      patched: false,
      multiplierMap: MULT_MAP,
      aggregation: AGGREGATION,
      lastEvents: [],
      totalMult: 0,
      awardBonus: 0,
    };
    if (typeof window !== 'undefined') {
      window.PAW_STATE = STATE;
    }

    /* _weightedDraw — return ONE entry of MULT_MAP biased by weights.
     * Defensive fallback to first entry if total weight is zero. */
    function _weightedDraw() {
      var total = 0;
      for (var i = 0; i < MULT_MAP.length; i++) {
        var w = Number(MULT_MAP[i].weight) || 0;
        if (w > 0) total += w;
      }
      if (!(total > 0)) {
        return MULT_MAP[0] || { x: BASE_MULTIPLIER, label: '×' + BASE_MULTIPLIER };
      }
      var r = Math.random() * total;
      var acc = 0;
      for (var j = 0; j < MULT_MAP.length; j++) {
        acc += Math.max(0, Number(MULT_MAP[j].weight) || 0);
        if (r < acc) return MULT_MAP[j];
      }
      return MULT_MAP[MULT_MAP.length - 1];
    }

    function pawDraw() {
      var d = _weightedDraw();
      return { x: d.x, label: d.label };
    }
    if (typeof window !== 'undefined') {
      window.pawDraw = pawDraw;
    }

    function _wipeChips() {
      try {
        var nodes = document.querySelectorAll('.cell .paw-path-chip');
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i] && nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
        }
        var hud = document.getElementById('pawHud');
        if (hud) hud.removeAttribute('data-show');
        var total = document.getElementById('pawHudTotal');
        if (total) total.textContent = '×0';
      } catch (e) { /* DOM may not exist yet — safe to ignore */ }
    }

    function pawReset() {
      STATE.lastEvents = [];
      STATE.totalMult = 0;
      STATE.awardBonus = 0;
      _wipeChips();
    }
    if (typeof window !== 'undefined') {
      window.pawReset = pawReset;
    }

    function _renderChips(events) {
      try {
        for (var e = 0; e < events.length; e++) {
          var ev = events[e];
          var cells = ev.cells || [];
          var label = ev.pathMultiplierLabel || ('×' + ev.pathMultiplier);
          var tier = (ev.pathMultiplier >= 25) ? 'high' : 'norm';
          for (var c = 0; c < cells.length; c++) {
            var cell = cells[c];
            if (!cell || !cell.querySelector) continue;
            /* Skip if already chipped this spin (idempotent re-render guard). */
            var prior = cell.querySelector('.paw-path-chip');
            if (prior) continue;
            var chip = document.createElement('span');
            chip.className = 'paw-path-chip';
            chip.textContent = label;
            chip.setAttribute('data-tier', tier);
            chip.setAttribute('data-mult', String(ev.pathMultiplier));
            cell.appendChild(chip);
          }
        }
      } catch (e) { /* purely cosmetic — never crash spin loop */ }
    }

    function _renderHud(totalMult) {
      if (!SHOW_HUD) return;
      var hud = document.getElementById('pawHud');
      var total = document.getElementById('pawHudTotal');
      if (!hud || !total) return;
      if (totalMult >= 2) {
        total.textContent = '×' + totalMult;
        hud.setAttribute('data-show', 'true');
      } else {
        hud.removeAttribute('data-show');
        total.textContent = '×0';
      }
    }

    /* _patch — wrap window.detectWaysWins so every event returned is
     * decorated with a path multiplier. Idempotent. */
    function _patch() {
      if (STATE.patched) return;
      if (typeof window === 'undefined') return;
      if (typeof window.detectWaysWins !== 'function') {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[pathAwareMultiplier] waysEval not active — extension inert');
        }
        return;
      }
      window.__origDetectWaysWins = window.detectWaysWins;

      window.detectWaysWins = function () {
        var events = window.__origDetectWaysWins.apply(this, arguments) || [];
        if (!Array.isArray(events) || events.length === 0) {
          STATE.lastEvents = [];
          STATE.totalMult = 0;
          return events;
        }

        var decorated = [];
        for (var i = 0; i < events.length; i++) {
          var ev = events[i];
          if (!ev) continue;
          var draw = _weightedDraw();
          ev.pathMultiplier = (BASE_MULTIPLIER > 1 && draw.x < BASE_MULTIPLIER) ? BASE_MULTIPLIER : draw.x;
          ev.pathMultiplierLabel = draw.label || ('×' + ev.pathMultiplier);
          decorated.push(ev);

          if (typeof window.HookBus !== 'undefined' && typeof window.HookBus.emit === 'function') {
            try {
              window.HookBus.emit('onPathMultiplierAssigned', {
                eventIdx: i,
                symbol: ev.symbol,
                ways: ev.ways,
                multiplier: ev.pathMultiplier,
                label: ev.pathMultiplierLabel,
              });
            } catch (e) {
              if (console && console.error) console.error('[paw] assigned emit failed:', e);
            }
          }
        }

        STATE.lastEvents = decorated;
        /* Aggregate is computed here (BEFORE postSpin) so consumers that
         * subscribe to onPathMultiplierAssigned can read totalMult mid-spin. */
        STATE.totalMult = _computeTotal(decorated);

        _renderChips(decorated);
        _renderHud(STATE.totalMult);
        return decorated;
      };

      STATE.patched = true;
    }

    function _computeTotal(events) {
      if (!Array.isArray(events) || events.length === 0) return 0;
      if (AGGREGATION === 'multiplicative') {
        var prod = 1;
        for (var i = 0; i < events.length; i++) {
          var x = Number(events[i].pathMultiplier) || 1;
          if (x >= 1) prod *= x;
        }
        return prod === 1 ? 0 : prod;
      }
      /* Additive (default) */
      var sum = 0;
      for (var j = 0; j < events.length; j++) {
        var y = Number(events[j].pathMultiplier) || 0;
        if (y >= 2) sum += y;     /* base 1 doesn't add */
      }
      return sum;
    }

    function _onPostSpinAggregate() {
      try {
        var events = STATE.lastEvents || [];
        if (events.length === 0 || STATE.totalMult < 2) {
          STATE.awardBonus = 0;
          return;
        }
        var bet = (typeof window.__SLOT_BET__ === 'number' && window.__SLOT_BET__ > 0)
          ? window.__SLOT_BET__ : 1;
        var waysCount = (typeof window.WAYS_COUNT === 'number' && window.WAYS_COUNT > 0)
          ? window.WAYS_COUNT : 243;
        var denom = (DENOM_OVERRIDE > 0) ? DENOM_OVERRIDE : waysCount;

        var pathSum = 0;
        for (var i = 0; i < events.length; i++) {
          var w = Number(events[i].ways) || 0;
          var m = Number(events[i].pathMultiplier) || 0;
          if (m >= 2) pathSum += w * m;
        }
        var awardBonus = (pathSum * bet) / Math.max(1, denom);
        /* 6-decimal precision so even high-ways-count games (where the
         * default denom = WAYS_COUNT ≥ 117 649) still register a non-
         * zero additive bonus. Display layers can re-round for UX. */
        awardBonus = Math.round(awardBonus * 1e6) / 1e6;

        STATE.awardBonus = awardBonus;

        if (awardBonus > 0) {
          var prior = (typeof window.__WIN_AWARD__ === 'number' && window.__WIN_AWARD__ > 0)
            ? window.__WIN_AWARD__ : 0;
          window.__WIN_AWARD__ = Math.round((prior + awardBonus) * 1e6) / 1e6;
        }

        if (typeof window.HookBus !== 'undefined' && typeof window.HookBus.emit === 'function') {
          window.HookBus.emit('onPathMultiplierAggregate', {
            events: events.length,
            totalMult: STATE.totalMult,
            awardBonus: awardBonus,
            bet: bet,
          });
        }
      } catch (e) {
        if (console && console.error) console.error('[paw] aggregate failed:', e);
      }
    }

    /* HookBus subscriptions — preSpin wipes, postSpin aggregates, FS
     * boundary clears state so a stale path mult can't bleed across
     * round boundaries. */
    function _bindHookBus() {
      if (typeof window === 'undefined') return;
      if (!window.HookBus || typeof window.HookBus.on !== 'function') return;
      window.HookBus.on('preSpin', function () { pawReset(); });
      window.HookBus.on('postSpin', function () { _onPostSpinAggregate(); });
      window.HookBus.on('onFsTrigger', function () { pawReset(); });
      window.HookBus.on('onFsEnd', function () { pawReset(); });
    }

    function _safeSchedule() {
      _patch();
      _bindHookBus();
      if (!STATE.patched) {
        setTimeout(function () { _patch(); _bindHookBus(); }, 0);
      }
    }

    if (typeof document !== 'undefined' &&
        document.readyState !== 'complete' &&
        document.readyState !== 'interactive') {
      document.addEventListener('DOMContentLoaded', _safeSchedule, { once: true });
    } else {
      _safeSchedule();
    }
  })();
`;
}
